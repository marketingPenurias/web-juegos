import type { AppLoadContext } from "react-router";
import { jsonResponse, preflight, verifyAuthToken } from "./api.server";
import { getServiceSupabase } from "./supabase.server";
import { hasTenantRole, pickTenantSlug } from "./tenant-resolver.server";

/**
 * Handler de `POST /api/tv` — hidratación del Jumbotron `/tv/dashboard`.
 *
 *   Por qué existe (Sprint V1.6 · A2):
 *     `/tv/dashboard` autenticaba por COOKIE (`requireTenantRole`), pero el
 *     login del SPA persiste en localStorage y NO escribe cookie → el loader
 *     server no encontraba sesión y escupía 401.  Alineamos la TV con
 *     `/admin`: gating en cliente + endpoint autenticado por Bearer.
 *
 *   Seguridad (igual que admin-handler):
 *     · JWT obligatorio (actor = auth uid del JWT, nunca del body).
 *     · Autorización por rol `display` o `admin` en este tenant.
 *
 *   Devuelve el mismo shape que el viejo loader `loadTvDashboard`:
 *     { ok, tenant_id, event_id, tracks, battle }
 */

type TvBody = { tenant_slug?: string };

type TvTrack = {
	id: string;
	title: string;
	artist: string;
	cover_image_url: string | null;
	total_votes: number;
	is_played: boolean;
};

