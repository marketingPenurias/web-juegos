import type { Route } from "./+types/api.session";
import {
	jsonResponse,
	preflight,
	verifyAuthToken,
} from "../lib/api.server";
import { getServiceSupabase } from "../lib/supabase.server";
import { pickTenantSlug } from "../lib/tenant-resolver.server";

/**
 * GET /api/session
 *
 *   Bundle de bootstrap.  Cambios respecto a la versión anterior:
 *
 *     · **JIT profile creation** — si el usuario existe en
 *       `auth.users` pero NO en `public.user_profiles` para este
 *       tenant, se crea sobre la marcha (token_balance=0,
 *       lifetime_earned=0).  Desbloquea el primer login con Google
 *       sin requerir un trigger Postgres ni un job de provisioning.
 *
 *     · **daily_activity** — flags booleanos calculados sobre el
 *       `wallet_ledger` del usuario en la noche-business actual
 *       (`business_night(now())`).  El cliente los usa para pintar
 *       check verde en MissionsCard sin un round-trip extra.
 *
 *     · **reward_rules** — economía externalizada desde
 *       `tenant_token_rewards` (introducida en migración 08c).  El
 *       cliente la usa como source-of-truth de premios y costes en
 *       lugar de constantes hardcoded.
 *
 *     · **auth_email** propagado para que el frontend tenga el email
 *       sin tener que pedirlo dos veces a Supabase.
 */

type TierCode = "bronce" | "plata" | "oro" | "platino";

type DailyActivity = {
	ruleta_spin: boolean;
	tinder_swipe: boolean;
	tinder_completion: boolean;
	vote_track: boolean;
	jukebox_boost: boolean;
};

const DAILY_REASONS = new Map<string, keyof DailyActivity>([
	["ruleta_spin", "ruleta_spin"],
	["tinder_swipe", "tinder_swipe"],
	["history.tx_tinder", "tinder_completion"],
	["tinder_completion", "tinder_completion"],
	["vote_boost", "vote_track"],
	["vote_free", "vote_track"],
	["jukebox_boost", "jukebox_boost"],
]);

