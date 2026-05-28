import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Singleton browser Supabase client.
 *
 *   Persistencia: `window.localStorage` — el storage por defecto para
 *   SPAs.  Es el camino que supabase-js documenta y verifica; cualquier
 *   adaptador custom (cookies, sessionStorage, etc.) ha demostrado
 *   "evaporar" la sesión justo después del `exchangeCodeForSession`
 *   en producción Cloudflare Workers — síntoma: el exchange retorna
 *   `session.user.email` correctamente y 500 ms después `getSession()`
 *   devuelve `null`.
 *
 *   Trade-off conocido: el SSO cross-subdomain (un login en
 *   `lapocha.nightgraph.io` heredado en `otroclub.nightgraph.io`) NO
 *   funciona con localStorage — cada subdomain mantiene su propio
 *   almacenamiento.  Esto queda como deuda explícita para Fase 2
 *   (Supabase Cookie SSR helpers + edge session sharing).
 *
 *   SSR-safe: `getBrowserSupabase()` devuelve `null` durante el
 *   render del servidor; cualquier consumidor de la lib debe esperar
 *   a hidratación cliente.
 */

const VITE_URL = import.meta.env.VITE_SUPABASE_URL;
const VITE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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
			// El callback `/auth/callback` orquesta el exchange a mano y
			// llama `setSession()` explícito tras el éxito; mantener
			// `detectSessionInUrl: false` evita que la lib intente
			// procesar el `?code=…` por su cuenta y consuma el
			// `code_verifier` antes de tiempo.
			detectSessionInUrl: false,
			flowType: "pkce",
			storage: window.localStorage,
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
