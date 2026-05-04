import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppLoadContext } from "react-router";

/**
 * Build a Supabase client scoped to a Cloudflare Worker request.
 *
 * - Uses the REST endpoint (HTTP), not the Postgres pool URL — supabase-js
 *   handles its own connection lifecycle on the edge.
 * - `auth.persistSession: false` — the worker is stateless; we never want
 *   the SDK to try to read/write auth from a browser-like store.
 * - The anon key is what we ship to the worker; RLS on the Postgres side
 *   does the actual isolation.  For privileged paths (seeder, admin), the
 *   service role key takes precedence when present.
 */
type ServerEnv = Env & {
	SUPABASE_URL?: string;
	SUPABASE_ANON_KEY?: string;
	SUPABASE_SERVICE_ROLE_KEY?: string;
};

function readEnv(context: AppLoadContext): ServerEnv {
	return context.cloudflare.env as ServerEnv;
}

export function getSupabase(context: AppLoadContext): SupabaseClient {
	const env = readEnv(context);
	const url = env.SUPABASE_URL;
	const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;

	if (!url || !key) {
		throw new Response("Supabase not configured", { status: 503 });
	}

	return createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			headers: { "X-Client-Info": "lapocha-edge-worker" },
		},
	});
}

/**
 * Service-role-ONLY client.  Required for privileged RPC calls
 * (`spend_tokens`, admin mutations) where falling back to the anon key
 * would silently fail after the database lockdown.
 *
 * Throws a 503 Response if SUPABASE_SERVICE_ROLE_KEY isn't configured —
 * the worker's action handler bubbles that up so the caller gets a
 * clear error instead of a permission-denied surprise.
 */
export function getServiceSupabase(context: AppLoadContext): SupabaseClient {
	const env = readEnv(context);
	const url = env.SUPABASE_URL;
	const key = env.SUPABASE_SERVICE_ROLE_KEY;

	if (!url || !key) {
		throw new Response("Supabase service role not configured", {
			status: 503,
		});
	}

	return createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			headers: {
				"X-Client-Info": "lapocha-edge-worker-srv",
			},
		},
	});
}
