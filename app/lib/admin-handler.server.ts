import type { AppLoadContext } from "react-router";
import { jsonResponse, preflight, verifyAuthToken } from "./api.server";
import { getServiceSupabase } from "./supabase.server";
import { pickTenantSlug } from "./tenant-resolver.server";

/**
 * Handler de `/api/admin` — consola del DJ/Staff.
 *
 *   Seguridad (defensa en profundidad):
 *     · JWT obligatorio (actor = auth uid del JWT, nunca del body).
 *     · TODA operación se autoriza con `is_tenant_staff(tenant, actor)`.
 *       Las RPCs `admin_*` ya lo revalidan server-side; las escrituras
 *       directas de campos editables (evento/tracks) lo comprueban aquí
 *       antes de tocar la tabla con el service client.
 *
 *   Operaciones (`op`):
 *     bootstrap · open_party · update_event · bulk_global · add_track ·
 *     update_track · remove_track · now_playing · start_battle ·
 *     force_close_battle · metrics
 */

type AdminBody = {
	op?: string;
	tenant_slug?: string;
	// payloads variados
	name?: string;
	start_time?: string;
	end_time?: string;
	status?: string;
	raw?: string;
	global_id?: string;
	track_id?: string;
	title?: string;
	artist?: string;
	cover_image_url?: string;
	minutes?: number;
	event_id?: string;
};

type ParsedTrack = {
	spotify_id: string;
	title: string;
	artist: string;
	cover_image_url: string | null;
};

/**
 * Parser de carga masiva — a prueba de balas para el formato tipo SQL:
 *
 *   ('0TJYJrUDKQ1btt4g0Xwklw', 'LA GRACIOSA', 'Quevedo, Elvis Crespo', 'https://…')
 *
 *   Estrategia (respeta comas DENTRO de los campos, p.ej. "Quevedo, Elvis Crespo",
 *   y admite varias tuplas en la MISMA línea separadas por `), (`):
 *     1. Extrae primero TODOS los bloques entre paréntesis `(...)`.
 *     2. Dentro de cada bloque, extrae los strings entre comillas simples o
 *        dobles con /(['"])(.*?)\1/g  → las comas internas se ignoran.
 *     3. Mapea [spotify_id, title, artist, cover?].  Cover (4º) opcional.
 *
 *   Fallback (si NO hay paréntesis): una canción por línea separada por TAB
 *   o PIPE (nunca coma) — para pegados crudos de Excel/Sheets.
 */
