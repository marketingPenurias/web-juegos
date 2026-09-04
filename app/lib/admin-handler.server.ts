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
 *     bootstrap · open_party · create_event · activate_event · update_event ·
 *     bulk_global · add_track · update_track · remove_track · now_playing ·
 *     stop_now_playing · start_battle · force_close_battle · metrics ·
 *     save_template · apply_template · delete_template
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
	track_a?: string;
	track_b?: string;
	template_id?: string;
	title?: string;
	artist?: string;
	cover_image_url?: string;
	minutes?: number;
	event_id?: string;
	/** Activar una fiesta aunque no tenga ninguna canción. Decisión explícita. */
	confirm_empty?: boolean;
	global_ids?: string[];
	// Control de pantallas (TV): modo de fondo + visibilidad de capas.
	tv_mode?: string;
	tv_url?: string;
	tv_show_ranking?: boolean;
	tv_show_battle?: boolean;
	// V17: partir la pantalla mostrando la canción que suena ahora (mitad
	// derecha) junto al ranking (mitad izquierda).
	tv_show_now_playing?: boolean;
	// V21: Flash Drops — promoción con caducidad y stock lanzada por el DJ.
	product_id?: string;
	promo_price_eur?: number;
	stock?: number;
	label?: string;
	tokens_per_euro?: number;
	rule_id?: string;
	// V21: configuración de promociones editable por la sala.
	list_price_eur?: number;
	tier_code?: string;
	min_lifetime?: number;
	max_redemptions_per_night?: number | null;
	days?: number[];
	hour_from?: number | null;
	hour_to?: number | null;
	availability_id?: string;
	max_per_night?: number | null;
	// V22: moderación de nombres.
	profile_id?: string;
	is_active?: boolean;
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

			// Pegar en el textarea con una fiesta activa = el DJ quiere esas
			// canciones EN LA PISTA de hoy, no sólo guardadas en biblioteca.
			// Tras escribir en global_tracks, las reflejamos en event_tracks
			// (dedupe por spotify_id contra lo ya presente en el evento).
			let added_to_event = 0;
			const bulkEventId = String(body.event_id ?? "");
			if (bulkEventId) {
				const spotifyIds = tracks.map((t) => t.spotify_id);
				const { data: globals } = await supabase
					.from("global_tracks")
					.select("id, spotify_id, title, artist, cover_image_url")
					.eq("tenant_id", tenant_id)
					.in("spotify_id", spotifyIds);
				const { data: existing } = await supabase
					.from("event_tracks")
					.select("spotify_id")
					.eq("tenant_id", tenant_id)
					.eq("event_id", bulkEventId);
				const already = new Set(
					(existing ?? []).map((r) => (r as { spotify_id: string }).spotify_id),
				);
				const toInsert = (globals ?? [])
					.filter((g) => !already.has((g as { spotify_id: string }).spotify_id))
					.map((g) => {
						const row = g as {
							spotify_id: string; title: string; artist: string; cover_image_url: string | null;
						};
						return {
							tenant_id,
							event_id: bulkEventId,
							spotify_id: row.spotify_id,
							title: row.title,
							artist: row.artist,
							cover_image_url: row.cover_image_url,
						};
					});
				if (toInsert.length > 0) {
					const { error: insErr } = await supabase.from("event_tracks").insert(toInsert);
					if (!insErr) {
						added_to_event = toInsert.length;
						await supabase.from("audit_logs").insert({
							tenant_id, actor_id: verifiedId, action: "bulk_add_to_event",
							table_name: "event_tracks", record_id: bulkEventId,
							new_data: { count: added_to_event },
						});
					}
				}
			}

			return jsonResponse({ ...(data ?? { ok: true }), added_to_event }, { request });
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

		// Control remoto del FONDO de la TV (V1.7).  Persistimos en
		// tenant_events.metadata.tv_backdrop; la TV lo escucha por Realtime.
		// 'carousel' → fotos rotando · 'pinned' → una imagen fija (url).
		case "set_tv_backdrop": {
			const eventId = String(body.event_id ?? "");
			if (!eventId) return jsonResponse({ ok: false, error: "event_id_required" }, { status: 400, request });
			// 3 modos: 'video' (sólo vídeo) · 'photo' (foto fija + url) ·
			// 'carousel' (mixto: vídeo de base + fotos rotando).
			const mode =
				body.tv_mode === "video" || body.tv_mode === "photo"
					? body.tv_mode
					: "carousel";
			const url =
				mode === "photo" && typeof body.tv_url === "string" && body.tv_url.trim()
					? body.tv_url.trim().slice(0, 1024)
					: null;
			if (mode === "photo" && !url) {
				return jsonResponse({ ok: false, error: "url_required" }, { status: 400, request });
			}
			// Visibilidad de capas (toggles del DJ).  Default visible (true).
			const showRanking = body.tv_show_ranking !== false;
			const showBattle = body.tv_show_battle !== false;
			// V17: "Canción actual" (split view).  Default APAGADO (false) para
			// no alterar el layout clásico salvo que el DJ lo active.
			const showNowPlaying = body.tv_show_now_playing === true;
			const tvBackdrop = { mode, url, showRanking, showBattle, showNowPlaying };
			// Read-modify-write del jsonb (un solo DJ lo toca; sin carrera real).
			const { data: ev } = await supabase
				.from("tenant_events")
				.select("metadata")
				.eq("id", eventId)
				.eq("tenant_id", tenant_id)
				.maybeSingle();
			if (!ev) return jsonResponse({ ok: false, error: "event_not_found" }, { status: 404, request });
			const metadata = {
				...((ev.metadata as Record<string, unknown> | null) ?? {}),
				tv_backdrop: tvBackdrop,
			};
			const { error } = await supabase
				.from("tenant_events")
				.update({ metadata })
				.eq("id", eventId)
				.eq("tenant_id", tenant_id);
			if (error) return jsonResponse({ ok: false, error: "update_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "set_tv_backdrop",
				table_name: "tenant_events", record_id: eventId, new_data: tvBackdrop,
			});
			return jsonResponse({ ok: true, backdrop: tvBackdrop }, { request });
		}

		case "now_playing": {
			const { data } = await supabase.rpc("admin_set_now_playing", {
				p_tenant_id: tenant_id, p_actor_uid: verifiedId,
				p_event_id: String(body.event_id ?? ""), p_track_id: String(body.track_id ?? ""),
			});
			return jsonResponse(data ?? { ok: false, error: "rpc_failed" }, { request });
		}

		// "⏹ Parar todo" — apaga la pista que suene (is_played=false en TODAS
		// las del evento).  Now Playing vacío → NowPlaying.tsx oculta la barra
		// en los móviles vía Realtime.  Escritura directa (staff ya validado).
		case "stop_now_playing": {
			const eventId = String(body.event_id ?? "");
			if (!eventId) return jsonResponse({ ok: false, error: "event_id_required" }, { status: 400, request });
			// V17: apagamos is_played pero CONSERVAMOS played_at — la canción que
			// acaba de sonar debe seguir oculta del jumbotron durante 2h.
			const { error } = await supabase
				.from("event_tracks")
				.update({ is_played: false })
				.eq("tenant_id", tenant_id)
				.eq("event_id", eventId)
				.eq("is_played", true);
			if (error) return jsonResponse({ ok: false, error: "update_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "stop_now_playing",
				table_name: "event_tracks", record_id: eventId,
			});
			return jsonResponse({ ok: true }, { request });
		}

		// Programar un evento futuro (status='scheduled').  No lo activa: el DJ
		// lo arranca luego con `activate_event`.
		case "create_event": {
			const name = String(body.name ?? "").trim();
			if (!name) return jsonResponse({ ok: false, error: "name_required" }, { status: 400, request });
			if (!body.start_time) return jsonResponse({ ok: false, error: "start_time_required" }, { status: 400, request });
			const insert: Record<string, unknown> = {
				tenant_id,
				name: name.slice(0, 120),
				start_time: body.start_time,
				end_time: body.end_time ?? null,
				status: "scheduled",
			};
			const { data, error } = await supabase
				.from("tenant_events")
				.insert(insert)
				.select("id")
				.maybeSingle();
			if (error) return jsonResponse({ ok: false, error: "create_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "create_event",
				table_name: "tenant_events", record_id: data?.id ?? null, new_data: insert,
			});
			return jsonResponse({ ok: true, event_id: data?.id ?? null }, { request });
		}

		// Activar un evento programado: lo pone 'active' y cierra cualquier otro
		// evento activo del tenant (un único evento vivo a la vez → bootstrap
		// determinista).
		case "activate_event": {
			const eventId = String(body.event_id ?? "");
			if (!eventId) return jsonResponse({ ok: false, error: "event_id_required" }, { status: 400, request });

			// Activar una fiesta SIN REPERTORIO deja el Tinder y el Jukebox
			// vacíos — y el móvil que entre en ese momento se queda así hasta
			// que cierre y vuelva a abrir la app, porque la fiesta activa se
			// pregunta una sola vez al arrancar.
			//
			// Es lo que tumbó la noche del 3 de septiembre: se activó diez
			// minutos antes de cargar las canciones, y nadie avisó de nada.
			// Ahora hay que confirmarlo a propósito.
			if (body.confirm_empty !== true) {
				const { count } = await supabase
					.from("event_tracks")
					.select("id", { count: "exact", head: true })
					.eq("tenant_id", tenant_id)
					.eq("event_id", eventId);
				if ((count ?? 0) === 0) {
					return jsonResponse(
						{ ok: false, error: "event_has_no_tracks" },
						{ status: 409, request },
					);
				}
			}

			// Cerrar otros activos.
			await supabase
				.from("tenant_events")
				.update({ status: "closed" })
				.eq("tenant_id", tenant_id)
				.eq("status", "active")
				.neq("id", eventId);
			// Activar el elegido.
			const { error } = await supabase
				.from("tenant_events")
				.update({ status: "active" })
				.eq("id", eventId)
				.eq("tenant_id", tenant_id);
			if (error) return jsonResponse({ ok: false, error: "activate_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "activate_event",
				table_name: "tenant_events", record_id: eventId,
			});
			return jsonResponse({ ok: true }, { request });
		}

		case "start_battle": {
			// El DJ ELIGE las dos pistas (control creativo, V1.6 B6).
			const trackA = String(body.track_a ?? "");
			const trackB = String(body.track_b ?? "");
			if (!trackA || !trackB) {
				return jsonResponse({ ok: false, error: "tracks_required" }, { status: 400, request });
			}
			if (trackA === trackB) {
				return jsonResponse({ ok: false, error: "tracks_must_differ" }, { status: 400, request });
			}
			const { data } = await supabase.rpc("admin_start_battle", {
				p_tenant_id: tenant_id, p_actor_uid: verifiedId,
				p_event_id: String(body.event_id ?? ""),
				p_track_a: trackA, p_track_b: trackB,
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

		// ── Plantillas de setlist ──────────────────────────────────────
		case "save_template": {
			const { data } = await supabase.rpc("admin_save_template", {
				p_tenant_id: tenant_id, p_actor_uid: verifiedId,
				p_event_id: String(body.event_id ?? ""), p_name: String(body.name ?? ""),
			});
			return jsonResponse(data ?? { ok: false, error: "rpc_failed" }, { request });
		}

		case "apply_template": {
			const { data } = await supabase.rpc("admin_apply_template", {
				p_tenant_id: tenant_id, p_actor_uid: verifiedId,
				p_event_id: String(body.event_id ?? ""), p_template_id: String(body.template_id ?? ""),
			});
			return jsonResponse(data ?? { ok: false, error: "rpc_failed" }, { request });
		}

		case "delete_template": {
			const { data } = await supabase.rpc("admin_delete_template", {
				p_tenant_id: tenant_id, p_actor_uid: verifiedId,
				p_template_id: String(body.template_id ?? ""),
			});
			return jsonResponse(data ?? { ok: false, error: "rpc_failed" }, { request });
		}

		// ── V1.7: inyección MÚLTIPLE biblioteca→evento (modal de carga) ──
		// Selección de N globales → event_tracks (dedupe por spotify_id).
		case "add_event_tracks": {
			const eventId = String(body.event_id ?? "");
			const ids = Array.isArray(body.global_ids)
				? body.global_ids.filter((x): x is string => typeof x === "string")
				: [];
			if (!eventId) return jsonResponse({ ok: false, error: "event_id_required" }, { status: 400, request });
			if (ids.length === 0) return jsonResponse({ ok: false, error: "no_tracks" }, { status: 400, request });

			const { data: globals } = await supabase
				.from("global_tracks")
				.select("id, spotify_id, title, artist, cover_image_url, genre")
				.eq("tenant_id", tenant_id)
				.in("id", ids);
			const { data: existing } = await supabase
				.from("event_tracks")
				.select("spotify_id")
				.eq("tenant_id", tenant_id)
				.eq("event_id", eventId);
			const already = new Set((existing ?? []).map((r) => (r as { spotify_id: string }).spotify_id));
			const toInsert = (globals ?? [])
				.filter((g) => !already.has((g as { spotify_id: string }).spotify_id))
				.map((g) => {
					const row = g as {
						id: string; spotify_id: string; title: string;
						artist: string; cover_image_url: string | null; genre: string | null;
					};
					return {
						tenant_id, event_id: eventId,
						spotify_id: row.spotify_id, title: row.title, artist: row.artist,
						cover_image_url: row.cover_image_url,
						// El género y el enlace viajan con la canción.  Se caían
						// aquí, y el desglose por género del dashboard recibía
						// NULL para todo lo cargado desde el panel.
						genre: row.genre, global_track_id: row.id,
					};
				});
			let added = 0;
			if (toInsert.length > 0) {
				const { error } = await supabase.from("event_tracks").insert(toInsert);
				if (error) return jsonResponse({ ok: false, error: "insert_failed", detail: error.message }, { status: 500, request });
				added = toInsert.length;
				await supabase.from("audit_logs").insert({
					tenant_id, actor_id: verifiedId, action: "add_event_tracks",
					table_name: "event_tracks", record_id: eventId, new_data: { added },
				});
			}
			return jsonResponse({ ok: true, added }, { request });
		}

		// ── V1.7: crear plantilla desde selección de globales SIN evento ──
		case "create_template": {
			const name = String(body.name ?? "").trim();
			const ids = Array.isArray(body.global_ids)
				? body.global_ids.filter((x): x is string => typeof x === "string")
				: [];
			if (!name) return jsonResponse({ ok: false, error: "name_required" }, { status: 400, request });
			if (ids.length === 0) return jsonResponse({ ok: false, error: "no_tracks" }, { status: 400, request });

			const { data: globals } = await supabase
				.from("global_tracks")
				.select("id, spotify_id, title, artist, cover_image_url, genre")
				.eq("tenant_id", tenant_id)
				.in("id", ids);
			if (!globals || globals.length === 0) {
				return jsonResponse({ ok: false, error: "no_tracks" }, { status: 400, request });
			}
			const { data: tpl, error: tplErr } = await supabase
				.from("event_templates")
				.insert({ tenant_id, name: name.slice(0, 120), created_by: verifiedId })
				.select("id")
				.single();
			if (tplErr || !tpl) {
				return jsonResponse({ ok: false, error: "create_failed", detail: tplErr?.message }, { status: 500, request });
			}
			const rows = globals.map((g, i) => {
				const row = g as {
					id: string; spotify_id: string; title: string;
					artist: string; cover_image_url: string | null; genre: string | null;
				};
				return {
					template_id: tpl.id as string, tenant_id,
					spotify_id: row.spotify_id, title: row.title, artist: row.artist,
					cover_image_url: row.cover_image_url, position: i,
					genre: row.genre, global_track_id: row.id,
				};
			});
			const { error: trErr } = await supabase.from("event_template_tracks").insert(rows);
			if (trErr) {
				await supabase.from("event_templates").delete().eq("id", tpl.id as string);
				return jsonResponse({ ok: false, error: "create_failed", detail: trErr.message }, { status: 500, request });
			}
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "create_template",
				table_name: "event_templates", record_id: tpl.id as string,
				new_data: { name, tracks: rows.length },
			});
			return jsonResponse({ ok: true, template_id: tpl.id, tracks: rows.length }, { request });
		}

		// ── V1.7: renombrar plantilla (edición rápida) ──
		case "rename_template": {
			const id = String(body.template_id ?? "");
			const name = String(body.name ?? "").trim();
			if (!id) return jsonResponse({ ok: false, error: "template_id_required" }, { status: 400, request });
			if (!name) return jsonResponse({ ok: false, error: "name_required" }, { status: 400, request });
			const { error } = await supabase
				.from("event_templates")
				.update({ name: name.slice(0, 120) })
				.eq("id", id)
				.eq("tenant_id", tenant_id);
			if (error) return jsonResponse({ ok: false, error: "update_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "rename_template",
				table_name: "event_templates", record_id: id, new_data: { name },
			});
			return jsonResponse({ ok: true }, { request });
		}

		// ── Flash Drops ────────────────────────────────────────────────
		// La palanca de la noche: el DJ ve que la sala está fría y suelta una
		// promoción agresiva con caducidad y stock.  No es una feature aparte,
		// es una regla de disponibilidad con vigencia corta — pero SÍ lleva
		// `campaign_code` propio para poder medir cada activación por separado.
		case "promo_panel": {
			const [{ data: products, error: prodErr }, { data: campaigns, error: campErr }] =
				await Promise.all([
					supabase
						.from("tenant_products")
						.select("id, name, list_price_eur, promo_price_eur")
						.eq("tenant_id", tenant_id)
						.eq("is_active", true)
						.eq("redemption_type", "discount")
						.order("list_price_eur", { ascending: true }),
					supabase
						.from("product_availability")
						.select(
							"id, campaign_code, label, promo_price_eur, tokens_per_euro, " +
								"valid_from, valid_to, stock_total, stock_used, is_active, " +
								"product:tenant_products(name)",
						)
						.eq("tenant_id", tenant_id)
						.eq("kind", "flash_drop")
						.order("valid_from", { ascending: false })
						.limit(20),
				]);
			// Igual que en `bootstrap`: un error tragado aquí pintaría un panel
			// vacío que parece "no hay nada" cuando en realidad falló la carga.
			const warnings: string[] = [];
			if (prodErr) { console.warn("[api.admin] promo products", prodErr.message); warnings.push("products"); }
			if (campErr) { console.warn("[api.admin] promo campaigns", campErr.message); warnings.push("campaigns"); }

			// Qué oferta está ganando AHORA en cada producto, calculada con el
			// mismo criterio que ve el cliente.  Sin esto el DJ lanza un drop
			// a ciegas y puede quedar por detrás de la promoción que ya había
			// puesta — que es justo lo que pasó el 3 de septiembre.
			const { data: current, error: curErr } = await supabase.rpc(
				"get_current_best_prices",
				{ p_tenant_id: tenant_id },
			);
			if (curErr) {
				console.warn("[api.admin] current best prices", curErr.message);
				warnings.push("current_prices");
			}

			return jsonResponse(
				{
					ok: true,
					products: products ?? [],
					campaigns: campaigns ?? [],
					current: current ?? [],
					warnings,
				},
				{ request },
			);
		}

		case "create_flash_drop": {
			const productId = String(body.product_id ?? "");
			const price = Number(body.promo_price_eur);
			const minutes = Number(body.minutes);
			if (!productId) return jsonResponse({ ok: false, error: "product_required" }, { status: 400, request });
			if (!Number.isFinite(price) || price < 0) return jsonResponse({ ok: false, error: "invalid_price" }, { status: 400, request });
			if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) {
				return jsonResponse({ ok: false, error: "invalid_minutes" }, { status: 400, request });
			}
			const stock = Number.isInteger(body.stock) && Number(body.stock) > 0 ? Number(body.stock) : null;
			const { data, error } = await supabase.rpc("create_flash_drop", {
				p_tenant_id: tenant_id,
				p_product_id: productId,
				p_promo_price_eur: price,
				p_minutes: minutes,
				p_stock: stock,
				p_tier_code: null,
				p_label: typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null,
				p_tokens_per_euro: Number.isInteger(body.tokens_per_euro) ? Number(body.tokens_per_euro) : null,
			});
			if (error) {
				return jsonResponse({ ok: false, error: "rpc_failed", detail: error.message }, { status: 400, request });
			}
			// Un drop regala dinero: queda en el registro de auditoría con quién
			// lo lanzó, igual que cualquier otra decisión de la sala.
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "create_flash_drop",
				table_name: "product_availability",
				record_id: (data as { rule_id?: string } | null)?.rule_id ?? null,
				new_data: data as Record<string, unknown>,
			});
			return jsonResponse({ ok: true, ...(data as object) }, { request });
		}

		case "end_flash_drop": {
			const ruleId = String(body.rule_id ?? "");
			if (!ruleId) return jsonResponse({ ok: false, error: "rule_id_required" }, { status: 400, request });
			const { data, error } = await supabase.rpc("end_flash_drop", {
				p_tenant_id: tenant_id, p_rule_id: ruleId,
			});
			if (error) {
				return jsonResponse({ ok: false, error: "rpc_failed", detail: error.message }, { status: 400, request });
			}
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "end_flash_drop",
				table_name: "product_availability", record_id: ruleId,
				new_data: data as Record<string, unknown>,
			});
			return jsonResponse({ ok: true, ...(data as object) }, { request });
		}

		// ── Configuración de promociones ───────────────────────────────
		// Todo esto lo edita la SALA, no nosotros: precios, tasa por nivel,
		// umbrales y franjas horarias.  Es el requisito que hace que el sistema
		// sirva para una segunda discoteca sin tocar código.
		case "promo_config": {
			const warnings: string[] = [];
			const warn = (scope: string, msg?: string) => {
				console.warn(`[api.admin] promo_config ${scope}: ${msg ?? "?"}`);
				warnings.push(scope);
			};
			const [prods, tiersRes, rules] = await Promise.all([
				supabase.from("tenant_products")
					.select("id, name, product_type, list_price_eur, promo_price_eur, redemption_type, price_tokens, is_active")
					.eq("tenant_id", tenant_id)
					.order("list_price_eur", { ascending: true, nullsFirst: false }),
				supabase.from("tenant_tier_thresholds")
					.select("tier_code, display_name, min_lifetime, tokens_per_euro, max_redemptions_per_night, badge_emoji, sort_order")
					.eq("tenant_id", tenant_id)
					.order("sort_order", { ascending: true }),
				supabase.from("product_availability")
					.select("id, product_id, tier_code, days, hour_from, hour_to, promo_price_eur, tokens_per_euro, max_per_night, max_per_week, label, is_active")
					.eq("tenant_id", tenant_id)
					.eq("kind", "base")
					.order("product_id", { ascending: true }),
			]);
			if (prods.error) warn("products", prods.error.message);
			if (tiersRes.error) warn("tiers", tiersRes.error.message);
			if (rules.error) warn("availability", rules.error.message);
			const { data: gaps } = await supabase.rpc("check_promo_coverage", { p_tenant_id: tenant_id });
			return jsonResponse({
				ok: true,
				products: prods.data ?? [],
				tiers: tiersRes.data ?? [],
				availability: rules.data ?? [],
				gaps: gaps ?? [],
				warnings,
			}, { request });
		}

		case "update_product": {
			const id = String(body.product_id ?? "");
			if (!id) return jsonResponse({ ok: false, error: "product_required" }, { status: 400, request });
			const patch: Record<string, unknown> = {};
			if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
			// Precios sin decimales: es una regla del local, no una preferencia
			// de formato — un "3,50 €" en barra no existe.
			for (const key of ["list_price_eur", "promo_price_eur"] as const) {
				const v = body[key];
				if (v === undefined) continue;
				if (!Number.isFinite(Number(v)) || Number(v) < 0) {
					return jsonResponse({ ok: false, error: "invalid_price" }, { status: 400, request });
				}
				patch[key] = Math.round(Number(v));
			}
			if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
			if (Object.keys(patch).length === 0) {
				return jsonResponse({ ok: false, error: "nothing_to_update" }, { status: 400, request });
			}
			// El promo tiene que mejorar al de barra o el descuento sale negativo
			// y el producto acabaría "costando" tokens negativos.
			const { data: current } = await supabase
				.from("tenant_products").select("list_price_eur, promo_price_eur")
				.eq("id", id).eq("tenant_id", tenant_id).maybeSingle();
			const list = Number(patch.list_price_eur ?? current?.list_price_eur ?? 0);
			const promo = Number(patch.promo_price_eur ?? current?.promo_price_eur ?? 0);
			if (list > 0 && promo >= list) {
				return jsonResponse({ ok: false, error: "promo_not_cheaper" }, { status: 400, request });
			}
			const { error } = await supabase.from("tenant_products").update(patch).eq("id", id).eq("tenant_id", tenant_id);
			if (error) return jsonResponse({ ok: false, error: "update_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "update_product",
				table_name: "tenant_products", record_id: id, new_data: patch,
			});
			return jsonResponse({ ok: true }, { request });
		}

		case "update_tier": {
			const code = String(body.tier_code ?? "");
			if (!code) return jsonResponse({ ok: false, error: "tier_required" }, { status: 400, request });
			const patch: Record<string, unknown> = {};
			if (body.min_lifetime !== undefined) {
				const v = Number(body.min_lifetime);
				if (!Number.isInteger(v) || v < 0) return jsonResponse({ ok: false, error: "invalid_threshold" }, { status: 400, request });
				patch.min_lifetime = v;
			}
			if (body.tokens_per_euro !== undefined) {
				const v = Number(body.tokens_per_euro);
				// 0 regalaría descuentos gratis; el tope evita un dedazo que
				// deje todo inalcanzable.
				if (!Number.isInteger(v) || v < 1 || v > 1000) return jsonResponse({ ok: false, error: "invalid_rate" }, { status: 400, request });
				patch.tokens_per_euro = v;
			}
			if (body.max_redemptions_per_night !== undefined) {
				const v = body.max_redemptions_per_night;
				if (v === null) patch.max_redemptions_per_night = null;
				else {
					const n = Number(v);
					if (!Number.isInteger(n) || n < 1 || n > 50) return jsonResponse({ ok: false, error: "invalid_limit" }, { status: 400, request });
					patch.max_redemptions_per_night = n;
				}
			}
			if (Object.keys(patch).length === 0) return jsonResponse({ ok: false, error: "nothing_to_update" }, { status: 400, request });
			const { error } = await supabase.from("tenant_tier_thresholds").update(patch)
				.eq("tenant_id", tenant_id).eq("tier_code", code);
			if (error) return jsonResponse({ ok: false, error: "update_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "update_tier",
				table_name: "tenant_tier_thresholds", record_id: null,
				new_data: { tier_code: code, ...patch },
			});
			return jsonResponse({ ok: true }, { request });
		}

		case "save_availability": {
			const productId = String(body.product_id ?? "");
			if (!productId) return jsonResponse({ ok: false, error: "product_required" }, { status: 400, request });
			const hf = body.hour_from == null ? null : Number(body.hour_from);
			const ht = body.hour_to == null ? null : Number(body.hour_to);
			for (const h of [hf, ht]) {
				if (h !== null && (!Number.isInteger(h) || h < 0 || h > 23)) {
					return jsonResponse({ ok: false, error: "invalid_hour" }, { status: 400, request });
				}
			}
			// O ambas horas o ninguna: media ventana no significa nada.
			if ((hf === null) !== (ht === null)) {
				return jsonResponse({ ok: false, error: "incomplete_window" }, { status: 400, request });
			}
			const days = Array.isArray(body.days)
				? body.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
				: null;
			const row = {
				tenant_id,
				product_id: productId,
				tier_code: body.tier_code ? String(body.tier_code) : null,
				days: days && days.length > 0 ? days : null,
				hour_from: hf,
				hour_to: ht,
				promo_price_eur: body.promo_price_eur == null ? null : Math.round(Number(body.promo_price_eur)),
				max_per_night: body.max_per_night == null ? null : Number(body.max_per_night),
				label: typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null,
				is_active: body.is_active !== false,
				kind: "base",
			};
			const id = String(body.availability_id ?? "");
			const { error } = id
				? await supabase.from("product_availability").update(row).eq("id", id).eq("tenant_id", tenant_id)
				: await supabase.from("product_availability").insert(row);
			if (error) return jsonResponse({ ok: false, error: "save_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: id ? "update_availability" : "create_availability",
				table_name: "product_availability", record_id: id || null, new_data: row,
			});
			// Se devuelven los huecos que deja el cambio: el aviso llega en el
			// momento de guardar, no un sábado a las dos de la mañana.
			const { data: gaps } = await supabase.rpc("check_promo_coverage", { p_tenant_id: tenant_id });
			return jsonResponse({ ok: true, gaps: gaps ?? [] }, { request });
		}

		case "delete_availability": {
			const id = String(body.availability_id ?? "");
			if (!id) return jsonResponse({ ok: false, error: "availability_required" }, { status: 400, request });
			const { error } = await supabase.from("product_availability")
				.delete().eq("id", id).eq("tenant_id", tenant_id).eq("kind", "base");
			if (error) return jsonResponse({ ok: false, error: "delete_failed", detail: error.message }, { status: 500, request });
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "delete_availability",
				table_name: "product_availability", record_id: id, new_data: null,
			});
			const { data: gaps } = await supabase.rpc("check_promo_coverage", { p_tenant_id: tenant_id });
			return jsonResponse({ ok: true, gaps: gaps ?? [] }, { request });
		}

		// ── Nombres visibles ───────────────────────────────────────────
		// Solo importa moderar lo que SE VE: el nombre de quien no sale en la
		// tele no molesta a nadie.  Se listan los mismos que pinta el ranking.
		case "visible_names": {
			const { data, error } = await supabase
				.from("user_profiles")
				.select("id, display_name, lifetime_earned")
				.eq("tenant_id", tenant_id)
				.not("display_name", "is", null)
				.order("lifetime_earned", { ascending: false })
				.limit(20);
			if (error) {
				console.warn("[api.admin] visible_names", error.message);
				return jsonResponse({ ok: false, error: "lookup_failed" }, { status: 500, request });
			}
			return jsonResponse({ ok: true, people: data ?? [] }, { request });
		}

		case "clear_display_name": {
			const profileId = String(body.profile_id ?? "");
			if (!profileId) {
				return jsonResponse({ ok: false, error: "profile_required" }, { status: 400, request });
			}
			const { data, error } = await supabase.rpc("clear_display_name", {
				p_tenant_id: tenant_id,
				p_user_id: profileId,
			});
			if (error) {
				return jsonResponse(
					{ ok: false, error: "rpc_failed", detail: error.message },
					{ status: 400, request },
				);
			}
			// Queda quién lo quitó y QUÉ quitó: es una acción sobre otra persona,
			// y si alguien pregunta hay que poder responder.
			await supabase.from("audit_logs").insert({
				tenant_id, actor_id: verifiedId, action: "clear_display_name",
				table_name: "user_profiles", record_id: profileId,
				new_data: data as Record<string, unknown>,
			});
			return jsonResponse({ ok: true, ...(data as object) }, { request });
		}

		default:
			return jsonResponse({ ok: false, error: "unknown_op" }, { status: 400, request });
	}
}

