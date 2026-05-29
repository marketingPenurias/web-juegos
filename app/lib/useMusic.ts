import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "./supabase.client";
import { useTenant } from "./tenant";
import type { TrackVoteType } from "../types/database";

/**
 * useMusic — typed client over /api/music.
 *
 * Two parts:
 *  - `fetchDeck(event_id)` returns the swipe deck (unvoted, unplayed
 *    tracks ordered by votes desc).
 *  - `castVote({ event_id, track_id, vote_type, tokens_spent })` calls
 *    the locked-down `vote_track` RPC via the Edge worker.
 *  - `fetchLeaderboard(event_id)` returns the DJ-only sorted list.
 *
 * Auto-flush of the offline analytics queue happens elsewhere (see
 * AppFrame); we don't need to mirror it here because votes need to be
 * synchronous (the UI must show the new total_votes immediately).
 */

const ENDPOINT = "/api/music";

export type MusicTrack = {
	id: string;
	spotify_id?: string;
	title: string;
	artist: string;
	cover_image_url: string | null;
	total_votes: number;
	is_played?: boolean;
	played_at?: string | null;
};

export type MusicError =
	| "unauthorized"
	| "forbidden"
	| "missing_tenant"
	| "track_unavailable"
	| "invalid_vote_type"
	| "free_must_be_zero"
	| "negative_tokens"
	| "insufficient_funds"
	| "already_voted"
	| "fk_violation"
	| "duplicate_key"
	| "service_unavailable"
	| "network_error"
	| "rpc_failed";

async function buildHeaders(): Promise<HeadersInit> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	try {
		const token = await getAccessToken();
		if (token) headers.Authorization = `Bearer ${token}`;
	} catch {
		// Supabase not configured — endpoint returns 401, hook surfaces it.
	}
	return headers;
}

/**
 * Custom Error subclass para que el caller pueda leer tanto el código
 * canónico (`error`) como el mensaje raw del backend (`detail`) — clave
 * cuando el RPC tira RAISE con texto descriptivo y queremos mostrarlo
 * literalmente en un toast de diagnóstico.
 */
class ApiError extends Error {
	code: string;
	detail?: string;
	constructor(code: string, detail?: string) {
		super(detail ? `${code}: ${detail}` : code);
		this.code = code;
		this.detail = detail;
	}
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const headers = await buildHeaders();
	const res = await fetch(url, {
		...init,
		// El deck del evento cambia en vivo; nunca servir copia cacheada.
		cache: "no-store",
		headers: { ...headers, ...(init?.headers ?? {}) },
	});
	const payload = (await res.json().catch(() => ({}))) as T & {
		ok?: boolean;
		error?: string;
		detail?: string;
	};
	if (!res.ok || payload.ok === false) {
		throw new ApiError(payload.error ?? `http_${res.status}`, payload.detail);
	}
	return payload;
}

export function useMusic(eventId: string | null) {
	const tenant = useTenant();
	const [deck, setDeck] = useState<MusicTrack[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<MusicError | null>(null);

	const reload = useCallback(async () => {
		if (!eventId) return;
		setLoading(true);
		setError(null);
		try {
			const data = await fetchJson<{ ok: true; tracks: MusicTrack[] }>(
				`${ENDPOINT}?event_id=${encodeURIComponent(eventId)}&mode=swipe`,
				{
					method: "GET",
					headers: { "X-Tenant-Slug": tenant.slug },
				},
			);
			setDeck(data.tracks ?? []);
		} catch (err) {
			const message = err instanceof Error ? err.message : "network_error";
			setError((message as MusicError) ?? "network_error");
		} finally {
			setLoading(false);
		}
	}, [eventId, tenant.slug]);

	useEffect(() => {
		void reload();
	}, [reload]);

	const castVote = useCallback(
		async (params: {
			track_id: string;
			vote_type?: TrackVoteType;
			tokens_spent?: number;
			boost_context?: "jukebox" | "livebattle";
		}) => {
			if (!eventId) return { ok: false as const, error: "missing_event" };
			try {
				const data = await fetchJson<{
					ok: true;
					vote_id: string;
					total_votes: number;
					balance?: number;
				}>(ENDPOINT, {
					method: "POST",
					body: JSON.stringify({
						event_id: eventId,
						track_id: params.track_id,
						vote_type: params.vote_type ?? "free",
						// El server ignora este coste para boost (lo resuelve de
						// la BD); se envía sólo por compatibilidad.
						tokens_spent: params.tokens_spent ?? 0,
						boost_context: params.boost_context ?? "livebattle",
						tenant_slug: tenant.slug,
					}),
				});
				// Optimistically drop the voted track from the deck.
				setDeck((d) => d.filter((t) => t.id !== params.track_id));
				return {
					ok: true as const,
					vote_id: data.vote_id,
					total_votes: data.total_votes,
					balance: data.balance,
				};
			} catch (err) {
				if (err instanceof ApiError) {
					return {
						ok: false as const,
						error: (err.code as MusicError) ?? "rpc_failed",
						detail: err.detail,
					};
				}
				const message = err instanceof Error ? err.message : "network_error";
				return {
					ok: false as const,
					error: (message as MusicError) ?? "rpc_failed",
				};
			}
		},
		[eventId, tenant.slug],
	);

	return { deck, loading, error, reload, castVote };
}

// ─── DJ leaderboard (separate so it doesn't fire the swipe deck) ──────────

export function useDJLeaderboard(eventId: string | null, autoMs = 5_000) {
	const tenant = useTenant();
	const [tracks, setTracks] = useState<MusicTrack[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<MusicError | null>(null);
	const timerRef = useRef<number | null>(null);

	const reload = useCallback(async () => {
		if (!eventId) return;
		setLoading(true);
		setError(null);
		try {
			const data = await fetchJson<{ ok: true; tracks: MusicTrack[] }>(
				`${ENDPOINT}?event_id=${encodeURIComponent(eventId)}&mode=leaderboard`,
				{
					method: "GET",
					headers: { "X-Tenant-Slug": tenant.slug },
				},
			);
			setTracks(data.tracks ?? []);
		} catch (err) {
			const message = err instanceof Error ? err.message : "network_error";
			setError((message as MusicError) ?? "network_error");
		} finally {
			setLoading(false);
		}
	}, [eventId, tenant.slug]);

	useEffect(() => {
		void reload();
		if (!eventId || autoMs <= 0) return;
		timerRef.current = window.setInterval(() => void reload(), autoMs);
		return () => {
			if (timerRef.current !== null) window.clearInterval(timerRef.current);
			timerRef.current = null;
		};
	}, [reload, autoMs, eventId]);

	return { tracks, loading, error, reload };
}
