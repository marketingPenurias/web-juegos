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

type JwtPayload = {
	sub?: string;
	email?: string;
	exp?: number;
	aud?: string;
	role?: string;
};

/**
 * Decode a base64url string into its raw byte-string representation
 * (each char is a byte 0..255).  Pads to a multiple of 4 so `atob`
 * doesn't reject the input.
 */
function decodeB64Url(b64url: string): string {
	const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
	return atob(padded);
}

/**
 * Importa una clave pública en formato JWK (curva P-256) directamente
 * a Web Crypto API.  Acepta dos formas válidas en `SUPABASE_JWT_PUBLIC_KEY`:
 *
 *   - JWK plano:    `{ "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }`
 *   - JWKS wrapper: `{ "keys": [ { ... }, ... ] }`  → tomamos `keys[0]`
 *
 *   El nombre de la función se conserva por compatibilidad con el
 *   cleanup tracker; el parámetro pasa de PEM a string JSON.
 */
async function importPublicKey(jwkJsonString: string): Promise<CryptoKey> {
	let jwkData: unknown;
	try {
		jwkData = JSON.parse(jwkJsonString);
	} catch {
		throw new Error("Invalid JWK JSON format");
	}

	const keyToImport =
		jwkData && typeof jwkData === "object" && "keys" in jwkData
			? (jwkData as { keys: JsonWebKey[] }).keys[0]
			: (jwkData as JsonWebKey);

	return crypto.subtle.importKey(
		"jwk",
		keyToImport,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);
}

/**
 * Verifica un JWT de Supabase **localmente** (ES256 / ECDSA P-256)
 * usando Web Crypto API.
 *
 *   Por qué asimétrica (ES256) en lugar de simétrica (HS256):
 *     - El proyecto Supabase está en modo "ECC P-256 Current Key,
 *       HS256 Legacy".  La firma de los nuevos tokens es ECDSA.
 *     - Asimétrica significa que el Worker sólo necesita la clave
 *       PÚBLICA — si se filtra no compromete la emisión de tokens.
 *     - La firma JWT viene en formato IEEE P1363 (raw r||s, 64 bytes
 *       para P-256), que es exactamente lo que espera
 *       `crypto.subtle.verify` con algoritmo ECDSA.
 *
 *   Formato de la clave pública: JWK / JWKS JSON string (Supabase
 *   exporta así desde Dashboard → API → JWT Settings → Signing Keys
 *   → Current Key → Show public key → "Show as JWK").
 *
 *   Returns the decoded payload on success, `null` on:
 *     - JWT no tiene 3 segmentos
 *     - firma no verifica contra la clave pública
 *     - `exp` ya pasó
 *     - cualquier excepción durante decode / import / verify
 */
async function verifySupabaseJwtLocally(
	token: string,
	jwkJsonString: string,
): Promise<JwtPayload | null> {
	const parts = token.split(".");
	if (parts.length !== 3) return null;

	try {
		const key = await importPublicKey(jwkJsonString);

		const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
		const signatureStr = decodeB64Url(parts[2]);
		const signature = new Uint8Array(signatureStr.length);
		for (let i = 0; i < signatureStr.length; i++) {
			signature[i] = signatureStr.charCodeAt(i);
		}

		const isValid = await crypto.subtle.verify(
			{ name: "ECDSA", hash: { name: "SHA-256" } },
			key,
			signature,
			data,
		);
		if (!isValid) return null;

		const payload = JSON.parse(decodeB64Url(parts[1])) as JwtPayload;
		if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
			return null;
		}

		return payload;
	} catch {
		return null;
	}
}

type WorkerEnv = {
	SUPABASE_JWT_PUBLIC_KEY?: string;
};

function readJwtPublicKey(context: AppLoadContext): string | null {
	const cfEnv = (
		context as unknown as { cloudflare?: { env?: WorkerEnv }; env?: WorkerEnv }
	).cloudflare?.env;
	const fallbackEnv = (context as unknown as { env?: WorkerEnv }).env;
	const pem =
		cfEnv?.SUPABASE_JWT_PUBLIC_KEY ?? fallbackEnv?.SUPABASE_JWT_PUBLIC_KEY;
	return pem && pem.length > 0 ? pem : null;
}

