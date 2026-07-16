import type { AppLoadContext } from "react-router";
import {
	corsHeaders,
	jsonResponse,
	preflight,
	verifyAuthToken,
} from "./api.server";
import { getServiceSupabase } from "./supabase.server";
import {
	hasTenantRole,
	pickTenantSlug,
	resolveTenantProfile,
} from "./tenant-resolver.server";
import type { TrackVoteType } from "../types/database";

/**
 * Shared handler for /api/music (GET + POST).  Extracted out of the
 * route file so the route stays a tiny shim — keeps RR7's static
 * analyser happy and lets us unit-test the logic in isolation later.
 */

type VoteBody = {
	event_id?: string;
	track_id?: string;
	vote_type?: TrackVoteType;
	tokens_spent?: number; // IGNORADO server-side para boost (compat)
	tenant_slug?: string;
	// Qué boost es, para resolver el coste real desde tenant_token_rewards.
	boost_context?: "jukebox" | "livebattle";
};

// El coste del boost NUNCA lo decide el cliente.  Mapeamos el contexto
// de UI al `event_code` de `tenant_token_rewards`; el RPC `vote_track`
// resuelve el importe desde la BD.
function boostCodeFromContext(ctx: unknown): string {
	return ctx === "jukebox" ? "jukebox_boost" : "livebattle_boost";
}

function isValidVoteType(v: unknown): v is TrackVoteType {
	return v === "free" || v === "boost";
}

