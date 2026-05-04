import type { Route } from "./+types/api.track";
import { getSupabase } from "../lib/supabase.server";
import {
	corsHeaders,
	jsonResponse,
	preflight,
	verifyAuthToken,
} from "../lib/api.server";
import { extractSlugFromHost } from "../lib/tenant";

/**
 * POST /api/track  — analytics ingestion endpoint (zero-trust).
 *
 *  - CORS allowlist (no wildcards).
 *  - Authorization: Bearer <jwt>.  If present, the JWT is verified and
 *    the resulting `user.id` OVERWRITES anything the client sent.  We
 *    NEVER trust a client-provided user_id.
 *  - Anonymous (no JWT) requests are still accepted for pre-login
 *    onboarding analytics; their user_id is forced to NULL.
 *  - Single event or batch (offline-queue flush hits the same handler).
 *  - Strict multi-tenant: every event MUST resolve to a tenant slug
 *    (payload, header, or hostname).  No fallback default.
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

export async function action({ request, context }: Route.ActionArgs) {
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

	// JWT — optional but trusted when present.  Anonymous events are kept
	// (no user_id) so we can still track pre-login funnel.
	const verified = await verifyAuthToken(request, context);
	const verifiedUserId = verified?.id ?? null;

	const headerSlug = request.headers.get("x-tenant-slug");
	const hostSlug = hostnameToSlug(request);

	let supabase: ReturnType<typeof getSupabase>;
	try {
		supabase = verified?.supabase ?? getSupabase(context);
	} catch {
		console.warn("[api.track] supabase not configured; dropping events");
		return jsonResponse(
			{ ok: true, written: 0, dropped: events.length },
			{ request },
		);
	}

	// Strict multi-tenant — every event MUST carry a slug.  No defaults.
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
		console.warn("[api.track] tenant lookup failed", tenantErr.message);
		return jsonResponse(
			{ ok: false, error: "tenant_lookup_failed" },
			{ status: 500, request },
		);
	}

	const slugToId = new Map<string, string>(
		(tenants ?? []).map((t) => [t.slug as string, t.id as string]),
	);

	// If we have a verified JWT user, resolve their profile id ONCE per
	// tenant so we can stamp every row consistently.
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

			// ZERO-TRUST: if a JWT is present, the user_id ALWAYS comes from
			// the verified profile.  Otherwise it's NULL.  Client-supplied
			// user_id is ignored.
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
		console.warn("[api.track] insert failed", insertErr.message);
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

export function loader({ request }: Route.LoaderArgs) {
	const cors = preflight(request);
	if (cors) return cors;
	return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
		status: 405,
		headers: {
			"Content-Type": "application/json",
			...corsHeaders(request.headers.get("origin")),
		},
	});
}