async function bootstrap(
	supabase: ReturnType<typeof getServiceSupabase>,
	tenant_id: string,
) {
	// V20 · FASE 1 — Nunca más listas vacías por un error tragado.  Antes cada
	// query hacía `const { data } = await …` y descartaba el error: cuando a
	// `service_role` le faltaban los GRANT, el panel mostraba "Plantillas" y
	// "Almacén global" VACÍOS en lugar de un fallo.  Ahora se registran avisos y
	// viajan al cliente, que puede distinguir "no hay datos" de "falló la carga".
	const warnings: string[] = [];
	const warn = (scope: string, message?: string) => {
		console.warn(`[api.admin] bootstrap ${scope}: ${message ?? "unknown error"}`);
		warnings.push(scope);
	};
	// Evento activo (si lo hay).  El cierre de eventos vencidos lo gestiona
	// EXCLUSIVAMENTE el job pg_cron (cada minuto) — los loaders se mantienen
	// rápidos, sin RPCs de mantenimiento en el camino crítico.
	const { data: event, error: eventErr } = await supabase
		.from("tenant_events")
		.select("id, name, start_time, end_time, status")
		.eq("tenant_id", tenant_id)
		.eq("status", "active")
		.order("start_time", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (eventErr) warn("active_event", eventErr.message);

	// Histórico de eventos (cualquier estado, recientes primero) — para el
	// manager: ver fiestas pasadas + programadas y activarlas.
	const { data: eventsHistory, error: historyErr } = await supabase
		.from("tenant_events")
		.select("id, name, start_time, end_time, status")
		.eq("tenant_id", tenant_id)
		.order("start_time", { ascending: false })
		.limit(50);
	if (historyErr) warn("events_history", historyErr.message);

	// Plantillas de setlist (con nº de temas vía conteo embebido).
	const { data: templatesRaw, error: tplErr } = await supabase
		.from("event_templates")
		.select("id, name, created_at, event_template_tracks(count)")
		.eq("tenant_id", tenant_id)
		.order("created_at", { ascending: false })
		.limit(50);
	if (tplErr) warn("event_templates", tplErr.message);
	const templates = (templatesRaw ?? []).map((t) => {
		const row = t as { id: string; name: string; created_at: string; event_template_tracks?: { count: number }[] };
		return {
			id: row.id,
			name: row.name,
			created_at: row.created_at,
			track_count: row.event_template_tracks?.[0]?.count ?? 0,
		};
	});

	// Biblioteca global
	const { data: globalTracks, error: globalErr } = await supabase
		.from("global_tracks")
		.select("id, spotify_id, title, artist, cover_image_url, genre")
		.eq("tenant_id", tenant_id)
		.order("created_at", { ascending: false })
		.limit(500);
	if (globalErr) warn("global_tracks", globalErr.message);

	let eventTracks: unknown[] = [];
	let battle: unknown = null;
	if (event) {
		const { data: et, error: etErr } = await supabase
			.from("event_tracks")
			.select("id, spotify_id, title, artist, cover_image_url, total_votes, is_played, genre")
			.eq("tenant_id", tenant_id)
			.eq("event_id", event.id)
			.order("total_votes", { ascending: false })
			.order("title", { ascending: true });
		if (etErr) warn("event_tracks", etErr.message);
		eventTracks = et ?? [];

		const { data: b, error: bErr } = await supabase
			.from("live_battles")
			.select("id, track_a, track_b, status, started_at, ends_at, winner_track")
			.eq("tenant_id", tenant_id)
			.eq("event_id", event.id)
			.eq("status", "live")
			.order("started_at", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (bErr) warn("live_battles", bErr.message);
		battle = b ?? null;
	}

	return {
		ok: true,
		is_staff: true,
		tenant_id, // lo usa el cliente para filtrar la suscripción Realtime
		event: event ?? null,
		events_history: eventsHistory ?? [],
		templates,
		global_tracks: globalTracks ?? [],
		event_tracks: eventTracks,
		battle,
		// Vacío = todo cargó bien.  Con contenido, el panel avisa en vez de
		// mostrar secciones vacías como si no hubiera datos (F1).
		warnings,
	};
}
