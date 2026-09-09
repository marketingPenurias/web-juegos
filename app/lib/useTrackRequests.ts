import { useCallback } from "react";
import { getAccessToken } from "./supabase.client";
import { useTenant } from "./tenant";

/**
 * useTrackRequests — pedirle al DJ una canción que la sala no tiene.
 *
 *   Texto libre a propósito: lo que ya está guardado se pide desde el propio
 *   Jukebox, que sirve el repertorio entero del local.  Esto cubre lo otro,
 *   que es lo que la gente pregunta de verdad en la barra.
 */

export type RequestResult =
	| { ok: true; requests: number; remaining: number; title: string }
	| { ok: false; error: string; limit?: number; title?: string; artist?: string };

export function useTrackRequests(eventId: string | null) {
	const tenant = useTenant();

	const request = useCallback(
		async (title: string, artist: string): Promise<RequestResult> => {
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
						title,
						artist,
						tenant_slug: tenant.slug,
					}),
				});
				const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
				if (data.ok === true) {
					return {
						ok: true,
						requests: Number(data.requests ?? 1),
						remaining: Number(data.remaining ?? 0),
						title: String(data.title ?? title),
					};
				}
				return {
					ok: false,
					error: String(data.error ?? "unknown"),
					limit: data.limit === undefined ? undefined : Number(data.limit),
					title: data.title === undefined ? undefined : String(data.title),
					artist: data.artist === undefined ? undefined : String(data.artist),
				};
			} catch {
				return { ok: false, error: "network_error" };
			}
		},
		[eventId, tenant.slug],
	);

	return { request };
}
