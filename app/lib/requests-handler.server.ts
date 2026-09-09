import type { AppLoadContext } from "react-router";
import { jsonResponse, preflight, verifyAuthToken } from "./api.server";
import { getServiceSupabase } from "./supabase.server";
import { pickTenantSlug, resolveTenantProfile } from "./tenant-resolver.server";

/**
 * /api/requests — pedirle al DJ una canción que la sala NO tiene.
 *
 *   Ojo con la distinción, que me costó una vuelta entera: el Jukebox ya
 *   sirve el REPERTORIO COMPLETO del local (`event_catalog`) y crea la fila
 *   del evento al votar, así que cualquier canción que la sala tenga
 *   guardada ya se puede pedir desde ahí aunque el DJ no la cargara esa
 *   noche.  Lo que no se podía era pedir algo que no está en el almacén — y
 *   eso es justo lo que la gente quiere: "¿puedes poner tal?".
 *
 *   Por eso va en texto libre.  Lo que alguien escribe NO se le enseña a
 *   ningún otro cliente: sólo al staff, y el DJ decide si entra.
 */

type RequestBody = {
	event_id?: string;
	title?: string;
	artist?: string;
	tenant_slug?: string;
};

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

	const title = String(body.title ?? "").trim().slice(0, 80);
	const artist = String(body.artist ?? "").trim().slice(0, 80);
	if (!body.event_id || title.length < 2) {
		return jsonResponse({ ok: false, error: "event_and_title_required" }, { status: 400, request });
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

	const { data, error } = await supabase.rpc("request_new_track", {
		p_tenant_id: tenant_id,
		p_user_id: user_profile_id,
		p_event_id: body.event_id,
		p_title: title,
		p_artist: artist || null,
	});
	if (error) {
		return jsonResponse({ ok: false, error: "request_failed", detail: error.message }, { status: 500, request });
	}
	// El RPC decide: título inválido, ya la tenemos, ya la pediste o cupo
	// agotado.  Se devuelve tal cual para que la app diga qué ha pasado.
	return jsonResponse((data ?? { ok: false, error: "unknown" }) as object, { request });
}
