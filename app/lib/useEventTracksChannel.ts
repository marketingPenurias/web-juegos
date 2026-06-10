import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserSupabase } from "./supabase.client";

/**
 * useEventTracksChannel — UN SOLO canal Realtime de `event_tracks` por
 * evento, COMPARTIDO entre componentes (Operación Wiring · WebSockets).
 *
 *   Antes la pantalla `live` del móvil abría DOS suscripciones idénticas a
 *   `event_tracks` (una en `NowPlaying`, otra en `LiveBattle`), procesando
 *   el mismo payload dos veces.  Este hook mantiene un registro
 *   module-level ref-counted: el primer consumidor abre el canal, los
 *   siguientes se enganchan, y cuando el último se desmonta se cierra.
 *
 *   Cada consumidor recibe el payload crudo y decide qué hacer (NowPlaying
 *   mira `is_played`; LiveBattle mira `total_votes` de sus dos pistas).
 */

export type EventTrackChange = {
	eventType?: string;
	new?: Record<string, unknown>;
	old?: Record<string, unknown>;
};

type Subscriber = (payload: EventTrackChange) => void;

type Entry = {
	channel: RealtimeChannel | null;
	subscribers: Set<Subscriber>;
};

// Registro compartido por event_id — vive mientras haya ≥1 suscriptor.
const registry = new Map<string, Entry>();

function acquire(eventId: string, cb: Subscriber): () => void {
	let entry = registry.get(eventId);
	if (!entry) {
		const supabase = getBrowserSupabase();
		const subscribers = new Set<Subscriber>();
		let channel: RealtimeChannel | null = null;
		if (supabase) {
			channel = supabase
				.channel(`event_tracks:shared:${eventId}`)
				.on(
					"postgres_changes",
					{
						event: "*",
						schema: "public",
						table: "event_tracks",
						filter: `event_id=eq.${eventId}`,
					},
					(payload) => {
						// Fan-out a TODOS los consumidores enganchados.
						for (const sub of subscribers) sub(payload as EventTrackChange);
					},
				)
				.subscribe();
		}
		entry = { channel, subscribers };
		registry.set(eventId, entry);
	}
	entry.subscribers.add(cb);

	return () => {
		const e = registry.get(eventId);
		if (!e) return;
		e.subscribers.delete(cb);
		if (e.subscribers.size === 0) {
			const supabase = getBrowserSupabase();
			if (supabase && e.channel) void supabase.removeChannel(e.channel);
			registry.delete(eventId);
		}
	};
}

export function useEventTracksChannel(
	eventId: string | null,
	onChange: (p: EventTrackChange) => void,
): void {
	// Mantenemos el callback en un ref para que cambiar su identidad NO
	// re-suscriba el canal (la suscripción sólo depende de `eventId`).
	const cbRef = useRef(onChange);
	cbRef.current = onChange;

	useEffect(() => {
		if (!eventId) return;
		const stable: Subscriber = (p) => cbRef.current(p);
		const release = acquire(eventId, stable);
		return release;
	}, [eventId]);
}
