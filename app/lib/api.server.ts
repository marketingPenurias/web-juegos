import type { AppLoadContext } from "react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase.server";

// ─── Cookie parsing ──────────────────────────────────────────────────────

/**
 * Parse a `Cookie` request header into a plain map.  Returns an empty
 * map when the header is absent.  Values are URI-decoded.
 */
export function parseCookies(request: Request): Record<string, string> {
	const header = request.headers.get("cookie");
	if (!header) return {};
	const out: Record<string, string> = {};
	for (const piece of header.split(";")) {
		const eq = piece.indexOf("=");
		if (eq < 0) continue;
		const name = piece.slice(0, eq).trim();
		if (!name) continue;
		const value = piece.slice(eq + 1).trim();
		try {
			out[name] = decodeURIComponent(value);
		} catch {
			out[name] = value;
		}
	}
	return out;
}

export type SerializeCookieOptions = {
	path?: string;
	maxAge?: number;
	httpOnly?: boolean;
	sameSite?: "Lax" | "Strict" | "None";
	secure?: boolean;
	domain?: string;
};

/**
 * Build a `Set-Cookie` header value with sensible defaults.  Used by
 * the auth-sync route to expire `ng_tracking_ref` once consumed.
 */
export function serializeCookie(
	name: string,
	value: string,
	opts: SerializeCookieOptions = {},
): string {
	const parts = [`${name}=${encodeURIComponent(value)}`];
	parts.push(`Path=${opts.path ?? "/"}`);
	if (typeof opts.maxAge === "number") parts.push(`Max-Age=${opts.maxAge}`);
	parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
	if (opts.httpOnly ?? true) parts.push("HttpOnly");
	if (opts.secure) parts.push("Secure");
	if (opts.domain) parts.push(`Domain=${opts.domain}`);
	return parts.join("; ");
}

/**
 * Shared edge-API helpers: CORS, JWT verification, JSON helpers.
 *
 * Same-origin requests don't need CORS, but the prompt explicitly asks
 * to allow `localhost` and the production domain so external dashboards
 * (admin tools, analytics) can hit `/api/*`.  Wildcard origins are NEVER
 * allowed — we echo back the request origin only when it's on the
 * allowlist, otherwise we omit the header (browsers will block).
 */

const ALLOWED_ORIGINS = new Set<string>([
	"http://localhost:5173",
	"http://localhost:8788",
	"http://127.0.0.1:5173",
	"https://web-juegos.pages.dev",
	"https://lapocha.nightgraph.es",
	"https://nightgraph.io",
	"https://www.nightgraph.io",
]);

const ALLOWED_PATTERNS: RegExp[] = [
	/^https:\/\/[a-z0-9-]+\.web-juegos\.pages\.dev$/, // Cloudflare preview deploys
	/^https:\/\/[a-z0-9-]+\.nightgraph\.io$/, // every venue subdomain
	/^https:\/\/[a-z0-9-]+\.nightgraph\.es$/, // legacy brand
];

export function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) return false;
	if (ALLOWED_ORIGINS.has(origin)) return true;
	return ALLOWED_PATTERNS.some((re) => re.test(origin));
}

export function corsHeaders(origin: string | null): Record<string, string> {
	const allow = origin && isAllowedOrigin(origin) ? origin : "";
	const headers: Record<string, string> = {
		"Vary": "Origin",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers":
			"Content-Type, Authorization, X-Tenant-Slug",
		"Access-Control-Max-Age": "86400",
	};
	if (allow) {
		headers["Access-Control-Allow-Origin"] = allow;
		headers["Access-Control-Allow-Credentials"] = "true";
	}
	return headers;
}

export function preflight(request: Request): Response | null {
	if (request.method !== "OPTIONS") return null;
	const origin = request.headers.get("origin");
	return new Response(null, {
		status: 204,
		headers: corsHeaders(origin),
	});
}

export function jsonResponse(
	body: unknown,
	init: ResponseInit & { request?: Request } = {},
): Response {
	const { request, ...rest } = init;
	const origin = request?.headers.get("origin") ?? null;
	const headers = new Headers(rest.headers ?? {});
	headers.set("Content-Type", "application/json");
	for (const [k, v] of Object.entries(corsHeaders(origin))) {
		headers.set(k, v);
	}
	return new Response(JSON.stringify(body), {
		status: rest.status ?? 200,
		headers,
	});
}

// ─── JWT verification ──────────────────────────────────────────────────

export type VerifiedUser = {
	id: string;
	email: string | null;
	supabase: SupabaseClient;
};

/**
 * Pull `Authorization: Bearer <jwt>` from the request and verify it via
 * Supabase.  Returns the user (with the bound Supabase client) or null.
 *
 * Cost: a single round-trip to Supabase auth — keep it for any route
 * that mutates state.  Read-only / anon routes can skip this.
 *
 * Header parsing: `request.headers.get("authorization")` (lowercase
 * canónico HTTP) cubre tanto `Authorization` como `authorization` —
 * los Headers de Fetch hacen case-insensitive lookup.
 */
export async function verifyAuthToken(
	request: Request,
	context: AppLoadContext,
): Promise<VerifiedUser | null> {
	const auth = request.headers.get("authorization");
	if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
		// TODO: CLEANUP AUTH VERIFY DEBUG
		console.warn("[AUTH VERIFY] no Authorization header / not Bearer", {
			hasHeader: !!auth,
			preview: auth?.slice(0, 16),
		});
		return null;
	}
	const token = auth.slice("bearer ".length).trim();
	if (!token) {
		// TODO: CLEANUP AUTH VERIFY DEBUG
		console.warn("[AUTH VERIFY] empty token after Bearer");
		return null;
	}

	let supabase: SupabaseClient;
	try {
		supabase = getSupabase(context);
	} catch (err) {
		// `getSupabase` throws Response(503) cuando falta SUPABASE_URL o
		// las dos keys (PUBLISHABLE/SECRET).  Eso es lo que produce un
		// 401 misterioso en producción si las env vars no se cargaron.
		// TODO: CLEANUP AUTH VERIFY DEBUG
		console.error("[AUTH VERIFY] getSupabase threw — check env vars", {
			thrown: err instanceof Response ? `Response(${err.status})` : String(err),
		});
		return null;
	}

	const { data, error } = await supabase.auth.getUser(token);
	if (error || !data?.user) {
		// TODO: CLEANUP AUTH VERIFY DEBUG
		console.error("[AUTH VERIFY] supabase.auth.getUser rejected", {
			errorMessage: error?.message,
			errorStatus: (error as { status?: number } | undefined)?.status,
			hasUser: !!data?.user,
			tokenPreview: token.slice(0, 12) + "…",
		});
		return null;
	}
	return {
		id: data.user.id,
		email: data.user.email ?? null,
		supabase,
	};
}
