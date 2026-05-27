import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Singleton browser Supabase client with cross-subdomain SSO.
 *
 * The auth session is persisted to cookies (not localStorage) and the
 * cookie domain is derived from the current hostname:
 *
 *   localhost / 127.0.0.1   → host-only cookie
 *   foo.bar.pages.dev       → host-only cookie (CF preview deploys)
 *   kapital.nightgraph.es        → `.nightgraph.es`        (root domain, SSO)
 *   nightgraph.es                → `.nightgraph.es`
 *
 * We rely on supabase-js's default storageKey (`sb-<projectRef>-auth-token`)
 * so every subdomain reads the same cookie automatically — log in once on
 * any subdomain, you're logged in everywhere.
 *
 * SSR-safe: returns `null` on the server so importing this module in a
 * shared file doesn't blow up during render.
 */

const VITE_URL = import.meta.env.VITE_SUPABASE_URL;
const VITE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getCookieDomain(): string | undefined {
	if (typeof window === "undefined") return undefined;
	const host = window.location.hostname.toLowerCase();

	// Browsers reject the Domain attribute for localhost and bare IPs;
	// fall back to a host-only cookie so dev still works.
	if (host === "localhost" || host === "127.0.0.1") return undefined;
	if (/^\d+(\.\d+){3}$/.test(host)) return undefined;

	// Cloudflare preview deploys (`*.pages.dev`) — host-only.  Setting a
	// `.pages.dev` cookie wouldn't work and might be blocked by browsers.
	if (host.endsWith(".pages.dev")) return undefined;

	const parts = host.split(".");
	if (parts.length < 2) return undefined;
	// Take the last two labels: `kapital.nightgraph.es` → `.nightgraph.es`.
	return `.${parts.slice(-2).join(".")}`;
}

const COOKIE_KEY_RE_CACHE = new Map<string, RegExp>();
function readCookie(key: string): string | null {
	if (typeof document === "undefined") return null;
	const encoded = encodeURIComponent(key);
	let re = COOKIE_KEY_RE_CACHE.get(encoded);
	if (!re) {
		const escaped = encoded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		re = new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`);
		COOKIE_KEY_RE_CACHE.set(encoded, re);
	}
	const match = document.cookie.match(re);
	return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(key: string, value: string, removing = false): void {
	if (typeof document === "undefined") return;
	const domain = getCookieDomain();
	const secure =
		typeof window !== "undefined" && window.location.protocol === "https:";

	const parts = [
		`${encodeURIComponent(key)}=${removing ? "" : encodeURIComponent(value)}`,
		"path=/",
		removing ? "max-age=0" : `max-age=${COOKIE_MAX_AGE_SECONDS}`,
		"samesite=lax",
	];
	if (secure) parts.push("secure");
	if (domain) parts.push(`domain=${domain}`);
	document.cookie = parts.join("; ");
}

const cookieStorage = {
	getItem(key: string): string | null {
		return readCookie(key);
	},
	setItem(key: string, value: string): void {
		writeCookie(key, value);
	},
	removeItem(key: string): void {
		writeCookie(key, "", true);
	},
};

let _client: SupabaseClient | null = null;

function buildClient(): SupabaseClient | null {
	if (typeof window === "undefined") return null;
	if (!VITE_URL || !VITE_KEY) {
		console.warn(
			"[supabase.client] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing; auth disabled.",
		);
		return null;
	}
	return createClient(VITE_URL, VITE_KEY, {
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: true,
			storage: cookieStorage,
			// storageKey intentionally omitted — the default `sb-<projectRef>-
			// auth-token` lets every subdomain in the same root resolve the
			// same cookie name without any extra config.
		},
		global: { headers: { "X-Client-Info": "lapocha-web" } },
	});
}

export function getBrowserSupabase(): SupabaseClient | null {
	if (_client) return _client;
	_client = buildClient();
	return _client;
}

/** Convenience: fetch the current access token, or null. */
export async function getAccessToken(): Promise<string | null> {
	const client = getBrowserSupabase();
	if (!client) return null;
	const { data } = await client.auth.getSession();
	return data.session?.access_token ?? null;
}
