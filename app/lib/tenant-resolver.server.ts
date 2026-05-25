import type { SupabaseClient } from "@supabase/supabase-js";
import { extractSlugFromHost } from "./tenant";

/**
 * Tenant + user-profile resolution shared by the rewards / music / wallet
 * API routes.  Saves every privileged action handler from re-implementing
 * the same three steps:
 *
 *   1. Pick a tenant slug (payload → header → host) — strict, no defaults.
 *   2. Resolve the slug to a tenant UUID.
 *   3. Find the caller's user_profiles row for that tenant via auth_user_id.
 */

export type SlugResolutionResult =
	| { ok: true; slug: string }
	| { ok: false; error: "missing_tenant" };

export function pickTenantSlug(
	bodySlug: string | undefined | null,
	request: Request,
): SlugResolutionResult {
	const headerSlug = request.headers.get("x-tenant-slug");
	let hostSlug: string | null = null;
	try {
		hostSlug = extractSlugFromHost(new URL(request.url).hostname) || null;
	} catch {
		hostSlug = null;
	}
	const raw = bodySlug || headerSlug || hostSlug;
	if (!raw) return { ok: false, error: "missing_tenant" };
	const cleaned = String(raw).trim().toLowerCase().slice(0, 64);
	if (!cleaned) return { ok: false, error: "missing_tenant" };
	return { ok: true, slug: cleaned };
}

export type TenantProfile = {
	tenant_id: string;
	user_profile_id: string;
	token_balance: number;
	lifetime_earned: number;
};

export type ResolveProfileResult =
	| { ok: true; data: TenantProfile }
	| {
			ok: false;
			error: "unknown_tenant" | "profile_not_found" | "lookup_failed";
			detail?: string;
	  };

/**
 * Look up the (tenant_id, user_profile_id) pair for a verified Supabase
 * user inside a given tenant slug.  Uses the provided service-role-or-
 * publishable client; the caller decides which level of trust to bring.
 */
export async function resolveTenantProfile(
	supabase: SupabaseClient,
	slug: string,
	authUserId: string,
): Promise<ResolveProfileResult> {
	const { data: tenant, error: tenantErr } = await supabase
		.from("tenants")
		.select("id")
		.eq("slug", slug)
		.maybeSingle();
	if (tenantErr) {
		return { ok: false, error: "lookup_failed", detail: tenantErr.message };
	}
	if (!tenant) return { ok: false, error: "unknown_tenant" };

	const tenant_id = tenant.id as string;

	const { data: profile, error: profileErr } = await supabase
		.from("user_profiles")
		.select("id, token_balance, lifetime_earned")
		.eq("tenant_id", tenant_id)
		.eq("auth_user_id", authUserId)
		.maybeSingle();

	if (profileErr) {
		return { ok: false, error: "lookup_failed", detail: profileErr.message };
	}
	if (!profile) return { ok: false, error: "profile_not_found" };

	return {
		ok: true,
		data: {
			tenant_id,
			user_profile_id: profile.id as string,
			token_balance: Number(profile.token_balance ?? 0),
			lifetime_earned: Number(profile.lifetime_earned ?? 0),
		},
	};
}

/**
 * Verify the caller has a given role for the tenant.  Returns true when
 * a matching row exists in tenant_staff with is_active = true.
 */
export async function hasTenantRole(
	supabase: SupabaseClient,
	tenant_id: string,
	auth_user_id: string,
	role: string,
): Promise<boolean> {
	const { data, error } = await supabase
		.from("tenant_staff")
		.select("id")
		.eq("tenant_id", tenant_id)
		.eq("user_id", auth_user_id)
		.eq("role", role)
		.eq("is_active", true)
		.maybeSingle();
	if (error) return false;
	return !!data;
}
