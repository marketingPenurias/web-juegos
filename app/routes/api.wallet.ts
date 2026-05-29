import type { Route } from "./+types/api.wallet";
import {
	corsHeaders,
	jsonResponse,
	preflight,
	verifyAuthToken,
} from "../lib/api.server";
import { getServiceSupabase } from "../lib/supabase.server";
import { extractSlugFromHost } from "../lib/tenant";

/**
 * POST /api/wallet  — strict financial transactions.
 *
 *   Body: { tenant_slug?, amount: number, reason: string,
 *           metadata?: object }
 *
 *   - JWT REQUIRED.  No anon access — overdraft / fraud risk.
 *   - user_id ALWAYS comes from the verified JWT, never from the body.
 *   - Tenant resolution is STRICT: payload `tenant_slug` → `X-Tenant-
 *     Slug` header → hostname.  No fallback.  Missing → 400.
 *   - Spend (amount < 0): atomic SQL RPC `spend_tokens` (SELECT FOR
 *     UPDATE + insert in one transaction).  NULL response → 400
 *     insufficient_funds.
 *   - Earn (amount > 0): direct insert; the trigger updates the
 *     read-side projection.
 *   - Returns the new balance on success.
 */

const MIN_AMOUNT = -10_000;
const MAX_AMOUNT = 10_000;

type WalletRequest = {
	tenant_slug?: string;
	amount?: number;
	reason?: string;
	metadata?: Record<string, unknown> | null;
	// Modo CLAIM (server-authoritative): cuando viene `event_code`, el
	// amount lo decide el RPC `claim_gamification_reward` leyendo
	// `tenant_token_rewards` + límite diario.  El cliente NO manda amount.
	event_code?: string;
	event_id?: string;
};