export async function loader({ request, context }: Route.LoaderArgs) {
	const cors = preflight(request);
	if (cors) return cors;

	if (request.method !== "GET") {
		return jsonResponse(
			{ ok: false, error: "method_not_allowed" },
			{ status: 405, request },
		);
	}

	const verified = await verifyAuthToken(request, context);
	if (!verified) {
		return jsonResponse(
			{ ok: false, error: "unauthorized" },
			{ status: 401, request },
		);
	}

	const slugResult = pickTenantSlug(null, request);
	if (!slugResult.ok) {
		return jsonResponse(
			{ ok: false, error: slugResult.error },
			{ status: 400, request },
		);
	}

	// Seguridad: el INSERT en `user_profiles` (JIT) y la lectura del
	// `wallet_ledger` para `daily_activity` DEBEN usar service_role.
	// La RLS de `user_profiles` exige que `current_tenant_id()` venga del
	// JWT — el JIT no puede usar la clave publishable porque entonces la
	// política bloquearía la creación del propio perfil que aún no existe.
	let supabase: ReturnType<typeof getServiceSupabase>;
	try {
		supabase = getServiceSupabase(context);
	} catch (err) {
		// TODO: CLEANUP AUTH VERIFY DEBUG
		console.error("[AUTH VERIFY] getServiceSupabase threw — falta SUPABASE_SECRET_KEY", {
			thrown: err instanceof Response ? `Response(${err.status})` : String(err),
		});
		if (err instanceof Response) return err;
		return jsonResponse(
			{ ok: false, error: "service_unavailable" },
			{ status: 503, request },
		);
	}

	// ── Tenant ────────────────────────────────────────────────────────
	const { data: tenant, error: tenantErr } = await supabase
		.from("tenants")
		.select("id")
		.eq("slug", slugResult.slug)
		.maybeSingle();
	if (tenantErr || !tenant) {
		return jsonResponse(
			{ ok: false, error: "unknown_tenant" },
			{ status: 404, request },
		);
	}
	const tenant_id = tenant.id as string;

	// ── Profile (JIT creation) ────────────────────────────────────────
	type ProfileRow = {
		id: string;
		token_balance: number;
		lifetime_earned: number;
		birth_date: string | null;
	};
	let profile: ProfileRow | null = null;
	// is_new_user: true SOLO cuando el JIT crea el perfil en esta llamada
	// (primer login de la vida).  El cliente lo usa para el modal one-shot
	// de bienvenida + los +100.  En llamadas posteriores el perfil ya existe
	// → false, así que el modal es naturalmente one-shot.
	let is_new_user = false;

	const { data: existing, error: profileErr } = await supabase
		.from("user_profiles")
		.select("id, token_balance, lifetime_earned, birth_date")
		.eq("tenant_id", tenant_id)
		.eq("auth_user_id", verified.id)
		.maybeSingle();
	if (profileErr) {
		console.warn("[api.session] profile lookup failed", profileErr.message);
		return jsonResponse(
			{ ok: false, error: "profile_lookup_failed" },
			{ status: 500, request },
		);
	}

	if (existing) {
		profile = {
			id: existing.id as string,
			token_balance: Number(existing.token_balance ?? 0),
			lifetime_earned: Number(existing.lifetime_earned ?? 0),
			birth_date: (existing.birth_date as string | null) ?? null,
		};
	} else {
		// JIT — creamos el perfil del recién llegado.  email viene del
		// JWT verificado; sin él dejamos string vacío (no rompe la fila
		// porque `email` es required pero el verificado siempre lo trae
		// en OAuth Google).
		const insertEmail = verified.email ?? `${verified.id}@anon.nightgraph`;
		const { data: created, error: insertErr } = await supabase
			.from("user_profiles")
			.insert({
				tenant_id,
				auth_user_id: verified.id,
				email: insertEmail,
				token_balance: 0,
				lifetime_earned: 0,
			})
			.select("id, token_balance, lifetime_earned, birth_date")
			.single();

		if (insertErr || !created) {
			console.warn(
				"[api.session] JIT profile create failed",
				insertErr?.message,
			);
			return jsonResponse(
				{
					ok: false,
					error: "profile_create_failed",
					detail: insertErr?.message,
				},
				{ status: 500, request },
			);
		}
		// Welcome bonus: tras crear el perfil llamamos al RPC
		// `grant_signup_bonus` (idempotente — si la fila ya tiene
		// `reason='signup_bonus'` en el ledger, no doble).  El amount
		// se lee de `tenant_token_rewards.signup_bonus` para que el
		// negocio pueda ajustarlo desde la BD sin redeploy.  El
		// trigger AFTER INSERT del ledger recalcula token_balance y
		// lifetime_earned, así que releemos el perfil para devolver
		// los valores reales en el bundle.
		try {
			const { error: bonusErr } = await supabase.rpc(
				"grant_signup_bonus",
				{ p_user_id: created.id },
			);
			if (bonusErr) {
				console.warn(
					"[api.session] grant_signup_bonus failed",
					bonusErr.message,
				);
			}
		} catch (err) {
			console.warn(
				"[api.session] grant_signup_bonus threw",
				err instanceof Error ? err.message : String(err),
			);
		}

		// Releer el perfil para capturar el balance tras el bonus.
		const { data: refreshed } = await supabase
			.from("user_profiles")
			.select("id, token_balance, lifetime_earned, birth_date")
			.eq("id", created.id)
			.maybeSingle();
		const finalProfile = refreshed ?? created;

		profile = {
			id: finalProfile.id as string,
			token_balance: Number(finalProfile.token_balance ?? 0),
			lifetime_earned: Number(finalProfile.lifetime_earned ?? 0),
			birth_date: (finalProfile.birth_date as string | null) ?? null,
		};
		is_new_user = true;
	}

	// ── Streak (semanas consecutivas, server-truth) ───────────────────
	let streak = 0;
	try {
		const { data: streakData } = await supabase.rpc("get_user_streak", {
			p_user_id: profile.id,
		});
		streak = Number(streakData ?? 0);
	} catch {
		streak = 0;
	}

	// ── Tier ──────────────────────────────────────────────────────────
	let tier: TierCode = "bronce";
	try {
		const { data: tierData } = await supabase.rpc("get_user_tier", {
			p_tenant_id: tenant_id,
			p_lifetime_earned: profile.lifetime_earned,
		});
		if (
			tierData === "bronce" ||
			tierData === "plata" ||
			tierData === "oro" ||
			tierData === "platino"
		) {
			tier = tierData;
		}
	} catch {
		/* fallback bronce */
	}

	// ── Active event ──────────────────────────────────────────────────
	// El cierre de eventos vencidos lo gestiona el cron (cada minuto); aquí
	// solo leemos el activo, sin RPC de mantenimiento en el camino crítico.
	let active_event: { id: string; name: string } | null = null;
	{
		const { data, error } = await supabase
			.from("tenant_events")
			.select("id, name")
			.eq("tenant_id", tenant_id)
			.eq("status", "active")
			.order("start_time", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (!error && data) {
			active_event = { id: data.id as string, name: data.name as string };
		}
	}

	// ── Daily activity (business_night actual) ────────────────────────
	const dailyActivity: DailyActivity = {
		ruleta_spin: false,
		tinder_swipe: false,
		tinder_completion: false,
		vote_track: false,
		jukebox_boost: false,
	};
	{
		// `business_night(now())` se evalúa en el server para mantener
		// timezone de Madrid coherente con el resto de validaciones.
		const { data: nightRow } = await supabase.rpc("business_night", {
			p_ts: new Date().toISOString(),
		});
		if (nightRow) {
			// Filtramos por rango temporal — un día business va de 06:00 a
			// 06:00 del siguiente, en Europe/Madrid.  Para simplificar el
			// filtro contra wallet_ledger usamos un rango UTC equivalente
			// a las últimas 30 horas (cubre la noche corriente cómodamente)
			// y luego deduplicamos en código.  Suficiente para piloto.
			const since = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
			const { data: rows } = await supabase
				.from("wallet_ledger")
				.select("reason, campaign_type, metadata, created_at")
				.eq("tenant_id", tenant_id)
				.eq("user_id", profile.id)
				.gte("created_at", since)
				.order("created_at", { ascending: false })
				.limit(50);
			if (rows) {
				for (const r of rows) {
					const code = String((r as { reason?: string }).reason ?? "");
					const key = DAILY_REASONS.get(code);
					if (key) dailyActivity[key] = true;
					// Tinder swipe-by-swipe no aparece en ledger (es voto, no
					// gasto).  Su huella vive en track_votes — leer aparte.
				}
			}
		}
	}

	// Tinder swipe (vote_track free) y livebattle vote no escriben en
	// wallet_ledger cuando no hay coste — derivamos su flag de
	// `track_votes`.
	if (active_event) {
		const since = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
		const { data: votes } = await supabase
			.from("track_votes")
			.select("vote_type, created_at")
			.eq("tenant_id", tenant_id)
			.eq("user_id", profile.id)
			.gte("created_at", since)
			.limit(20);
		if (votes && votes.length > 0) {
			dailyActivity.tinder_swipe = true;
			dailyActivity.vote_track = true;
			if (votes.some((v) => (v as { vote_type?: string }).vote_type === "boost")) {
				dailyActivity.jukebox_boost = true;
			}
		}
	}

	// ── Reward rules (economía externalizada) ─────────────────────────
	type RewardRule = { event_code: string; amount: number; description: string };
	let reward_rules: RewardRule[] = [];
	{
		const { data, error } = await supabase
			.from("tenant_token_rewards")
			.select("event_code, amount, description")
			.eq("tenant_id", tenant_id)
			.eq("is_active", true);
		if (!error && data) {
			reward_rules = data as unknown as RewardRule[];
		}
	}

	return jsonResponse(
		{
			ok: true,
			profile: {
				id: profile.id,
				token_balance: profile.token_balance,
				lifetime_earned: profile.lifetime_earned,
				birth_date: profile.birth_date,
			},
			auth_email: verified.email,
			active_event,
			tier,
			daily_activity: dailyActivity,
			reward_rules,
			streak,
			is_new_user,
		},
		{ request },
	);
}

/**
 * POST /api/session — actualiza campos del perfil del usuario autenticado.
 *
 *   Hoy: `birth_date` (captado en el onboarding, V1.7).  El user_id viene
 *   SIEMPRE del JWT verificado, nunca del body.  Escribe con service_role
 *   acotado por tenant_id + auth_user_id.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const cors = preflight(request);
	if (cors) return cors;

	if (request.method !== "POST") {
		return jsonResponse(
			{ ok: false, error: "method_not_allowed" },
			{ status: 405, request },
		);
	}

	const verified = await verifyAuthToken(request, context);
	if (!verified) {
		return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401, request });
	}

	let body: { tenant_slug?: string; birth_date?: string };
	try {
		body = (await request.json()) as { tenant_slug?: string; birth_date?: string };
	} catch {
		return jsonResponse({ ok: false, error: "invalid_json" }, { status: 400, request });
	}

	// Validación estricta de la fecha: formato YYYY-MM-DD, real y razonable
	// (no futuro, no antes de 1900, +18 recomendado pero no bloqueante aquí).
	const birth = String(body.birth_date ?? "").trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) {
		return jsonResponse({ ok: false, error: "invalid_birth_date" }, { status: 400, request });
	}
	const parsed = new Date(`${birth}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime()) || parsed > new Date() || parsed.getUTCFullYear() < 1900) {
		return jsonResponse({ ok: false, error: "invalid_birth_date" }, { status: 400, request });
	}

	// Control de edad +18 EXACTO (mes/día incluidos) — el backend es la
	// autoridad final: aunque el cliente lo saltara, aquí se frena.  Cutoff =
	// la fecha de nacimiento más reciente que ya cumple 18 hoy; nacer DESPUÉS
	// de esa fecha = menor.
	const today = new Date();
	const cutoff = new Date(
		Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()),
	);
	if (parsed.getTime() > cutoff.getTime()) {
		return jsonResponse({ ok: false, error: "under_18" }, { status: 400, request });
	}

	const slugResult = pickTenantSlug(body.tenant_slug ?? null, request);
	if (!slugResult.ok) {
		return jsonResponse({ ok: false, error: slugResult.error }, { status: 400, request });
	}

	let supabase: ReturnType<typeof getServiceSupabase>;
	try {
		supabase = getServiceSupabase(context);
	} catch (err) {
		if (err instanceof Response) return err;
		return jsonResponse({ ok: false, error: "service_unavailable" }, { status: 503, request });
	}

	const { data: tenant } = await supabase
		.from("tenants")
		.select("id")
		.eq("slug", slugResult.slug)
		.maybeSingle();
	if (!tenant) {
		return jsonResponse({ ok: false, error: "unknown_tenant" }, { status: 404, request });
	}

	const { error } = await supabase
		.from("user_profiles")
		.update({ birth_date: birth })
		.eq("tenant_id", tenant.id as string)
		.eq("auth_user_id", verified.id);
	if (error) {
		console.warn("[api.session] birth_date update failed", error.message);
		return jsonResponse({ ok: false, error: "update_failed", detail: error.message }, { status: 500, request });
	}

	return jsonResponse({ ok: true, birth_date: birth }, { request });
}