export async function handleMusicLoader(
	request: Request,
	context: AppLoadContext,
): Promise<Response> {
	const cors = preflight(request);
	if (cors) return cors;

	if (request.method !== "GET") {
		return jsonResponse(
			{ ok: false, error: "method_not_allowed" },
			{ status: 405, request },
		);
	}

	const verified = await verifyAuthToken(request, context);
	if (!verified) {
		return jsonResponse(
			{ ok: false, error: "unauthorized" },
			{ status: 401, request },
		);
	}

	const url = new URL(request.url);
	const event_id = url.searchParams.get("event_id");
	const mode = (url.searchParams.get("mode") ?? "swipe").toLowerCase();

	if (!event_id) {
		return jsonResponse(
			{ ok: false, error: "event_id_required" },
			{ status: 400, request },
		);
	}

	const slugResult = pickTenantSlug(null, request);
	if (!slugResult.ok) {
		return jsonResponse(
			{ ok: false, error: slugResult.error },
			{ status: 400, request },
		);
	}

	let supabase: ReturnType<typeof getServiceSupabase>;
	try {
		supabase = getServiceSupabase(context);
	} catch (err) {
		if (err instanceof Response) return err;
		return jsonResponse(
			{ ok: false, error: "service_unavailable" },
			{ status: 503, request },
		);
	}

	const profileResult = await resolveTenantProfile(
		supabase,
		slugResult.slug,
		verified.id,
	);
	if (!profileResult.ok) {
		return jsonResponse(
			{ ok: false, error: profileResult.error },
			{ status: 404, request },
		);
	}
	const { tenant_id, user_profile_id } = profileResult.data;

	// DJ leaderboard
	if (mode === "leaderboard") {
		const isDj = await hasTenantRole(supabase, tenant_id, verified.id, "dj");
		if (!isDj) {
			return jsonResponse(
				{ ok: false, error: "forbidden" },
				{ status: 403, request },
			);
		}

		const { data, error } = await supabase
			.from("event_tracks")
			.select(
				"id, title, artist, cover_image_url, total_votes, is_played, played_at",
			)
			.eq("tenant_id", tenant_id)
			.eq("event_id", event_id)
			.order("total_votes", { ascending: false })
			.order("title", { ascending: true });

		if (error) {
			console.warn("[api.music] leaderboard lookup failed", error.message);
			return jsonResponse(
				{ ok: false, error: "lookup_failed" },
				{ status: 500, request },
			);
		}

		return jsonResponse({ ok: true, tracks: data ?? [] }, { request });
	}

	// Jukebox CATALOG — TODAS las canciones disponibles (is_played=false) del
	// evento, ligeras, SIN excluir las ya votadas (el Jukebox las muestra
	// igual para poder boostearlas).  El cliente elige 50 aleatorias para la
	// vista por defecto y filtra sobre el 100% al buscar.  Cap defensivo a
	// 1000 para no escupir catálogos absurdos al móvil.
	if (mode === "catalog") {
		const { data, error } = await supabase
			.from("event_tracks")
			.select("id, spotify_id, title, artist, cover_image_url, total_votes, is_played, genre")
			.eq("tenant_id", tenant_id)
			.eq("event_id", event_id)
			.eq("is_played", false)
			.order("total_votes", { ascending: false })
			// Desempate V18: a igualdad de votos, primero la votada hace más rato.
			.order("last_vote_at", { ascending: true, nullsFirst: true })
			.order("title", { ascending: true })
			.limit(1000);

		if (error) {
			console.warn("[api.music] catalog lookup failed", error.message);
			return jsonResponse(
				{ ok: false, error: "lookup_failed" },
				{ status: 500, request },
			);
		}

		return jsonResponse({ ok: true, tracks: data ?? [] }, { request });
	}

	// Swipe deck — unplayed + not yet voted by this user
	const { data: votedRows, error: votedErr } = await supabase
		.from("track_votes")
		.select("track_id")
		.eq("event_id", event_id)
		.eq("user_id", user_profile_id);

	if (votedErr) {
		console.warn("[api.music] votes lookup failed", votedErr.message);
		return jsonResponse(
			{ ok: false, error: "lookup_failed" },
			{ status: 500, request },
		);
	}

	const votedIds = (votedRows ?? []).map((r) => r.track_id as string);

	let query = supabase
		.from("event_tracks")
		.select(
			"id, spotify_id, title, artist, cover_image_url, total_votes, is_played",
		)
		.eq("tenant_id", tenant_id)
		.eq("event_id", event_id)
		.eq("is_played", false);

	if (votedIds.length > 0) {
		query = query.not("id", "in", `(${votedIds.join(",")})`);
	}

	const { data: tracks, error: tracksErr } = await query
		.order("total_votes", { ascending: false })
		.limit(40);

	if (tracksErr) {
		console.warn("[api.music] tracks lookup failed", tracksErr.message);
		return jsonResponse(
			{ ok: false, error: "lookup_failed" },
			{ status: 500, request },
		);
	}

	return jsonResponse(
		{ ok: true, tracks: tracks ?? [], voted_count: votedIds.length },
		{ request },
	);
}

