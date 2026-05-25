import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppLoadContext } from "react-router";

/**
 * Server-side Supabase clients for the Cloudflare Worker.
 *
 * Uses the new Supabase API key naming (no more "anon" / "service_role"
 * labels in our code):
 *   - SUPABASE_PUBLISHABLE_KEY  → browser-safe, RLS-bound
 *   - SUPABASE_SECRET_KEY       → server-only, bypasses RLS
 *
 * The publishable client is used for read-only paths under RLS (e.g.
 * `getUser(token)` verification, tenant lookups).  The secret client is
 * reserved for privileged RPCs (`spend_tokens`, `purchase_reward`,
 * `start_reward_redemption`, `vote_track`) and never reaches the wire
 * outside the worker.
 */

type ServerEnv = Env & {
	SUPABASE_URL?: string;
	SUPABASE_PUBLISHABLE_KEY?: string;
	SUPABASE_SECRET_KEY?: string;
};

function readEnv(context: AppLoadContext): ServerEnv {
	return context.cloudflare.env as ServerEnv;
}

/**
 * Generic worker client.  Picks the SECRET key when available (so writes
 * bypass RLS); falls back to the PUBLISHABLE key for read paths in
 * environments where the secret hasn't been provisioned yet.
 */
export function getSupabase(context: AppLoadContext): SupabaseClient {
	const env = readEnv(context);
	const url = env.SUPABASE_URL;
	const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY;

	if (!url || !key) {
		throw new Response("Supabase not configured", { status: 503 });
	}

	return createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			headers: { "X-Client-Info": "nightgraph-edge-worker" },
		},
	});
}

/**
 * Strict SECRET-key client.  Required for privileged RPC calls
 * (`spend_tokens`, `purchase_reward`, `start_reward_redemption`,
 * `vote_track`).  Throws a 503 Response when SUPABASE_SECRET_KEY isn't
 * configured — the action handler bubbles that up so the caller gets a
 * clear error instead of a silent permission-denied.
 */
export function getServiceSupabase(context: AppLoadContext): SupabaseClient {
	const env = readEnv(context);
	const url = env.SUPABASE_URL;
	const key = env.SUPABASE_SECRET_KEY;

	if (!url || !key) {
		throw new Response("Supabase secret key not configured", {
			status: 503,
		});
	}

	return createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			headers: {
				"X-Client-Info": "nightgraph-edge-worker-srv",
			},
		},
	});
}
