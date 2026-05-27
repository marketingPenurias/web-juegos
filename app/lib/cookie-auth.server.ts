import type { AppLoadContext } from "react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "./supabase.server";
import { parseCookies } from "./api.server";
import {
	hasTenantRole,
	resolveTenantProfile,
} from "./tenant-resolver.server";
import { extractSlugFromHost } from "./tenant";
import type { StaffRole } from "../types/database";

/**
 * Server-side authentication via the browser's Supabase auth cookie.
 *
 * Our `api.server.ts → verifyAuthToken` expects the JWT in an
 * `Authorization: Bearer …` header.  That works fine for our `fetch`
 * lib calls because we explicitly inject the header.
 *
 * Page loads (e.g. `/tv/music`) don't have that header.  The browser
 * does, however, automatically send the Supabase auth cookie
 * (`sb-<projectRef>-auth-token`) that we set in `supabase.client.ts`.
 * This helper parses that cookie server-side and validates the access
 * token via `supabase.auth.getUser()`.
 */

type ServerEnv = Env & {
	SUPABASE_URL?: string;
	SUPABASE_PUBLISHABLE_KEY?: string;
	SUPABASE_SECRET_KEY?: string;
};

function projectRefFromUrl(url: string | undefined): string | null {
	if (!url) return null;
	try {
		const host = new URL(url).hostname;
		return host.split(".")[0] || null;
	} catch {
		return null;
	}
}

/**
 * Pull the access token out of the Supabase auth cookie.  Returns null
 * when the cookie is missing, malformed, or chunked across multiple
 * keys (chunked sessions are post-MVP).
 */
export function readSupabaseAccessToken(
	request: Request,
	context: AppLoadContext,
): string | null {
	const env = context.cloudflare.env as ServerEnv;
	const projectRef = projectRefFromUrl(env.SUPABASE_URL);
	if (!projectRef) return null;

	const cookies = parseCookies(request);
	const candidateNames = [
		`sb-${projectRef}-auth-token`,
		// supabase-js v2 sometimes prefixes with the storage key when set;
		// keep a fallback in case the storageKey override gets reintroduced.
		`lapocha-auth-token`,
	];

	for (const name of candidateNames) {
		const raw = cookies[name];
		if (!raw) continue;
		try {
			// Cookie can be either a JSON object or a base64 prefix (`base64-…`).
			let json = raw;
			if (json.startsWith("base64-")) {
				json = atob(json.slice("base64-".length));
			}
			const parsed = JSON.parse(json) as
				| { access_token?: string }
				| [string, ...unknown[]];
			if (Array.isArray(parsed)) {
				// supabase-js sometimes serialises as a tuple [access_token, ...]
				const t = parsed[0];
				if (typeof t === "string" && t.length > 0) return t;
				continue;
			}
			if (parsed && typeof parsed.access_token === "string") {
				return parsed.access_token;
			}
		} catch {
			// Malformed cookie — try the next candidate.
		}
	}

	return null;
}

export type CookieAuthUser = {
	id: string;
	email: string | null;
	supabase: SupabaseClient;
	access_token: string;
};

/**
 * Verify the request's auth cookie against Supabase and return the
 * resolved user + a SECRET-key client.  Returns null when the cookie
 * is absent or invalid.
 */
export async function verifyCookieAuth(
	request: Request,
	context: AppLoadContext,
): Promise<CookieAuthUser | null> {
	const token = readSupabaseAccessToken(request, context);
	if (!token) return null;

	let supabase: SupabaseClient;
	try {
		supabase = getServiceSupabase(context);
	} catch {
		return null;
	}

	const { data, error } = await supabase.auth.getUser(token);
	if (error || !data?.user) return null;

	return {
		id: data.user.id,
		email: data.user.email ?? null,
		supabase,
		access_token: token,
	};
}

export type ScreenAuthOk = {
	ok: true;
	user: CookieAuthUser;
	tenant_id: string;
	user_profile_id: string | null;
};
export type ScreenAuthFail = {
	ok: false;
	status: 401 | 403 | 404;
	error:
		| "unauthorized"
		| "forbidden"
		| "missing_tenant"
		| "unknown_tenant"
		| "profile_not_found";
};

/**
 * One-call helper for screen loaders that need (1) authenticated user
 * via cookie, (2) the user's profile in this tenant, and (3) a role
 * check.  Returns a discriminated union so the loader stays linear.
 */
export async function requireTenantRole(
	request: Request,
	context: AppLoadContext,
	tenantSlug: string,
	roles: StaffRole[],
): Promise<ScreenAuthOk | ScreenAuthFail> {
	const user = await verifyCookieAuth(request, context);
	if (!user) return { ok: false, status: 401, error: "unauthorized" };

	const supabase = user.supabase;
	const cleanSlug = tenantSlug || extractSlugFromHost(new URL(request.url).hostname);
	if (!cleanSlug) {
		return { ok: false, status: 404, error: "missing_tenant" };
	}

	const profile = await resolveTenantProfile(supabase, cleanSlug, user.id);
	if (!profile.ok) {
		const map: Record<typeof profile.error, ScreenAuthFail["status"]> = {
			unknown_tenant: 404,
			profile_not_found: 404,
			lookup_failed: 401,
		};
		return {
			ok: false,
			status: map[profile.error] ?? 401,
			error: profile.error === "lookup_failed" ? "unauthorized" : profile.error,
		};
	}

	for (const role of roles) {
		const allowed = await hasTenantRole(
			supabase,
			profile.data.tenant_id,
			user.id,
			role,
		);
		if (allowed) {
			return {
				ok: true,
				user,
				tenant_id: profile.data.tenant_id,
				user_profile_id: profile.data.user_profile_id,
			};
		}
	}

	return { ok: false, status: 403, error: "forbidden" };
}