/**
 * Pull `Authorization: Bearer <jwt>` from the request and verify it
 * **locally** vía ECDSA P-256 (ES256) contra la clave pública
 * `SUPABASE_JWT_PUBLIC_KEY` (PEM).
 *
 *   Por qué asimétrica local en lugar de `supabase.auth.getUser(token)`:
 *     - `getUser` hace fetch a `<project>.supabase.co/auth/v1/user`.
 *       En el runtime de Cloudflare Workers ese round-trip fallaba
 *       de forma intermitente (cold-start, rate-limit, latencia) y
 *       producía el 401 misterioso que bloqueaba el JIT del perfil.
 *     - El proyecto Supabase actual usa ECC P-256 como "Current Key"
 *       (HS256 queda como Legacy), así que la firma de los JWT
 *       nuevos es ES256.  La verificación con Web Crypto API es
 *       criptográficamente equivalente a la que hace Supabase
 *       internamente.
 *     - La clave PÚBLICA puede vivir en el Worker sin riesgo: si se
 *       filtra, NO permite emitir tokens (eso requiere la privada,
 *       que sólo Supabase tiene).
 *
 *   Códigos de error (throw → React Router los propaga al cliente):
 *     · NO_TOKEN_HEADER              header ausente o no-Bearer
 *     · JWT_PUBLIC_KEY_MISSING       `SUPABASE_JWT_PUBLIC_KEY` no provisionado
 *     · JWT_INVALID_OR_EXPIRED       firma no verifica o `exp` pasó
 *     · JWT_NO_SUB                   payload válido pero sin `sub`
 *     · ENV_VARS_MISSING_IN_CLOUDFLARE getSupabase() throw por env vars
 */
export async function verifyAuthToken(
	request: Request,
	context: AppLoadContext,
): Promise<VerifiedUser> {
	const auth = request.headers.get("authorization");
	if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
		// TODO: CLEANUP AUTH VERIFY DEBUG
		console.warn("[AUTH VERIFY] no Authorization header / not Bearer", {
			hasHeader: !!auth,
			preview: auth?.slice(0, 16),
		});
		throw jsonResponse(
			{ ok: false, error: "NO_TOKEN_HEADER" },
			{ status: 401, request },
		);
	}
	const token = auth.slice("bearer ".length).trim();
	if (!token) {
		// TODO: CLEANUP AUTH VERIFY DEBUG
		console.warn("[AUTH VERIFY] empty token after Bearer");
		throw jsonResponse(
			{ ok: false, error: "NO_TOKEN_HEADER", detail: "empty bearer" },
			{ status: 401, request },
		);
	}

	const jwtPublicKey = readJwtPublicKey(context);
	if (!jwtPublicKey) {
		// TODO: CLEANUP AUTH VERIFY DEBUG
		console.error(
			"[AUTH VERIFY] SUPABASE_JWT_PUBLIC_KEY no provisionado en CF env",
		);
		throw jsonResponse(
			{
				ok: false,
				error: "JWT_PUBLIC_KEY_MISSING",
				detail: "SUPABASE_JWT_PUBLIC_KEY missing in Cloudflare env",
			},
			{ status: 500, request },
		);
	}

	const payload = await verifySupabaseJwtLocally(token, jwtPublicKey);
	if (!payload) {
		// TODO: CLEANUP AUTH VERIFY DEBUG
		console.error("[AUTH VERIFY] JWT no verifica ES256 o está expirado", {
			tokenPreview: token.slice(0, 12) + "…",
		});
		throw jsonResponse(
			{ ok: false, error: "JWT_INVALID_OR_EXPIRED" },
			{ status: 401, request },
		);
	}

	if (!payload.sub) {
		// TODO: CLEANUP AUTH VERIFY DEBUG
		console.error("[AUTH VERIFY] JWT válido pero sin `sub`", { payload });
		throw jsonResponse(
			{ ok: false, error: "JWT_NO_SUB" },
			{ status: 401, request },
		);
	}

	let supabase: SupabaseClient;
	try {
		supabase = getSupabase(context);
	} catch (err) {
		// TODO: CLEANUP AUTH VERIFY DEBUG
		console.error("[AUTH VERIFY] getSupabase threw — check env vars", {
			thrown: err instanceof Response ? `Response(${err.status})` : String(err),
		});
		throw jsonResponse(
			{
				ok: false,
				error: "ENV_VARS_MISSING_IN_CLOUDFLARE",
				detail: String(err),
			},
			{ status: 401, request },
		);
	}

	return {
		id: payload.sub,
		email: payload.email ?? null,
		supabase,
	};
}
