import type { Route } from "./+types/api.track";
import { getSupabase } from "../lib/supabase.server";

/**
 * POST /api/track  — analytics ingestion endpoint.
 *
 * Accepts either:
 *   • a single event:  { tenant_slug, category, action, metadata?, ... }
 *   • a batch array:   [{ ... }, { ... }]
 *
 * Tenant resolution
 * ── 1) explicit `tenant_slug` in the payload (preferred, per-event)
 * ── 2) `X-Tenant-Slug` HTTP header (per-request)
 * ── 3) hostname (e.g. lapocha.example.com → "lapocha")
 * ── 4) DEFAULT_TENANT
 *
 * The endpoint always responds 200 immediately on accepted payloads so the
 * caller's `keepalive: true` fetch can fire and forget.  Storage errors are
 * logged via console.warn so Cloudflare observability picks them up.
 */

const DEFAULT_TENANT = "lapocha";
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
): string {
	const slug = event.tenant_slug || headerSlug || hostSlug || DEFAULT_TENANT;
	// Defensive: lowercase & strip
	return String(slug).trim().toLowerCase().slice(0, 64);
}

function hostnameToSlug(request: Request): string | null {
	try {
		const host = new URL(request.url).hostname;
		// e.g. "lapocha.bildy.es" → "lapocha"
		const sub = host.split(".")[0];
		if (!sub || sub === "localhost" || sub === "www") return null;
		return sub.toLowerCase();
	} catch {
		return null;
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	if (request.method !== "POST") {
		return Response.json(
			{ ok: false, error: "method_not_allowed" },
			{ status: 405 },
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json(
			{ ok: false, error: "invalid_json" },
			{ status: 400 },
		);
	}

	const events: IncomingEvent[] = Array.isArray(body)
		? (body as IncomingEvent[])
		: [body as IncomingEvent];

	if (events.length === 0) {
		return Response.json({ ok: true, written: 0 });
	}
	if (events.length > MAX_BATCH) {
		return Response.json(
			{ ok: false, error: "batch_too_large", limit: MAX_BATCH },
			{ status: 413 },
		);
	}

	const headerSlug = request.headers.get("x-tenant-slug");
	const hostSlug = hostnameToSlug(request);

	let supabase: ReturnType<typeof getSupabase>;
	try {
		supabase = getSupabase(context);
	} catch (err) {
		// Supabase not configured — accept silently so the client doesn't keep
		// retrying.  Non-2xx would re-queue the events forever.
		console.warn("[api.track] supabase not configured; dropping events");
		return Response.json({ ok: true, written: 0, dropped: events.length });
	}

	// Resolve unique tenant slugs to tenant_ids in a single query.
	const slugs = Array.from(
		new Set(events.map((e) => pickTenantSlug(e, headerSlug, hostSlug))),
	);

	const { data: tenants, error: tenantErr } = await supabase
		.from("tenants")
		.select("id, slug")
		.in("slug", slugs);

	if (tenantErr) {
		console.warn("[api.track] tenant lookup failed", tenantErr.message);
		return Response.json(
			{ ok: false, error: "tenant_lookup_failed" },
			{ status: 500 },
		);
	}

	const slugToId = new Map<string, string>(
		(tenants ?? []).map((t) => [t.slug as string, t.id as string]),
	);

	const rows = events
		.map((e) => {
			const slug = pickTenantSlug(e, headerSlug, hostSlug);
			const tenant_id = slugToId.get(slug);
			if (!tenant_id) return null;

			const category = e.event_category ?? e.category ?? "uncategorized";
			const action = e.event_action ?? e.action ?? "unspecified";

			return {
				tenant_id,
				user_id: e.user_id ?? null,
				visit_id: e.visit_id ?? null,
				event_category: String(category).slice(0, 64),
				event_action: String(action).slice(0, 64),
				metadata: {
					...(e.metadata ?? {}),
					...(e.client_ts ? { client_ts: e.client_ts } : {}),
				},
			};
		})
		.filter((row): row is NonNullable<typeof row> => row !== null);

	if (rows.length === 0) {
		return Response.json({
			ok: true,
			written: 0,
			dropped: events.length,
			reason: "no_matching_tenant",
		});
	}

	const { error: insertErr } = await supabase
		.from("behavior_events")
		.insert(rows);

	if (insertErr) {
		console.warn("[api.track] insert failed", insertErr.message);
		return Response.json(
			{ ok: false, error: "insert_failed" },
			{ status: 500 },
		);
	}

	return Response.json({ ok: true, written: rows.length });
}

// GET /api/track is not supported — keeps loaders from accidentally hitting it.
export function loader() {
	return Response.json(
		{ ok: false, error: "method_not_allowed" },
		{ status: 405 },
	);
}
