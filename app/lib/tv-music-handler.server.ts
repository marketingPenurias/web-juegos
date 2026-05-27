import type { AppLoadContext } from "react-router";
import { requireTenantRole } from "./cookie-auth.server";
import { extractSlugFromHost } from "./tenant";

/**
 * Server-side handler for the `/tv/music` page loader.  Lives in a
 * dedicated `.server.ts` module so the route file stays a 1-line shim
 * — the way RR7's analyser likes resource-ish routes.
 *
 * Authentication uses the browser's Supabase auth cookie (no
 * `Authorization` header on a page navigation).  Role guard requires
 * either `display` (the kiosk account) or `admin`.
 */

export type JumbotronLoaderData = {
	tenant_slug: string;
	tenant_id: string;
	event_id: string | null;
	tracks: Array<{
		id: string;
		title: string;
		artist: string;
		cover_image_url: string | null;
		total_votes: number;
		is_played: boolean;
	}>;
};

export async function loadJumbotron(
	request: Request,
	context: AppLoadContext,
): Promise<JumbotronLoaderData> {
	const url = new URL(request.url);
	const tenantSlug = extractSlugFromHost(url.hostname) || "lapocha";

	const auth = await requireTenantRole(request, context, tenantSlug, [
		"display",
		"admin",
	]);
	if (!auth.ok) {
		throw new Response(JSON.stringify({ ok: false, error: auth.error }), {
			status: auth.status,
			headers: { "Content-Type": "application/json" },
		});
	}

	const supabase = auth.user.supabase;
	const tenant_id = auth.tenant_id;

	// Pick the most recent ACTIVE event for this tenant — TV displays
	// the live night.  Falls back to the most recently started event if
	// nothing is currently `active`.
	const { data: activeEvent } = await supabase
		.from("tenant_events")
		.select("id, status")
		.eq("tenant_id", tenant_id)
		.in("status", ["active", "draft"])
		.order("start_time", { ascending: false })
		.limit(1)
		.maybeSingle();

	const event_id = (activeEvent?.id as string | undefined) ?? null;

	let tracks: JumbotronLoaderData["tracks"] = [];
	if (event_id) {
		// Jumbotron renders MAX_ROWS = 8.  Fetching 10 gives us a tiny
		// safety margin (covers the case where the WS reconciliation
		// races ahead and a row falls off the bottom) without paying
		// for the rest of the catalog on every loader hit.
		const { data } = await supabase
			.from("event_tracks")
			.select(
				"id, title, artist, cover_image_url, total_votes, is_played",
			)
			.eq("tenant_id", tenant_id)
			.eq("event_id", event_id)
			.order("total_votes", { ascending: false })
			.order("title", { ascending: true })
			.limit(10);
		tracks = (data ?? []) as JumbotronLoaderData["tracks"];
	}

	return {
		tenant_slug: tenantSlug,
		tenant_id,
		event_id,
		tracks,
	};
}
