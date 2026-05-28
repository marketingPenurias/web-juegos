import type { Route } from "./+types/api.session";
import {
	corsHeaders,
	jsonResponse,
	preflight,
	verifyAuthToken,
} from "../lib/api.server";
import { getServiceSupabase } from "../lib/supabase.server";
import {
	pickTenantSlug,
	resolveTenantProfile,
} from "../lib/tenant-resolver.server";

/**
 * GET /api/session
 *
 *   Devuelve el "bundle" mínimo necesario para arrancar la UI del
 *   piloto en un único round-trip:
 *
 *     {
 *       ok: true,
 *       profile: { id, token_balance, lifetime_earned },
 *       active_event: { id, name } | null,
 *       tier: 'bronce' | 'plata' | 'oro' | 'platino'
 *     }
 *
 *   Diseño:
 *     - JWT obligatorio (401 en otro caso) — la sesión es PII.
 *     - Tenant strict (slug en query / header / hostname).
 *     - El tier se calcula contra `tenant_tier_thresholds` (RPC
 *       `get_user_tier`) para que el frontend no tenga que conocer
 *       los umbrales — Fase 2 lo expandirá a un snapshot completo.
 *     - active_event = el evento más reciente con status='active'
 *       (la UI lo necesita ANTES de montar el WebSocket de Tinder
 *       Musical, para no suscribirse a null).
 *
 *   Fuera de alcance piloto:
 *     - cookie-based SSR session (Fase 2 con bootstrap_session RPC).
 *     - tier maintenance status (downgrade temporal Platino).
 */

type ActiveEvent = { id: string; name: string } | null;

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

	let supabase: ReturnType<typeof getServiceSupabase>;
	try {
		supabase = getServiceSupabase(context);
	} catch (err) {
		if (err instanceof Response) return err;
		return jsonResponse(
			{ ok: false, error: "service_unavailable" },
			{ status: 503, request },
		);
	}

	const profileResult = await resolveTenantProfile(
		supabase,
		slugResult.slug,
		verified.id,
	);
	if (!profileResult.ok) {
		return jsonResponse(
			{ ok: false, error: profileResult.error },
			{ status: 404, request },
		);
	}

	const { tenant_id, user_profile_id, token_balance, lifetime_earned } =
		profileResult.data;

	// ── Tier vía RPC server-side ──────────────────────────────────────
	// Si falla por cualquier razón (RPC nueva sin permiso, etc.) caemos
	// silenciosamente a 'bronce' — para el piloto la UI fuerza Bronce
	// igualmente, así que no rompemos nada visible.
	let tier: "bronce" | "plata" | "oro" | "platino" = "bronce";
	try {
		const { data: tierData } = await supabase.rpc("get_user_tier", {
			p_tenant_id: tenant_id,
			p_lifetime_earned: lifetime_earned,
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
		/* swallow — bronce fallback */
	}

	// ── Evento activo (el último creado por start_time) ───────────────
	let active_event: ActiveEvent = null;
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

	return jsonResponse(
		{
			ok: true,
			profile: {
				id: user_profile_id,
				token_balance,
				lifetime_earned,
			},
			active_event,
			tier,
		},
		{ request },
	);
}

export function action({ request }: Route.ActionArgs) {
	const cors = preflight(request);
	if (cors) return cors;
	return new Response(
		JSON.stringify({ ok: false, error: "method_not_allowed" }),
		{
			status: 405,
			headers: {
				"Content-Type": "application/json",
				...corsHeaders(request.headers.get("origin")),
			},
		},
	);
}
