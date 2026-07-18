import type { Route } from "./+types/api.checkin";
import {
	corsHeaders,
	jsonResponse,
	preflight,
	verifyAuthToken,
} from "../lib/api.server";
import { getServiceSupabase } from "../lib/supabase.server";
import {
	pickTenantSlug,
	resolveOrCreateTenantProfile,
} from "../lib/tenant-resolver.server";

/**
 * POST /api/checkin  — procesa un escaneo de QR físico.
 *
 *   Body: { code: string, tenant_slug? }
 *
 *   - JWT obligatorio: la visita y la recompensa se atribuyen al perfil
 *     verificado (nunca al body).
 *   - Toda la lógica vive en el RPC `process_checkin` (service_role):
 *     valida el QR contra `qr_strategies`, registra `venue_visits`,
 *     concede la recompensa vía `claim_gamification_reward` (respeta
 *     límite diario) y calcula racha + hito.
 *   - Devuelve { ok, qr_label, reward_amount, balance, streak,
 *     milestone_week, milestone_amount } para que el cliente pinte la
 *     celebración (pop-up de hito) y reconcilie el saldo.
 */

type CheckinBody = { code?: string; tenant_slug?: string };

export async function action({ request, context }: Route.ActionArgs) {
	const cors = preflight(request);
	if (cors) return cors;

	if (request.method !== "POST") {
		return jsonResponse(
			{ ok: false, error: "method_not_allowed" },
			{ status: 405, request },
		);
	}

	let verifiedId: string | null = null;
	let verifiedEmail: string | null = null;
	try {
		const verified = await verifyAuthToken(request, context);
		verifiedId = verified?.id ?? null;
		verifiedEmail = verified?.email ?? null;
	} catch {
		verifiedId = null;
	}
	if (!verifiedId) {
		return jsonResponse(
			{ ok: false, error: "unauthorized" },
			{ status: 401, request },
		);
	}

	let body: CheckinBody;
	try {
		body = (await request.json()) as CheckinBody;
	} catch {
		return jsonResponse(
			{ ok: false, error: "invalid_json" },
			{ status: 400, request },
		);
	}

	const code = String(body.code ?? "").trim().slice(0, 64);
	if (!code) {
		return jsonResponse(
			{ ok: false, error: "code_required" },
			{ status: 400, request },
		);
	}

	const slugResult = pickTenantSlug(body.tenant_slug, request);
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

	// JIT: si es su primer login con Google, el perfil puede no existir todavía
	// (lo crea /api/session en paralelo).  Lo creamos aquí si hace falta para
	// que el check-in nunca se pierda por llegar antes de tiempo.
	const profileResult = await resolveOrCreateTenantProfile(
		supabase,
		slugResult.slug,
		verifiedId,
		verifiedEmail,
	);
	if (!profileResult.ok) {
		return jsonResponse(
			{ ok: false, error: profileResult.error },
			{ status: 404, request },
		);
	}
	const { user_profile_id } = profileResult.data;

	const { data, error } = await supabase.rpc("process_checkin", {
		p_user_id: user_profile_id,
		p_qr_code: code,
	});

	if (error) {
		console.warn("[api.checkin] process_checkin rpc failed", error.message);
		return jsonResponse(
			{ ok: false, error: "rpc_failed", detail: error.message },
			{ status: 500, request },
		);
	}

	const payload = (data ?? {}) as { ok?: boolean; error?: string };
	if (payload.ok === false) {
		const status =
			payload.error === "already_checked_in"
				? 409
				: payload.error === "invalid_qr"
					? 404
					: 400;
		return jsonResponse(payload, { status, request });
	}

	return jsonResponse(payload, { request });
}

export function loader({ request }: Route.LoaderArgs) {
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
