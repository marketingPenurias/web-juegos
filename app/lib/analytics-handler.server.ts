import type { AppLoadContext } from "react-router";
import { getServiceSupabase } from "./supabase.server";
import {
	corsHeaders,
	jsonResponse,
	preflight,
	verifyAuthToken,
} from "./api.server";
import { extractSlugFromHost } from "./tenant";

/**
 * Shared ingestion handler for `/api/analytics` and the legacy
 * `/api/track` alias.  Encapsulates the full request lifecycle so the
 * two route files stay one-line shims.
 *
 *  - CORS allowlist (no wildcards).
 *  - Authorization: Bearer <jwt> — verified when present; the
 *    user_id stamped onto every row comes from the JWT, never from the
 *    payload.  Anonymous events (no JWT) get user_id = NULL so we keep
 *    pre-login funnel data.
 *  - Single event or batch (offline-queue flush hits the same handler).
 *  - Strict multi-tenant: every event MUST resolve a tenant slug.
 */

const MAX_BATCH = 200;

type IncomingEvent = {
	tenant_slug?: string;
	user_id?: string | null;
	visit_id?: string | null;
	category?: string;
	action?: string;
	event_category?: string;
	event_action?: string;
	metadata?: Record<string, unknown> | null;
	client_ts?: string;
};

function pickTenantSlug(
	event: IncomingEvent,
	headerSlug: string | null,
	hostSlug: string | null,
): string | null {
	const raw = event.tenant_slug || headerSlug || hostSlug;
	if (!raw) return null;
	const cleaned = String(raw).trim().toLowerCase().slice(0, 64);
	return cleaned || null;
}

function hostnameToSlug(request: Request): string | null {
	try {
		const slug = extractSlugFromHost(new URL(request.url).hostname);
		return slug || null;
	} catch {
		return null;
	}
}

export async function handleAnalyticsAction(
	request: Request,
	context: AppLoadContext,
): Promise<Response> {
	const cors = preflight(request);
	if (cors) return cors;

	if (request.method !== "POST") {
		return jsonResponse(
			{ ok: false, error: "method_not_allowed" },
			{ status: 405, request },
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return jsonResponse(
			{ ok: false, error: "invalid_json" },
			{ status: 400, request },
		);
	}

	const events: IncomingEvent[] = Array.isArray(body)
		? (body as IncomingEvent[])
		: [body as IncomingEvent];

	if (events.length === 0) {
		return jsonResponse({ ok: true, written: 0 }, { request });
	}
	if (events.length > MAX_BATCH) {
		return jsonResponse(
			{ ok: false, error: "batch_too_large", limit: MAX_BATCH },
			{ status: 413, request },
		);
	}

	// Analítica acepta eventos ANÓNIMOS (funnel pre-login).  `verifyAuthToken`
	// LANZA una Response cuando no hay/!válido el JWT — por eso antes TODOS
	// los eventos anónimos morían con 401 y `behavior_events` quedaba vacía.
	// Lo envolvemos: sin token válido → anónimo (user_id = NULL), no 401.
	let verifiedUserId: string | null = null;
	try {
		const verified = await verifyAuthToken(request, context);
		verifiedUserId = verified?.id ?? null;
	} catch {
		verifiedUserId = null;
	}

	const headerSlug = request.headers.get("x-tenant-slug");
	const hostSlug = hostnameToSlug(request);

	// Escritura SIEMPRE con service-role: los inserts antes iban por la
	// anon-key y la RLS de `behavior_events` (current_tenant_id() desde el
	// JWT) los bloqueaba silenciosamente.  El service client es la vía fiable.
	let supabase: ReturnType<typeof getServiceSupabase>;
	try {
		supabase = getServiceSupabase(context);
	} catch {
		console.warn("[analytics] supabase not configured; dropping events");
		return jsonResponse(
			{ ok: true, written: 0, dropped: events.length },
			{ request },
		);
	}

	const perEventSlugs = events.map((e) =>
		pickTenantSlug(e, headerSlug, hostSlug),
	);
	if (perEventSlugs.some((s) => !s)) {
		return jsonResponse(
			{ ok: false, error: "missing_tenant" },
			{ status: 400, request },
		);
	}
	const slugs = Array.from(new Set(perEventSlugs as string[]));

	const { data: tenants, error: tenantErr } = await supabase
		.from("tenants")
		.select("id, slug")
		.in("slug", slugs);

	if (tenantErr) {
		console.warn("[analytics] tenant lookup failed", tenantErr.message);
		return jsonResponse(
			{ ok: false, error: "tenant_lookup_failed" },
			{ status: 500, request },
		);
	}

	const slugToId = new Map<string, string>(
		(tenants ?? []).map((t) => [t.slug as string, t.id as string]),
	);

	const profileIdByTenant = new Map<string, string>();
	if (verifiedUserId) {
		for (const slug of slugs) {
			const tid = slugToId.get(slug);
			if (!tid) continue;
			const { data: profile } = await supabase
				.from("user_profiles")
				.select("id")
				.eq("tenant_id", tid)
				.eq("auth_user_id", verifiedUserId)
				.maybeSingle();
			if (profile?.id) profileIdByTenant.set(slug, profile.id as string);
		}
	}

	const rows = events
		.map((e, idx) => {
			const slug = perEventSlugs[idx]!;
			const tenant_id = slugToId.get(slug);
			if (!tenant_id) return null;

			const category = e.event_category ?? e.category ?? "uncategorized";
			const action = e.event_action ?? e.action ?? "unspecified";

			const user_id = verifiedUserId
				? profileIdByTenant.get(slug) ?? null
				: null;

			return {
				tenant_id,
				user_id,
				visit_id: e.visit_id ?? null,
				event_category: String(category).slice(0, 64),
				event_action: String(action).slice(0, 64),
				metadata: {
					...(e.metadata ?? {}),
					...(e.client_ts ? { client_ts: e.client_ts } : {}),
					...(verifiedUserId ? { auth_user_id: verifiedUserId } : {}),
				},
			};
		})
		.filter((row): row is NonNullable<typeof row> => row !== null);

	if (rows.length === 0) {
		return jsonResponse(
			{
				ok: true,
				written: 0,
				dropped: events.length,
				reason: "no_matching_tenant",
			},
			{ request },
		);
	}

	const { error: insertErr } = await supabase
		.from("behavior_events")
		.insert(rows);

	if (insertErr) {
		console.warn("[analytics] insert failed", insertErr.message);
		return jsonResponse(
			{ ok: false, error: "insert_failed" },
			{ status: 500, request },
		);
	}

	return jsonResponse(
		{ ok: true, written: rows.length, authenticated: !!verifiedUserId },
		{ request },
	);
}

export function analyticsLoader(request: Request): Response {
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