function parseBulk(raw: string): ParsedTrack[] {
	const out: ParsedTrack[] = [];

	const pushFields = (fields: string[]) => {
		const [spotify_id, title, artist, cover] = fields.map((f) => f.trim());
		if (!spotify_id || !title || !artist) return;
		out.push({
			spotify_id: spotify_id.slice(0, 256),
			title: title.slice(0, 256),
			artist: artist.slice(0, 256),
			cover_image_url: cover ? cover.slice(0, 1024) : null,
		});
	};

	// 1) Formato tipo SQL: bloques (...) en cualquier parte del texto.
	const blocks = raw.match(/\(([^()]*)\)/g);
	if (blocks && blocks.length > 0) {
		for (const block of blocks) {
			const quoted = block.match(/(['"])(.*?)\1/g);
			if (!quoted || quoted.length < 3) continue;
			pushFields(quoted.map((q) => q.slice(1, -1)));
		}
		return out;
	}

	// 2) Fallback Excel/Sheets: línea por línea, TAB o PIPE (jamás la coma).
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		pushFields(trimmed.split(/\t|\|/).map((f) => f.replace(/^['"]|['"]$/g, "")));
	}
	return out;
}

export async function handleAdminAction(
	request: Request,
	context: AppLoadContext,
): Promise<Response> {
	const cors = preflight(request);
	if (cors) return cors;

	if (request.method !== "POST") {
		return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405, request });
	}

	let verifiedId: string | null = null;
	try {
		const verified = await verifyAuthToken(request, context);
		verifiedId = verified?.id ?? null;
	} catch {
		verifiedId = null;
	}
	if (!verifiedId) {
		return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401, request });
	}

	let body: AdminBody;
	try {
		body = (await request.json()) as AdminBody;
	} catch {
		return jsonResponse({ ok: false, error: "invalid_json" }, { status: 400, request });
	}

	const op = String(body.op ?? "").trim();
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

	// Tenant
	const { data: tenant } = await supabase
		.from("tenants")
		.select("id")
		.eq("slug", slugResult.slug)
		.maybeSingle();
	if (!tenant) {
		return jsonResponse({ ok: false, error: "unknown_tenant" }, { status: 404, request });
	}
	const tenant_id = tenant.id as string;

	// ¿Es staff?  (gate único para todo el panel)
	const { data: isStaff } = await supabase.rpc("is_tenant_staff", {
		p_tenant_id: tenant_id,
		p_auth_uid: verifiedId,
	});
	const staff = isStaff === true;

	// `bootstrap` siempre responde (con is_staff:false si procede) para que
	// el front pinte "acceso restringido" en vez de un 403 seco.
	if (op === "bootstrap") {
		if (!staff) {
			return jsonResponse({ ok: true, is_staff: false }, { request });
		}
		return jsonResponse(await bootstrap(supabase, tenant_id), { request });
	}

	if (!staff) {
		return jsonResponse({ ok: false, error: "forbidden" }, { status: 403, request });
	}

	// A partir de aquí, staff garantizado.
	switch (op) {
		case "open_party": {
			const { data } = await supabase.rpc("admin_open_party", {
				p_tenant_id: tenant_id,
				p_actor_uid: verifiedId,
				p_name: body.name ?? null,
			});
			return jsonResponse(data ?? { ok: false, error: "rpc_failed" }, { request });
		}

		case "update_event": {
			const eventId = String(body.event_id ?? "");
			if (!eventId) return jsonResponse({ ok: false, error: "event_id_required" }, { status: 400, request });
			const patch: Record<string, unknown> = {};
			if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
			if (typeof body.start_time === "string") patch.start_time = body.start_time;
			if (typeof body.end_time === "string") patch.end_time = body.end_time;
			if (body.status === "active" || body.status === "ended" || body.status === "scheduled") patch.status = body.status;
			if (Object.keys(patch).length === 0) return jsonResponse({ ok: false, error: "nothing_to_update" }, { status: 400, request });
			const { error } = await supabase.from("tenant_events").update(patch).eq("id", eventId).eq("tenant_id", tenant_id);
			if (error) return jsonResponse({ ok: false, error: "update_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "update_event",
				table_name: "tenant_events", record_id: eventId, new_data: patch,
			});
			return jsonResponse({ ok: true }, { request });
		}

		case "bulk_global": {
			const tracks = parseBulk(String(body.raw ?? ""));
			if (tracks.length === 0) return jsonResponse({ ok: false, error: "no_valid_rows" }, { status: 400, request });
			const { data } = await supabase.rpc("admin_bulk_insert_global", {
				p_tenant_id: tenant_id, p_actor_uid: verifiedId, p_tracks: tracks,
			});
			return jsonResponse(data ?? { ok: false, error: "rpc_failed" }, { request });
		}

		case "add_track": {
			const { data } = await supabase.rpc("admin_add_event_track", {
				p_tenant_id: tenant_id, p_actor_uid: verifiedId,
				p_event_id: String(body.event_id ?? ""), p_global_id: String(body.global_id ?? ""),
			});
			return jsonResponse(data ?? { ok: false, error: "rpc_failed" }, { request });
		}

		case "update_track": {
			const trackId = String(body.track_id ?? "");
			if (!trackId) return jsonResponse({ ok: false, error: "track_id_required" }, { status: 400, request });
			const patch: Record<string, unknown> = {};
			if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 256);
			if (typeof body.artist === "string" && body.artist.trim()) patch.artist = body.artist.trim().slice(0, 256);
			if (typeof body.cover_image_url === "string") patch.cover_image_url = body.cover_image_url.trim() || null;
			if (Object.keys(patch).length === 0) return jsonResponse({ ok: false, error: "nothing_to_update" }, { status: 400, request });
			const { error } = await supabase.from("event_tracks").update(patch).eq("id", trackId).eq("tenant_id", tenant_id);
			if (error) return jsonResponse({ ok: false, error: "update_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "update_event_track",
				table_name: "event_tracks", record_id: trackId, new_data: patch,
			});
			return jsonResponse({ ok: true }, { request });
		}

		case "remove_track": {
			const trackId = String(body.track_id ?? "");
			if (!trackId) return jsonResponse({ ok: false, error: "track_id_required" }, { status: 400, request });
			const { error } = await supabase.from("event_tracks").delete().eq("id", trackId).eq("tenant_id", tenant_id);
			if (error) return jsonResponse({ ok: false, error: "delete_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "remove_event_track",
				table_name: "event_tracks", record_id: trackId,
			});
			return jsonResponse({ ok: true }, { request });
		}

		case "now_playing": {
			const { data } = await supabase.rpc("admin_set_now_playing", {
				p_tenant_id: tenant_id, p_actor_uid: verifiedId,
				p_event_id: String(body.event_id ?? ""), p_track_id: String(body.track_id ?? ""),
			});
			return jsonResponse(data ?? { ok: false, error: "rpc_failed" }, { request });
		}

		case "start_battle": {
			const { data } = await supabase.rpc("admin_start_battle", {
				p_tenant_id: tenant_id, p_actor_uid: verifiedId,
				p_event_id: String(body.event_id ?? ""),
				p_minutes: Number.isInteger(body.minutes) ? Number(body.minutes) : 3,
			});
			return jsonResponse(data ?? { ok: false, error: "rpc_failed" }, { request });
		}

		case "force_close_battle": {
			const { data } = await supabase.rpc("admin_force_close_battle", {
				p_tenant_id: tenant_id, p_actor_uid: verifiedId, p_event_id: String(body.event_id ?? ""),
			});
			return jsonResponse(data ?? { ok: false, error: "rpc_failed" }, { request });
		}

		// Autocierre QUIRÚRGICO: cierra sólo las batallas vencidas (ends_at<=now).
		// Lo invoca el timer del cliente cuando expira `ends_at` (sustituye al
		// viejo polling).  El UPDATE de live_battles dispara Realtime → todas
		// las UIs (móviles, TV) vuelven a la normalidad con el ganador.
		case "resolve_battles": {
			const { data } = await supabase.rpc("resolve_due_battles", { p_tenant_id: tenant_id });
			return jsonResponse({ ok: true, closed: Number(data ?? 0) }, { request });
		}

		case "metrics": {
			const { data } = await supabase.rpc("get_admin_metrics", {
				p_tenant_id: tenant_id, p_actor_uid: verifiedId, p_event_id: String(body.event_id ?? ""),
			});
			return jsonResponse(data ?? { ok: false, error: "rpc_failed" }, { request });
		}

		default:
			return jsonResponse({ ok: false, error: "unknown_op" }, { status: 400, request });
	}
}

async function bootstrap(
	supabase: ReturnType<typeof getServiceSupabase>,
	tenant_id: string,
) {
	// Evento activo (si lo hay)
	const { data: event } = await supabase
		.from("tenant_events")
		.select("id, name, start_time, end_time, status")
		.eq("tenant_id", tenant_id)
		.eq("status", "active")
		.order("start_time", { ascending: false })
		.limit(1)
		.maybeSingle();

	// Biblioteca global
	const { data: globalTracks } = await supabase
		.from("global_tracks")
		.select("id, spotify_id, title, artist, cover_image_url")
		.eq("tenant_id", tenant_id)
		.order("created_at", { ascending: false })
		.limit(500);

	let eventTracks: unknown[] = [];
	let battle: unknown = null;
	if (event) {
		const { data: et } = await supabase
			.from("event_tracks")
			.select("id, spotify_id, title, artist, cover_image_url, total_votes, is_played")
			.eq("tenant_id", tenant_id)
			.eq("event_id", event.id)
			.order("total_votes", { ascending: false })
			.order("title", { ascending: true });
		eventTracks = et ?? [];

		const { data: b } = await supabase
			.from("live_battles")
			.select("id, track_a, track_b, status, started_at, ends_at, winner_track")
			.eq("tenant_id", tenant_id)
			.eq("event_id", event.id)
			.eq("status", "live")
			.order("started_at", { ascending: false })
			.limit(1)
			.maybeSingle();
		battle = b ?? null;
	}

	return {
		ok: true,
		is_staff: true,
		tenant_id, // lo usa el cliente para filtrar la suscripción Realtime
		event: event ?? null,
		global_tracks: globalTracks ?? [],
		event_tracks: eventTracks,
		battle,
	};
}