export async function handleTvAction(
	request: Request,
	context: AppLoadContext,
): Promise<Response> {
	const cors = preflight(request);
	if (cors) return cors;

	if (request.method !== "POST") {
		return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405, request });
	}

	let verifiedId: string | null = null;
	try {
		const verified = await verifyAuthToken(request, context);
		verifiedId = verified?.id ?? null;
	} catch {
		verifiedId = null;
	}
	if (!verifiedId) {
		return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401, request });
	}

	let body: TvBody;
	try {
		body = (await request.json().catch(() => ({}))) as TvBody;
	} catch {
		body = {};
	}

	const slugResult = pickTenantSlug(body.tenant_slug, request);
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

	// Tenant
	const { data: tenant } = await supabase
		.from("tenants")
		.select("id")
		.eq("slug", slugResult.slug)
		.maybeSingle();
	if (!tenant) {
		return jsonResponse({ ok: false, error: "unknown_tenant" }, { status: 404, request });
	}
	const tenant_id = tenant.id as string;

	// ¿Rol display o admin?  (gate de la TV)
	const isDisplay = await hasTenantRole(supabase, tenant_id, verifiedId, "display");
	const isAdmin = isDisplay ? false : await hasTenantRole(supabase, tenant_id, verifiedId, "admin");
	if (!isDisplay && !isAdmin) {
		return jsonResponse({ ok: false, error: "forbidden" }, { status: 403, request });
	}

	// Evento activo (acepta también 'draft', igual que el viejo loader).
	// El cierre de eventos vencidos lo hace el cron (cada minuto), no aquí.
	const { data: activeEvent } = await supabase
		.from("tenant_events")
		.select("id, status, metadata")
		.eq("tenant_id", tenant_id)
		.in("status", ["active", "draft"])
		.order("start_time", { ascending: false })
		.limit(1)
		.maybeSingle();

	const event_id = (activeEvent?.id as string | undefined) ?? null;

	// Preferencia de fondo de la TV (control remoto del Staff).  Default
	// carrusel automático si no se ha fijado nada.
	const meta = (activeEvent?.metadata as Record<string, unknown> | null) ?? null;
	const rawBackdrop = (meta?.tv_backdrop ?? null) as
		| { mode?: string; url?: string | null; showRanking?: boolean; showBattle?: boolean; showNowPlaying?: boolean }
		| null;
	const bm = rawBackdrop?.mode;
	const backdrop = {
		mode: bm === "video" || bm === "photo" ? bm : "carousel",
		url: typeof rawBackdrop?.url === "string" ? rawBackdrop.url : null,
		showRanking: rawBackdrop?.showRanking !== false, // default true
		showBattle: rawBackdrop?.showBattle !== false, // default true
		showNowPlaying: rawBackdrop?.showNowPlaying === true, // default false
	};

	// V20 · FASE 1 — Nunca más tragarse un error.  Antes cada query hacía
	// `const { data } = await …` y descartaba el error, así que un fallo de
	// permisos se veía como "no hay datos" (así estuvo semanas roto el QR de
	// check-in).  Ahora acumulamos avisos y los devolvemos al cliente.
	const warnings: string[] = [];
	const warn = (scope: string, message?: string) => {
		const msg = `[api.tv] ${scope}: ${message ?? "unknown error"}`;
		console.warn(msg);
		warnings.push(scope);
	};

	// V18: código del QR de CHECK-IN de entrada.  El QR del jumbotron deja de
	// ser sólo atribución y pasa a registrar la visita (venue_visits) → de ahí
	// salen el KPI de check-ins y la racha de fidelidad semanal.  Se resuelve
	// por tenant (nada hardcodeado); si el local no tiene QR de entrada, el
	// cliente cae al enlace de captación de siempre.
	const { data: qrEntrada, error: qrErr } = await supabase
		.from("qr_strategies")
		.select("code")
		.eq("tenant_id", tenant_id)
		.eq("kind", "entrada")
		.eq("is_active", true)
		.limit(1)
		.maybeSingle();
	if (qrErr) warn("qr_strategies", qrErr.message);
	const checkin_code = (qrEntrada?.code as string | undefined) ?? null;

	let tracks: TvTrack[] = [];
	let nowPlaying: TvTrack | null = null;
	let battle: { id: string; ends_at: string; a: TvTrack; b: TvTrack } | null = null;

	if (event_id) {
		// V20 · Ranking visible = RPC `tv_ranking` (regla ÚNICA, ver migración
		// 25): sólo temas con votos, fuera el que suena, y los ya sonados vuelven
		// sólo si los re-votan o pasadas 2h.  Va en SQL porque compara dos
		// columnas (last_vote_at > played_at), algo que PostgREST no expresa.
		const { data, error: tracksErr } = await supabase.rpc("tv_ranking", {
			p_event_id: event_id,
			p_limit: 10,
		});
		if (tracksErr) warn("tv_ranking", tracksErr.message);
		tracks = (data ?? []) as TvTrack[];

		// Canción actual (para el split view).  spotify_id incluido para el
		// enlace, aunque en la TV normalmente no se usa.
		const { data: np, error: npErr } = await supabase
			.from("event_tracks")
			.select("id, title, artist, cover_image_url, total_votes, is_played")
			.eq("tenant_id", tenant_id)
			.eq("event_id", event_id)
			.eq("is_played", true)
			.limit(1)
			.maybeSingle();
		if (npErr) warn("now_playing", npErr.message);
		nowPlaying = (np as TvTrack) ?? null;

		// Batalla viva (si la hay) → resolvemos las dos canciones para arrancar
		// directamente en modo DUELO sin esperar al WebSocket.
		const { data: b, error: bErr } = await supabase
			.from("live_battles")
			.select("id, track_a, track_b, ends_at")
			.eq("tenant_id", tenant_id)
			.eq("event_id", event_id)
			.eq("status", "live")
			.order("started_at", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (bErr) warn("live_battles", bErr.message);

		if (b?.id) {
			const { data: bt } = await supabase
				.from("event_tracks")
				.select("id, title, artist, cover_image_url, total_votes, is_played")
				.in("id", [b.track_a as string, b.track_b as string]);
			const rows = (bt ?? []) as TvTrack[];
			const a = rows.find((r) => r.id === b.track_a);
			const bb = rows.find((r) => r.id === b.track_b);
			if (a && bb) {
				battle = { id: b.id as string, ends_at: b.ends_at as string, a, b: bb };
			}
		}
	}

	return jsonResponse(
		{
			ok: true, tenant_id, event_id, tracks, nowPlaying, battle, backdrop,
			checkin_code,
			// Vacío = todo bien.  Con contenido, la TV puede avisar en pantalla en
			// vez de fingir que "no hay datos" (F1).
			warnings,
		},
		{ request },
	);
}