function pickWalletSlug(
	bodySlug: string | undefined,
	headerSlug: string | null,
	hostSlug: string | null,
): string | null {
	const raw = bodySlug || headerSlug || hostSlug;
	if (!raw) return null;
	const cleaned = String(raw).trim().toLowerCase().slice(0, 64);
	return cleaned || null;
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

	// JWT is mandatory for wallet writes.
	const verified = await verifyAuthToken(request, context);
	if (!verified) {
		return jsonResponse(
			{ ok: false, error: "unauthorized" },
			{ status: 401, request },
		);
	}

	let body: WalletRequest;
	try {
		body = (await request.json()) as WalletRequest;
	} catch {
		return jsonResponse(
			{ ok: false, error: "invalid_json" },
			{ status: 400, request },
		);
	}

	const eventCode = String(body.event_code ?? "").trim().slice(0, 64);
	const isClaim = eventCode.length > 0;

	const amount = Number.isFinite(body.amount) ? Math.trunc(body.amount!) : NaN;
	const reason = String(body.reason ?? "").trim().slice(0, 64);

	// La validación de amount/reason sólo aplica al modo legacy (earn/spend
	// directo).  En modo CLAIM el amount lo resuelve el RPC server-side.
	if (!isClaim) {
		if (!Number.isInteger(amount) || amount === 0) {
			return jsonResponse(
				{ ok: false, error: "invalid_amount" },
				{ status: 400, request },
			);
		}
		if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
			return jsonResponse(
				{
					ok: false,
					error: "amount_out_of_range",
					min: MIN_AMOUNT,
					max: MAX_AMOUNT,
				},
				{ status: 400, request },
			);
		}
		if (!reason) {
			return jsonResponse(
				{ ok: false, error: "reason_required" },
				{ status: 400, request },
			);
		}
	}

	// Strict multi-tenant resolution — no defaults.
	const headerSlug = request.headers.get("x-tenant-slug");
	const hostSlug = (() => {
		try {
			return extractSlugFromHost(new URL(request.url).hostname) || null;
		} catch {
			return null;
		}
	})();
	const slug = pickWalletSlug(body.tenant_slug, headerSlug, hostSlug);
	if (!slug) {
		return jsonResponse(
			{ ok: false, error: "missing_tenant" },
			{ status: 400, request },
		);
	}

	// Wallet writes ALWAYS go through the service-role client.  The
	// `spend_tokens` RPC is locked down to service_role only (see
	// database/03_secure_rpc.sql) so a stray anon-key call would fail
	// — better to surface a clear 503 here when it isn't configured.
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

	// Resolve tenant + caller's profile.  Both are read-only and safe
	// under RLS with the service role key.
	const { data: tenant, error: tenantErr } = await supabase
		.from("tenants")
		.select("id")
		.eq("slug", slug)
		.maybeSingle();

	if (tenantErr || !tenant) {
		return jsonResponse(
			{ ok: false, error: "unknown_tenant" },
			{ status: 404, request },
		);
	}
	const tenant_id = tenant.id as string;

	const { data: profile, error: profileErr } = await supabase
		.from("user_profiles")
		.select("id, token_balance, lifetime_earned")
		.eq("tenant_id", tenant_id)
		.eq("auth_user_id", verified.id)
		.maybeSingle();

	if (profileErr) {
		console.warn("[api.wallet] profile lookup failed", profileErr.message);
		return jsonResponse(
			{ ok: false, error: "profile_lookup_failed" },
			{ status: 500, request },
		);
	}
	if (!profile) {
		return jsonResponse(
			{ ok: false, error: "profile_not_found" },
			{ status: 404, request },
		);
	}

	const userProfileId = profile.id as string;
	const currentBalance = Number(profile.token_balance ?? 0);

	// ── CLAIM PATH (server-authoritative) ─────────────────────────────
	// El RPC lee el premio de `tenant_token_rewards`, valida el límite
	// diario por `business_night` e inserta el ingreso de forma atómica.
	// Devuelve SIEMPRE el balance autoritativo para que la UI optimista
	// pueda reconciliarse (éxito) o corregirse (límite alcanzado).
	if (isClaim) {
		const { data: claim, error: claimErr } = await supabase.rpc(
			"claim_gamification_reward",
			{
				p_user_id: userProfileId,
				p_event_code: eventCode,
				p_event_id: typeof body.event_id === "string" ? body.event_id : null,
			},
		);
		if (claimErr) {
			console.warn("[api.wallet] claim rpc failed", claimErr.message);
			return jsonResponse(
				{ ok: false, error: "rpc_failed", detail: claimErr.message },
				{ status: 500, request },
			);
		}
		const payload = (claim ?? {}) as {
			ok?: boolean;
			error?: string;
			amount?: number;
			balance?: number;
			lifetime_earned?: number;
		};
		if (payload.ok === false) {
			// 409 para límite diario (la UI lo trata como "ya reclamado hoy").
			const status =
				payload.error === "daily_limit_reached" ? 409 : 400;
			return jsonResponse(
				{
					ok: false,
					error: payload.error ?? "claim_failed",
					balance: Number(payload.balance ?? currentBalance),
				},
				{ status, request },
			);
		}
		return jsonResponse(
			{
				ok: true,
				event_code: eventCode,
				amount: Number(payload.amount ?? 0),
				balance: Number(payload.balance ?? currentBalance),
				lifetime_earned: Number(
					payload.lifetime_earned ?? profile.lifetime_earned ?? 0,
				),
			},
			{ request },
		);
	}

	const metadata = {
		...(body.metadata ?? {}),
		auth_user_id: verified.id,
	};

	// ── SPEND PATH ────────────────────────────────────────────────────
	// Use the atomic SQL RPC so the SELECT-then-INSERT is collapsed into
	// a single transaction with `FOR UPDATE` row-locking.  Eliminates
	// the TOCTOU race two clients spending in parallel could exploit.
	if (amount < 0) {
		const { data: newBalance, error: rpcErr } = await supabase.rpc(
			"spend_tokens",
			{
				p_tenant_id: tenant_id,
				p_user_id: userProfileId,
				p_amount: amount,
				p_reason: reason,
				p_metadata: metadata,
			},
		);

		if (rpcErr) {
			// Could be permission denied (lockdown not applied), wrong sign,
			// or the user_profile not found.  All are server-side problems
			// from the caller's perspective.
			console.warn("[api.wallet] spend_tokens rpc failed", rpcErr.message);
			return jsonResponse(
				{ ok: false, error: "rpc_failed", detail: rpcErr.message },
				{ status: 500, request },
			);
		}

		// RPC contract: NULL when the spend would overdraft.
		if (newBalance === null || newBalance === undefined) {
			return jsonResponse(
				{
					ok: false,
					error: "insufficient_funds",
					balance: currentBalance,
					required: -amount,
				},
				{ status: 400, request },
			);
		}

		return jsonResponse(
			{
				ok: true,
				amount,
				reason,
				balance: Number(newBalance),
				lifetime_earned: Number(profile.lifetime_earned ?? 0),
			},
			{ request },
		);
	}

	// ── EARN PATH ─────────────────────────────────────────────────────
	// Direct insert is safe — credits never overdraft.  The AFTER INSERT
	// trigger updates the materialized balance + lifetime_earned.
	const { error: insertErr } = await supabase
		.from("wallet_ledger")
		.insert({
			tenant_id,
			user_id: userProfileId,
			amount,
			reason,
			metadata,
		});

	if (insertErr) {
		console.warn("[api.wallet] earn insert failed", insertErr.message);
		return jsonResponse(
			{ ok: false, error: "insert_failed" },
			{ status: 500, request },
		);
	}

	// Read back the materialized projection for an accurate response.
	const { data: updated } = await supabase
		.from("user_profiles")
		.select("token_balance, lifetime_earned")
		.eq("id", userProfileId)
		.maybeSingle();

	return jsonResponse(
		{
			ok: true,
			amount,
			reason,
			balance: Number(updated?.token_balance ?? currentBalance + amount),
			lifetime_earned: Number(
				updated?.lifetime_earned ?? Number(profile.lifetime_earned ?? 0) + amount,
			),
		},
		{ request },
	);
}

export function loader({ request }: Route.LoaderArgs) {
	const cors = preflight(request);
	if (cors) return cors;
	return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
		status: 405,
		headers: {
			"Content-Type": "application/json",
			...corsHeaders(request.headers.get("origin")),
		},
	});
}
