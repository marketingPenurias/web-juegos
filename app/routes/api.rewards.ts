import type { Route } from "./+types/api.rewards";
import {
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
	CompleteRedemptionReturn,
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
	return (
		b.action_type === "purchase" ||
		b.action_type === "redeem" ||
		b.action_type === "consume"
	);
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
				const detail = error.message;
				// `purchase_reward` marca cada motivo de rechazo con su propio
				// SQLSTATE, así que el mapeo es por CÓDIGO y no por el texto del
				// mensaje: reescribir el copy en español ya no rompe nada.
				const BY_CODE: Record<string, { error: string; status: number }> = {
					NG001: { error: "insufficient_funds", status: 400 },
					NG002: { error: "profile_not_found", status: 404 },
					NG003: { error: "product_unavailable", status: 409 },
					NG004: { error: "promo_sold_out", status: 409 },
					NG005: { error: "night_limit_reached", status: 429 },
					NG006: { error: "night_limit_reached", status: 429 },
					NG007: { error: "week_limit_reached", status: 429 },
					NG008: { error: "product_unavailable", status: 404 },
				};
				const mapped = BY_CODE[(error as { code?: string }).code ?? ""];
				if (mapped) {
					return jsonResponse(
						{ ok: false, error: mapped.error, detail },
						{ status: mapped.status, request },
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

		if (body.action_type === "consume") {
			// Consumo REAL del ticket (anti-fraude).  El RPC
			// `complete_redemption` marca el reward 'consumed' de forma
			// atómica e idempotente.  El cliente sólo muestra la animación
			// de "quemado" si esta respuesta es ok:true (200).
			if (!body.reward_id) {
				return jsonResponse(
					{ ok: false, error: "reward_id_required" },
					{ status: 400, request },
				);
			}

			const { data, error } = await supabase.rpc("complete_redemption", {
				p_tenant_id: tenant_id,
				p_user_id: user_profile_id,
				p_reward_id: body.reward_id,
			});

			if (error) {
				console.warn(
					"[api.rewards] complete_redemption error",
					error.message,
				);
				return jsonResponse(
					{ ok: false, error: "rpc_failed", detail: error.message },
					{ status: 500, request },
				);
			}

			const payload = (data ?? {}) as CompleteRedemptionReturn;
			if (payload.ok === false) {
				// Idempotencia: un ticket ya consumido (doble-tap, reintento)
				// devuelve 409 — la UI lo trata como "ya quemado".  El resto
				// (reward_not_found / not_redeeming) → 409 también: el ticket
				// no está en un estado quemable.
				return jsonResponse(
					{ ok: false, error: payload.error ?? "consume_failed" },
					{ status: 409, request },
				);
			}

			return jsonResponse(
				{
					ok: true,
					action_type: "consume",
					reward_id: body.reward_id,
					consumed_at: payload.consumed_at,
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

/**
 * GET /api/rewards  — "Mis Tickets".
 *
 *   Lista los rewards del usuario que aún puede enseñar en barra
 *   (`status` en `available` | `redeeming`), con el snapshot del producto
 *   para pintar nombre + precio €.  Sólo SELECT; el canje real sigue
 *   yendo por el RPC `start_reward_redemption` (action `redeem`).
 */
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
	const { tenant_id, user_profile_id } = profileResult.data;

	const { data, error } = await supabase
		.from("user_rewards")
		.select(
			"id, status, expires_at, created_at, discount_eur, campaign_code, " +
				"product:tenant_products(name, list_price_eur, promo_price_eur)",
		)
		.eq("tenant_id", tenant_id)
		.eq("user_id", user_profile_id)
		.in("status", ["available", "redeeming"])
		.order("created_at", { ascending: false })
		.limit(50);

	if (error) {
		console.warn("[api.rewards] list lookup failed", error.message);
		return jsonResponse(
			{ ok: false, error: "lookup_failed" },
			{ status: 500, request },
		);
	}

	type ProductEmbed = {
		name: string;
		list_price_eur: number | null;
		promo_price_eur: number | null;
	};
	type Joined = {
		id: string;
		status: string;
		expires_at: string | null;
		created_at: string;
		discount_eur: number | null;
		campaign_code: string | null;
		product: ProductEmbed | ProductEmbed[] | null;
	};

	const rows = ((data ?? []) as unknown as Joined[]).map((r) => {
		// El embed to-one puede llegar como objeto o array de 1 según el cliente.
		const p = Array.isArray(r.product) ? r.product[0] : r.product;
		// Lo que el camarero tiene que cobrar es lo que se pactó EN LA COMPRA:
		// precio de barra menos el descuento que se llevó ese canje.  Leerlo del
		// producto daría un importe equivocado en cuanto una campaña hubiera
		// aplicado un precio distinto o la sala cambiara la carta después.
		const list = Number(p?.list_price_eur ?? 0);
		const priceEur =
			r.discount_eur !== null
				? Math.max(0, list - Number(r.discount_eur))
				: Number(p?.promo_price_eur ?? 0);
		return {
			id: r.id,
			status: r.status,
			expires_at: r.expires_at,
			created_at: r.created_at,
			product_name: p?.name ?? "Recompensa",
			price_eur: priceEur,
			campaign_code: r.campaign_code,
		};
	});

	return jsonResponse({ ok: true, rows }, { request });
}
