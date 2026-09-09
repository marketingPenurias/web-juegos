import type { AppLoadContext } from "react-router";
import { jsonResponse, preflight, verifyAuthToken } from "./api.server";
import { getServiceSupabase } from "./supabase.server";
import { pickTenantSlug, resolveTenantProfile } from "./tenant-resolver.server";

/**
 * /api/requests — pedirle una canción al DJ.
 *
 *   El Jukebox sólo deja votar lo que el DJ cargó esta noche, y esa es su
 *   sesión.  Pero deja sin respuesta la pregunta que se hace en cualquier
 *   discoteca —"¿puedes poner tal?"— y hasta ahora la app contestaba con el
 *   silencio: buscabas, no salía, y parecía rota.
 *
 *   Se pide del ALMACÉN de la sala, no en texto libre.  La Pocha tiene 759
 *   temas guardados y suele cargar ~520: hay más de doscientas canciones que
 *   el DJ ya tiene y esa noche no puso.  Así recibe una canción de verdad,
 *   con su género y su carátula, que mete de un toque — en vez de un texto
 *   suelto que alguien tiene que buscar a las tres de la mañana.
 *
 *   GET  ?q=…  → buscar en el almacén lo que NO está esta noche
 *   POST       → pedir una
 */

const MAX_RESULTS = 8;

type RequestBody = {
	event_id?: string;
	global_track_id?: string;
	tenant_slug?: string;
};

/** Escapa los comodines de PostgREST para que una búsqueda con % no barra. */
function escapeLike(term: string): string {
	return term.replace(/[%_,()]/g, " ").trim();
}

export async function handleRequestsLoader(
	request: Request,
	context: AppLoadContext,
): Promise<Response> {
	const cors = preflight(request);
	if (cors) return cors;

	const verified = await verifyAuthToken(request, context);
	if (!verified) {
		return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401, request });
	}

	const url = new URL(request.url);
	const q = escapeLike(String(url.searchParams.get("q") ?? "")).slice(0, 60);
	const eventId = url.searchParams.get("event_id");
	if (q.length < 2) {
		return jsonResponse({ ok: true, tracks: [] }, { request });
	}

	const slugResult = pickTenantSlug(url.searchParams.get("tenant_slug"), request);
	if (!slugResult.ok) {
		return jsonResponse({ ok: false, error: slugResult.error }, { status: 400, request });
	}

	let supabase: ReturnType<typeof getServiceSupabase>;
	try {
		supabase = getServiceSupabase(context);
	} catch (err) {
		if (err instanceof Response) return err;
		return jsonResponse({ ok: false, error: "service_unavailable" }, { status: 503, request });
	}

	const profileResult = await resolveTenantProfile(supabase, slugResult.slug, verified.id);
	if (!profileResult.ok) {
		return jsonResponse({ ok: false, error: profileResult.error }, { status: 404, request });
	}
	const { tenant_id } = profileResult.data;

	const { data, error } = await supabase
		.from("global_tracks")
		.select("id, title, artist, cover_image_url, genre, spotify_id")
		.eq("tenant_id", tenant_id)
		.or(`title.ilike.%${q}%,artist.ilike.%${q}%`)
		.order("title")
		.limit(40);
	if (error) {
		return jsonResponse({ ok: false, error: "search_failed", detail: error.message }, { status: 500, request });
	}

	// Fuera lo que ya está sonando esta noche: para eso está el Jukebox, y
	// ofrecer "pedir" algo que ya se puede votar sólo confunde.
	let inParty = new Set<string>();
	if (eventId) {
		const { data: rows } = await supabase
			.from("event_tracks")
			.select("spotify_id")
			.eq("event_id", eventId)
			.eq("tenant_id", tenant_id);
		inParty = new Set((rows ?? []).map((r) => String(r.spotify_id)));
	}

	const tracks = (data ?? [])
		.filter((t) => !inParty.has(String(t.spotify_id)))
		.slice(0, MAX_RESULTS)
		.map((t) => ({
			id: t.id,
			title: t.title,
			artist: t.artist,
			genre: t.genre,
			cover_image_url: t.cover_image_url,
		}));

	return jsonResponse({ ok: true, tracks }, { request });
}

export async function handleRequestsAction(
	request: Request,
	context: AppLoadContext,
): Promise<Response> {
	const cors = preflight(request);
	if (cors) return cors;

	if (request.method !== "POST") {
		return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405, request });
	}

	const verified = await verifyAuthToken(request, context);
	if (!verified) {
		return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401, request });
	}

	let body: RequestBody;
	try {
		body = (await request.json()) as RequestBody;
	} catch {
		return jsonResponse({ ok: false, error: "invalid_json" }, { status: 400, request });
	}
	if (!body.event_id || !body.global_track_id) {
		return jsonResponse({ ok: false, error: "event_and_track_required" }, { status: 400, request });
	}

	const slugResult = pickTenantSlug(body.tenant_slug, request);
	if (!slugResult.ok) {
		return jsonResponse({ ok: false, error: slugResult.error }, { status: 400, request });
	}

	let supabase: ReturnType<typeof getServiceSupabase>;
	try {
		supabase = getServiceSupabase(context);
	} catch (err) {
		if (err instanceof Response) return err;
		return jsonResponse({ ok: false, error: "service_unavailable" }, { status: 503, request });
	}

	const profileResult = await resolveTenantProfile(supabase, slugResult.slug, verified.id);
	if (!profileResult.ok) {
		return jsonResponse({ ok: false, error: profileResult.error }, { status: 404, request });
	}
	const { tenant_id, user_profile_id } = profileResult.data;

	const { data, error } = await supabase.rpc("request_track", {
		p_tenant_id: tenant_id,
		p_user_id: user_profile_id,
		p_event_id: body.event_id,
		p_global_track_id: body.global_track_id,
	});
	if (error) {
		return jsonResponse({ ok: false, error: "request_failed", detail: error.message }, { status: 500, request });
	}
	// El RPC decide: ya está en la fiesta, ya la pediste, o se acabó el cupo.
	// Se devuelve tal cual para que la app diga exactamente qué ha pasado.
	return jsonResponse((data ?? { ok: false, error: "unknown" }) as object, { request });
}
