import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Singleton browser Supabase client.
 *
 * - Read-only on the network layer; writes go through the worker.
 * - Used for: OAuth login, session retrieval, JWT for outbound fetches.
 * - SSR-safe: returns `null` on the server so importing this module in a
 *   shared file doesn't try to access localStorage during render.
 */

const VITE_URL = import.meta.env.VITE_SUPABASE_URL;
const VITE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let _client: SupabaseClient | null = null;

function buildClient(): SupabaseClient | null {
	if (typeof window === "undefined") return null;
	if (!VITE_URL || !VITE_KEY) {
		// Don't crash the app when keys aren't filled in yet — features just
		// degrade gracefully (no auth, no JWT, anon analytics still work).
		console.warn(
			"[supabase.client] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing; auth disabled.",
		);
		return null;
	}
	return createClient(VITE_URL, VITE_KEY, {
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: true,
			storageKey: "lapocha-auth",
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
