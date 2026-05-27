import type { Route } from "./+types/api.auth-sync";
import {
	corsHeaders,
	jsonResponse,
	parseCookies,
	preflight,
	serializeCookie,
	verifyAuthToken,
} from "../lib/api.server";
import { getServiceSupabase } from "../lib/supabase.server";
import { pickTenantSlug } from "../lib/tenant-resolver.server";

/**
 * POST /api/auth-sync
 *
 * The client calls this once after Supabase fires SIGNED_IN.  The Edge
 * Worker:
 *
 *   1. Verifies the JWT (401 otherwise).
 *   2. Resolves the tenant slug strictly (payload → header → host).
 *   3. Upserts the user_profiles row keyed on (tenant_id, auth_user_id).
 *      On insert we stamp display_name + email from the JWT and the
 *      acquisition campaign from the `ng_tracking_ref` cookie.
 *   4. Whether new or existing, **clears** the `ng_tracking_ref` cookie
 *      on the response.  Attribution is once-and-done.
 *
 *   Body: { tenant_slug?: string }
 *   Response: 200 { ok: true, profile: { id, is_new, balance, ... } }
 */

type SyncBody = { tenant_slug?: string };

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
		return jsonResponse(
			{ ok: false, error: "unauthorized" },
			{ status: 401, request },
		);
	}

	let body: SyncBody = {};
	try {
		const raw = await request.text();
		body = raw ? (JSON.parse(raw) as SyncBody) : {};
	} catch {
		// Empty body is OK — slug will come from header / host.
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

	// ── Resolve tenant id ─────────────────────────────────────────────
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

	// ── Does the profile already exist? ───────────────────────────────
	const { data: existing } = await supabase
		.from("user_profiles")
		.select(
			"id, token_balance, lifetime_earned, acquisition_campaign_id, display_name",
		)
		.eq("tenant_id", tenant_id)
		.eq("auth_user_id", verified.id)
		.maybeSingle();

	// ── Consume the tracking cookie regardless of new / existing ──────
	const cookies = parseCookies(request);
	const trackingCode = (cookies["ng_tracking_ref"] || "").trim();
	const clearCookie = serializeCookie("ng_tracking_ref", "", {
		maxAge: 0,
		secure: new URL(request.url).protocol === "https:",
	});

	let acquisition_campaign_id: string | null =
		existing?.acquisition_campaign_id ?? null;

	if (trackingCode && !existing?.acquisition_campaign_id) {
		const { data: campaignId } = await supabase.rpc(
			"resolve_tracking_campaign",
			{
				p_tenant_id: tenant_id,
				p_code: trackingCode,
			},
		);
		if (typeof campaignId === "string" && campaignId) {
			acquisition_campaign_id = campaignId;
		}
	}

	// ── Branch: existing vs new ───────────────────────────────────────
	if (existing) {
		// Only PATCH attribution if it was unset and we have a fresh cookie.
		if (
			acquisition_campaign_id &&
			!existing.acquisition_campaign_id
		) {
			await supabase
				.from("user_profiles")
				.update({ acquisition_campaign_id })
				.eq("id", existing.id);
		}

		return jsonResponse(
			{
				ok: true,
				profile: {
					id: existing.id,
					is_new: false,
					token_balance: existing.token_balance ?? 0,
					lifetime_earned: existing.lifetime_earned ?? 0,
					display_name: existing.display_name,
					acquisition_campaign_id:
						acquisition_campaign_id ?? existing.acquisition_campaign_id,
				},
			},
			{
				request,
				headers: { "Set-Cookie": clearCookie },
			},
		);
	}

	// New profile — INSERT.
	const displayName =
		(verified as { email?: string | null }).email?.split("@")[0] ?? null;

	const { data: inserted, error: insertErr } = await supabase
		.from("user_profiles")
		.insert({
			tenant_id,
			auth_user_id: verified.id,
			email: verified.email ?? `${verified.id}@anonymous`,
			display_name: displayName,
			acquisition_source: trackingCode || null,
			acquisition_campaign_id,
		})
		.select("id, token_balance, lifetime_earned, display_name")
		.maybeSingle();

	// ── TOCTOU recovery ───────────────────────────────────────────────
	// React StrictMode + a fast SIGNED_IN re-fire can trigger this
	// handler twice in parallel.  The second call's INSERT collides
	// with the partial UNIQUE index on (auth_user_id) — Postgres
	// returns SQLSTATE 23505.  Treat it as if it were the existing
	// branch from the start: re-SELECT and return 200.
	if (insertErr) {
		const code =
			(insertErr as { code?: string | null }).code ?? "";
		const isUniqueViolation =
			code === "23505" ||
			/duplicate key|unique constraint/i.test(insertErr.message ?? "");

		if (isUniqueViolation) {
			const { data: recovered } = await supabase
				.from("user_profiles")
				.select(
					"id, token_balance, lifetime_earned, acquisition_campaign_id, display_name",
				)
				.eq("tenant_id", tenant_id)
				.eq("auth_user_id", verified.id)
				.maybeSingle();

			if (recovered) {
				// If the loser of the race had a fresh attribution to apply,
				// PATCH it onto the winner (only when the row is still NULL).
				if (
					acquisition_campaign_id &&
					!recovered.acquisition_campaign_id
				) {
					await supabase
						.from("user_profiles")
						.update({ acquisition_campaign_id })
						.eq("id", recovered.id);
				}

				return jsonResponse(
					{
						ok: true,
						profile: {
							id: recovered.id,
							is_new: false,
							token_balance: recovered.token_balance ?? 0,
							lifetime_earned: recovered.lifetime_earned ?? 0,
							display_name: recovered.display_name,
							acquisition_campaign_id:
								acquisition_campaign_id ??
								recovered.acquisition_campaign_id,
						},
					},
					{
						request,
						// Success path → consume the tracking cookie.
						headers: { "Set-Cookie": clearCookie },
					},
				);
			}
		}

		console.warn(
			"[api.auth-sync] profile insert failed",
			insertErr.message,
		);
		// IMPORTANT: do NOT clear the cookie on failure.  The user
		// will retry on the next privileged write; attribution must
		// survive that retry.
		return jsonResponse(
			{ ok: false, error: "profile_insert_failed" },
			{ status: 500, request },
		);
	}

	if (!inserted) {
		// Defensive: PostgREST returned null without an error — bail
		// without clearing the cookie so attribution survives.
		return jsonResponse(
			{ ok: false, error: "profile_insert_failed" },
			{ status: 500, request },
		);
	}

	return jsonResponse(
		{
			ok: true,
			profile: {
				id: inserted.id,
				is_new: true,
				token_balance: inserted.token_balance ?? 0,
				lifetime_earned: inserted.lifetime_earned ?? 0,
				display_name: inserted.display_name,
				acquisition_campaign_id,
			},
		},
		{
			request,
			headers: { "Set-Cookie": clearCookie },
		},
	);
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
