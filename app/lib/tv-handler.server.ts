import type { AppLoadContext } from "react-router";
import { jsonResponse, preflight, verifyAuthToken } from "./api.server";
import { getServiceSupabase } from "./supabase.server";
import { hasTenantRole, pickTenantSlug } from "./tenant-resolver.server";

/**
 * Handler de `POST /api/tv` — hidratación del Jumbotron `/tv/dashboard`.
 *
 *   Por qué existe (Sprint V1.6 · A2):
 *     `/tv/dashboard` autenticaba por COOKIE (`requireTenantRole`), pero el
 *     login del SPA persiste en localStorage y NO escribe cookie → el loader
 *     server no encontraba sesión y escupía 401.  Alineamos la TV con
 *     `/admin`: gating en cliente + endpoint autenticado por Bearer.
 *
 *   Seguridad (igual que admin-handler):
 *     · JWT obligatorio (actor = auth uid del JWT, nunca del body).
 *     · Autorización por rol `display` o `admin` en este tenant.
 *
 *   Devuelve el mismo shape que el viejo loader `loadTvDashboard`:
 *     { ok, tenant_id, event_id, tracks, battle }
 */

type TvBody = { tenant_slug?: string };

type TvTrack = {
	id: string;
	title: string;
	artist: string;
	cover_image_url: string | null;
	total_votes: number;
	is_played: boolean;
};

export async function handleTvAction(
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

	let body: TvBody;
	try {
		body = (await request.json().catch(() => ({}))) as TvBody;
	} catch {
		body = {};
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

	// ¿Rol display o admin?  (gate de la TV)
	const isDisplay = await hasTenantRole(supabase, tenant_id, verifiedId, "display");
	const isAdmin = isDisplay ? false : await hasTenantRole(supabase, tenant_id, verifiedId, "admin");
	if (!isDisplay && !isAdmin) {
		return jsonResponse({ ok: false, error: "forbidden" }, { status: 403, request });
	}

	// Evento activo (acepta también 'draft', igual que el viejo loader).
	// El cierre de eventos vencidos lo hace el cron (cada minuto), no aquí.
	const { data: activeEvent } = await supabase
		.from("tenant_events")
		.select("id, status, metadata")
		.eq("tenant_id", tenant_id)
		.in("status", ["active", "draft"])
		.order("start_time", { ascending: false })
		.limit(1)
		.maybeSingle();

	const event_id = (activeEvent?.id as string | undefined) ?? null;

	// Preferencia de fondo de la TV (control remoto del Staff).  Default
	// carrusel automático si no se ha fijado nada.
	const meta = (activeEvent?.metadata as Record<string, unknown> | null) ?? null;
	const rawBackdrop = (meta?.tv_backdrop ?? null) as
		| { mode?: string; url?: string | null }
		| null;
	const bm = rawBackdrop?.mode;
	const backdrop = {
		mode: bm === "video" || bm === "photo" ? bm : "carousel",
		url: typeof rawBackdrop?.url === "string" ? rawBackdrop.url : null,
	};

	let tracks: TvTrack[] = [];
	let battle: { id: string; ends_at: string; a: TvTrack; b: TvTrack } | null = null;

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

		// Batalla viva (si la hay) → resolvemos las dos canciones para arrancar
		// directamente en modo DUELO sin esperar al WebSocket.
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

	return jsonResponse({ ok: true, tenant_id, event_id, tracks, battle, backdrop }, { request });
}
