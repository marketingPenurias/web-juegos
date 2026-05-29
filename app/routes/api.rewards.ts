import type { Route } from "./+types/api.rewards";
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
import type {
	PurchaseRewardReturn,
	RewardRequest,
	StartRedemptionReturn,
} from "../types/database";

/**
 * POST /api/rewards
 *
 *   Body (discriminated union):
 *     { action_type: "purchase", product_id: uuid, event_id?: uuid,
 *       tenant_slug?: string }
 *     { action_type: "redeem",   reward_id:  uuid, tenant_slug?: string }
 *
 *   Contract
 *   ─────────────────────────────────────────────────────────────────
 *   - JWT REQUIRED.  401 otherwise.
 *   - The Edge worker NEVER inserts directly into wallet_ledger or
 *     user_rewards from this route.  All side effects flow through the
 *     locked-down SECURITY DEFINER RPCs:
 *
 *       purchase_reward(p_tenant_id, p_user_id, p_product_id, p_event_id)
 *         → atomic price snapshot + ledger debit + reward creation.
 *
 *       start_reward_redemption(p_tenant_id, p_user_id, p_reward_id)
 *         → flips status to 'redeeming' with a 5-minute expires_at.
 *
 *   - Both RPCs are revoked from public/anon/authenticated and granted
 *     only to service_role (see database/03_secure_rpc.sql for the
 *     pattern), so the SECRET-key client is the ONLY valid caller.
 */

function isReward(body: unknown): body is RewardRequest {
	if (!body || typeof body !== "object") return false;
	const b = body as { action_type?: unknown };
	return b.action_type === "purchase" || b.action_type === "redeem";
}

export async function action({ request, context }: Route.ActionArgs) {
	const cors = preflight(request);
	if (cors) return cors;

	if (request.method !== "POST") {
		return jsonResponse(
			{ ok: false, error: "method_not_allowed" },
			{ status: 405, request },
		);
	}

	// ── Auth ──────────────────────────────────────────────────────────
	const verified = await verifyAuthToken(request, context);
	if (!verified) {
		return jsonResponse(
			{ ok: false, error: "unauthorized" },
			{ status: 401, request },
		);
	}

	// ── Body ──────────────────────────────────────────────────────────
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return jsonResponse(
			{ ok: false, error: "invalid_json" },
			{ status: 400, request },
		);
	}
	if (!isReward(body)) {
		return jsonResponse(
			{ ok: false, error: "invalid_action_type" },
			{ status: 400, request },
		);
	}

	// ── Tenant resolution (strict) ────────────────────────────────────
	const slugResult = pickTenantSlug(body.tenant_slug, request);
	if (!slugResult.ok) {
		return jsonResponse(
			{ ok: false, error: slugResult.error },
			{ status: 400, request },
		);
	}

	// ── Service-role client (RPC lockdown requires it) ────────────────
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
		const status = profileResult.error === "unknown_tenant" ? 404 : 404;
		return jsonResponse(
			{ ok: false, error: profileResult.error },
			{ status, request },
		);
	}
	const { tenant_id, user_profile_id } = profileResult.data;

	// ── Dispatch ──────────────────────────────────────────────────────
	try {
		if (body.action_type === "purchase") {
			if (!body.product_id) {
				return jsonResponse(
					{ ok: false, error: "product_id_required" },
					{ status: 400, request },
				);
			}

			const { data, error } = await supabase.rpc("purchase_reward", {
				p_tenant_id: tenant_id,
				p_user_id: user_profile_id,
				p_product_id: body.product_id,
				p_event_id: body.event_id ?? null,
			});

			if (error) {
				const msg = (error.message || "").toLowerCase();
				const detail = error.message;
				// Orden: matches más específicos primero.  Las RAISE
				// EXCEPTION del RPC `purchase_reward` cubren 8 escenarios
				// distintos; cada uno se traduce a un código accionable
				// + status HTTP para que el cliente decida qué toast
				// mostrar (saldo, día, nivel, límite, etc.) en lugar de
				// caer todo a un 500 genérico.
				if (msg.includes("saldo")) {
					return jsonResponse(
						{ ok: false, error: "insufficient_funds", detail },
						{ status: 400, request },
					);
				}
				if (msg.includes("perfil")) {
					return jsonResponse(
						{ ok: false, error: "profile_not_found", detail },
						{ status: 404, request },
					);
				}
				if (msg.includes("nivel insuficiente")) {
					return jsonResponse(
						{ ok: false, error: "tier_required", detail },
						{ status: 403, request },
					);
				}
				if (msg.includes("no disponible hoy")) {
					return jsonResponse(
						{ ok: false, error: "product_wrong_day", detail },
						{ status: 400, request },
					);
				}
				if (msg.includes("límite por noche") || msg.includes("limite por noche")) {
					return jsonResponse(
						{ ok: false, error: "night_limit_reached", detail },
						{ status: 429, request },
					);
				}
				if (msg.includes("límite semanal") || msg.includes("limite semanal")) {
					return jsonResponse(
						{ ok: false, error: "week_limit_reached", detail },
						{ status: 429, request },
					);
				}
				if (msg.includes("límite mensual") || msg.includes("limite mensual")) {
					return jsonResponse(
						{ ok: false, error: "month_limit_reached", detail },
						{ status: 429, request },
					);
				}
				if (msg.includes("producto")) {
					return jsonResponse(
						{ ok: false, error: "product_unavailable", detail },
						{ status: 404, request },
					);
				}
				console.warn("[api.rewards] purchase_reward error", error.message);
				return jsonResponse(
					{ ok: false, error: "rpc_failed", detail },
					{ status: 500, request },
				);
			}

			const payload = data as PurchaseRewardReturn;
			return jsonResponse(
				{
					ok: true,
					action_type: "purchase",
					reward_id: payload?.reward_id,
					balance: payload?.new_balance,
				},
				{ request },
			);
		}

		if (body.action_type === "redeem") {
			if (!body.reward_id) {
				return jsonResponse(
					{ ok: false, error: "reward_id_required" },
					{ status: 400, request },
				);
			}

			const { data, error } = await supabase.rpc("start_reward_redemption", {
				p_tenant_id: tenant_id,
				p_user_id: user_profile_id,
				p_reward_id: body.reward_id,
			});

			if (error) {
				const msg = (error.message || "").toLowerCase();
				if (
					msg.includes("no válida") ||
					msg.includes("ya canjeada") ||
					msg.includes("expirada")
				) {
					return jsonResponse(
						{ ok: false, error: "reward_unavailable" },
						{ status: 409, request },
					);
				}
				console.warn(
					"[api.rewards] start_reward_redemption error",
					error.message,
				);
				return jsonResponse(
					{ ok: false, error: "rpc_failed", detail: error.message },
					{ status: 500, request },
				);
			}

			const payload = data as StartRedemptionReturn;
			return jsonResponse(
				{
					ok: true,
					action_type: "redeem",
					reward_id: body.reward_id,
					expires_at: payload?.expires_at,
				},
				{ request },
			);
		}

		return jsonResponse(
			{ ok: false, error: "invalid_action_type" },
			{ status: 400, request },
		);
	} catch (err) {
		console.error("[api.rewards] unexpected", err);
		return jsonResponse(
			{ ok: false, error: "internal_error" },
			{ status: 500, request },
		);
	}
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