export async function handleMusicAction(
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

	const verified = await verifyAuthToken(request, context);
	if (!verified) {
		return jsonResponse(
			{ ok: false, error: "unauthorized" },
			{ status: 401, request },
		);
	}

	let body: VoteBody;
	try {
		body = (await request.json()) as VoteBody;
	} catch {
		return jsonResponse(
			{ ok: false, error: "invalid_json" },
			{ status: 400, request },
		);
	}

	if (!body.event_id || !body.track_id) {
		return jsonResponse(
			{ ok: false, error: "event_and_track_required" },
			{ status: 400, request },
		);
	}

	const vote_type = body.vote_type ?? "free";
	if (!isValidVoteType(vote_type)) {
		return jsonResponse(
			{ ok: false, error: "invalid_vote_type" },
			{ status: 400, request },
		);
	}

	const tokens_spent = Number.isInteger(body.tokens_spent)
		? Number(body.tokens_spent)
		: 0;
	if (tokens_spent < 0 || tokens_spent > 10_000) {
		return jsonResponse(
			{ ok: false, error: "tokens_spent_out_of_range" },
			{ status: 400, request },
		);
	}
	if (vote_type === "free" && tokens_spent !== 0) {
		return jsonResponse(
			{ ok: false, error: "free_votes_must_be_zero_tokens" },
			{ status: 400, request },
		);
	}

	const slugResult = pickTenantSlug(body.tenant_slug, request);
	if (!slugResult.ok) {
		return jsonResponse(
			{ ok: false, error: slugResult.error },
			{ status: 400, request },
		);
	}

	let supabase: ReturnType<typeof getServiceSupabase>;
	try {
		supabase = getServiceSupabase(context);
	} catch (err) {
		if (err instanceof Response) return err;
		return jsonResponse(
			{ ok: false, error: "service_unavailable" },
			{ status: 503, request },
		);
	}

	const profileResult = await resolveTenantProfile(
		supabase,
		slugResult.slug,
		verified.id,
	);
	if (!profileResult.ok) {
		return jsonResponse(
			{ ok: false, error: profileResult.error },
			{ status: 404, request },
		);
	}
	const { tenant_id, user_profile_id } = profileResult.data;

	const { data, error } = await supabase.rpc("vote_track", {
		p_tenant_id: tenant_id,
		p_user_id: user_profile_id,
		p_event_id: body.event_id,
		p_track_id: body.track_id,
		p_vote_type: vote_type,
		// p_tokens_spent se conserva por compat pero el RPC lo IGNORA para
		// boost: el coste real se resuelve de tenant_token_rewards vía
		// p_boost_code.  Cierra la fuga "boost a 0 tokens".
		p_tokens_spent: tokens_spent,
		p_boost_code: boostCodeFromContext(body.boost_context),
	});

	if (error) {
		const msg = (error.message || "").toLowerCase();
		const detail = error.message;
		// El RPC `vote_track` tiene 4 RAISE EXCEPTION + 2 returns con
		// `{ok:false, error:'...'}`.  Mapeamos cada uno con código
		// accionable + `detail` (mensaje raw del RPC) para que el
		// cliente pueda mostrar la causa exacta en lugar de un 500
		// genérico que esconda FK violations, unique violations, etc.
		if (msg.includes("track_unavailable")) {
			return jsonResponse(
				{ ok: false, error: "track_unavailable", detail },
				{ status: 409, request },
			);
		}
		if (msg.includes("invalid_vote_type")) {
			return jsonResponse(
				{ ok: false, error: "invalid_vote_type", detail },
				{ status: 400, request },
			);
		}
		if (msg.includes("free_votes_must_be_zero_tokens")) {
			return jsonResponse(
				{ ok: false, error: "free_must_be_zero", detail },
				{ status: 400, request },
			);
		}
		if (msg.includes("negative_tokens")) {
			return jsonResponse(
				{ ok: false, error: "negative_tokens", detail },
				{ status: 400, request },
			);
		}
		// Errores de Postgres "duros" que llegan literales al cliente
		// para que el operador pueda diagnosticar sin abrir wrangler
		// tail (FK violations, unique violations, NOT NULL, etc.).
		if (msg.includes("violates foreign key")) {
			return jsonResponse(
				{ ok: false, error: "fk_violation", detail },
				{ status: 500, request },
			);
		}
		if (msg.includes("duplicate key")) {
			return jsonResponse(
				{ ok: false, error: "duplicate_key", detail },
				{ status: 409, request },
			);
		}
		console.warn("[api.music] vote_track rpc failed", error.message);
		return jsonResponse(
			{ ok: false, error: "rpc_failed", detail },
			{ status: 500, request },
		);
	}

	const payload = (data ?? {}) as {
		ok?: boolean;
		error?: string;
		vote_id?: string;
		total_votes?: number;
		balance?: number;
	};

	if (payload.ok === false) {
		const status =
			payload.error === "insufficient_funds"
				? 400
				: payload.error === "already_voted"
					? 409
					: 400;
		return jsonResponse(
			{
				ok: false,
				error: payload.error ?? "vote_failed",
				balance: payload.balance,
			},
			{ status, request },
		);
	}

	return jsonResponse(
		{
			ok: true,
			vote_id: payload.vote_id,
			total_votes: payload.total_votes,
			balance: payload.balance,
		},
		{ request },
	);
}

export function musicMethodNotAllowed(request: Request): Response {
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
