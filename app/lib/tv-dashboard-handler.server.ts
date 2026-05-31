import type { AppLoadContext } from "react-router";
import { requireTenantRole } from "./cookie-auth.server";
import { extractSlugFromHost } from "./tenant";

/**
 * Loader del Jumbotron `/tv/dashboard`.  Igual que `/tv/music` (auth por
 * cookie con rol display/admin, top de canciones) pero además resuelve la
 * BATALLA en vivo (si la hay) con las dos canciones enfrentadas, para que
 * la pantalla pueda arrancar directamente en modo DUELO sin esperar al WS.
 */

type TvTrack = {
	id: string;
	title: string;
	artist: string;
	cover_image_url: string | null;
	total_votes: number;
	is_played: boolean;
};

export type TvDashboardData = {
	tenant_slug: string;
	tenant_id: string;
	event_id: string | null;
	tracks: TvTrack[];
	battle: { id: string; ends_at: string; a: TvTrack; b: TvTrack } | null;
};

export async function loadTvDashboard(
	request: Request,
	context: AppLoadContext,
): Promise<TvDashboardData> {
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

	const { data: activeEvent } = await supabase
		.from("tenant_events")
		.select("id, status")
		.eq("tenant_id", tenant_id)
		.in("status", ["active", "draft"])
		.order("start_time", { ascending: false })
		.limit(1)
		.maybeSingle();

	const event_id = (activeEvent?.id as string | undefined) ?? null;

	let tracks: TvTrack[] = [];
	let battle: TvDashboardData["battle"] = null;

	if (event_id) {
		const { data } = await supabase
			.from("event_tracks")
			.select("id, title, artist, cover_image_url, total_votes, is_played")
			.eq("tenant_id", tenant_id)
			.eq("event_id", event_id)
			.order("total_votes", { ascending: false })
			.order("title", { ascending: true })
			.limit(10);
		tracks = (data ?? []) as TvTrack[];

		// Batalla viva (si la hay) → resolvemos las dos canciones.
		const { data: b } = await supabase
			.from("live_battles")
			.select("id, track_a, track_b, ends_at")
			.eq("tenant_id", tenant_id)
			.eq("event_id", event_id)
			.eq("status", "live")
			.order("started_at", { ascending: false })
			.limit(1)
			.maybeSingle();

		if (b?.id) {
			const { data: bt } = await supabase
				.from("event_tracks")
				.select("id, title, artist, cover_image_url, total_votes, is_played")
				.in("id", [b.track_a as string, b.track_b as string]);
			const rows = (bt ?? []) as TvTrack[];
			const a = rows.find((r) => r.id === b.track_a);
			const bb = rows.find((r) => r.id === b.track_b);
			if (a && bb) {
				battle = { id: b.id as string, ends_at: b.ends_at as string, a, b: bb };
			}
		}
	}

	return { tenant_slug: tenantSlug, tenant_id, event_id, tracks, battle };
}
