import { useCallback, useState } from "react";
import { getAccessToken } from "./supabase.client";
import { useTenant } from "./tenant";

/**
 * useTrackRequests — pedirle al DJ una canción que no cargó esta noche.
 *
 *   Busca en el ALMACÉN de la sala, no en texto libre: así el DJ recibe una
 *   canción de verdad —con su género y su carátula— que mete de un toque, en
 *   vez de un texto suelto que alguien tiene que buscar a las tres de la
 *   mañana.  Y el que pide sabe que el DJ la tiene: no está pidiendo al aire.
 */

export type LibraryTrack = {
	id: string;
	title: string;
	artist: string;
	genre: string | null;
	cover_image_url: string | null;
};

export type RequestResult =
	| { ok: true; requests: number; remaining: number; title: string }
	| { ok: false; error: string; limit?: number };

export function useTrackRequests(eventId: string | null) {
	const tenant = useTenant();
	const [results, setResults] = useState<LibraryTrack[]>([]);
	const [searching, setSearching] = useState(false);

	const search = useCallback(
		async (q: string) => {
			if (!eventId || q.trim().length < 2) {
				setResults([]);
				return;
			}
			setSearching(true);
			try {
				const token = await getAccessToken();
				if (!token) {
					setResults([]);
					return;
				}
				const url = `/api/requests?q=${encodeURIComponent(q.trim())}&event_id=${encodeURIComponent(eventId)}&tenant_slug=${encodeURIComponent(tenant.slug)}`;
				const res = await fetch(url, {
					cache: "no-store",
					headers: {
						Authorization: `Bearer ${token}`,
						"X-Tenant-Slug": tenant.slug,
					},
				});
				const data = (await res.json().catch(() => ({}))) as {
					ok?: boolean;
					tracks?: LibraryTrack[];
				};
				setResults(data.ok ? (data.tracks ?? []) : []);
			} catch {
				// En un local la red se cae a mitad de petición con normalidad.
				// Sin resultados es una respuesta honesta; no hay que romper nada.
				setResults([]);
			} finally {
				setSearching(false);
			}
		},
		[eventId, tenant.slug],
	);

	const request = useCallback(
		async (globalTrackId: string): Promise<RequestResult> => {
			if (!eventId) return { ok: false, error: "no_event" };
			try {
				const token = await getAccessToken();
				if (!token) return { ok: false, error: "unauthorized" };
				const res = await fetch("/api/requests", {
					method: "POST",
					cache: "no-store",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
						"X-Tenant-Slug": tenant.slug,
					},
					body: JSON.stringify({
						event_id: eventId,
						global_track_id: globalTrackId,
						tenant_slug: tenant.slug,
					}),
				});
				const data = (await res.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				if (data.ok === true) {
					return {
						ok: true,
						requests: Number(data.requests ?? 1),
						remaining: Number(data.remaining ?? 0),
						title: String(data.title ?? ""),
					};
				}
				return {
					ok: false,
					error: String(data.error ?? "unknown"),
					limit: data.limit === undefined ? undefined : Number(data.limit),
				};
			} catch {
				return { ok: false, error: "network_error" };
			}
		},
		[eventId, tenant.slug],
	);

	return { results, searching, search, request, clear: () => setResults([]) };
}
