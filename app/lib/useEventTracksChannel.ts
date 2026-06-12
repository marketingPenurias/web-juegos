import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserSupabase } from "./supabase.client";

/**
 * useEventTracksChannel — UN SOLO canal Realtime de `event_tracks` por
 * evento, COMPARTIDO entre componentes (Operación Wiring · WebSockets).
 *
 *   Antes la pantalla `live` del móvil abría DOS suscripciones idénticas a
 *   `event_tracks` (una en `NowPlaying`, otra en `LiveBattle`).  Aquí el
 *   estado del canal vive a NIVEL DE MÓDULO (fuera del ciclo de vida de
 *   React), así que es un Singleton auténtico: por muchas veces que React
 *   re-renderice o monte componentes, sólo existe UN socket a la vez.
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

// ── Estado SINGLETON a nivel de módulo (NO dentro del hook) ─────────────
let sharedChannel: RealtimeChannel | null = null;
let sharedEventId: string | null = null;
let subscriberCount = 0;
const subscribers = new Set<Subscriber>();

/** Abre (o reabre, si cambió el evento) el único canal compartido. */
function ensureChannel(eventId: string): void {
	if (sharedChannel && sharedEventId === eventId) return; // ya abierto para este evento

	// Evento distinto o sin canal → cerramos el anterior antes de abrir.
	if (sharedChannel) {
		const sb = getBrowserSupabase();
		if (sb) void sb.removeChannel(sharedChannel);
		sharedChannel = null;
	}

	const supabase = getBrowserSupabase();
	sharedEventId = eventId;
	if (!supabase) return; // SSR / sin configurar: sin socket (los cb nunca disparan)

	sharedChannel = supabase
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
				// Fan-out a TODOS los consumidores enganchados al singleton.
				for (const sub of subscribers) sub(payload as EventTrackChange);
			},
		)
		.subscribe();
}

/** Cierra el canal singleton cuando ya no queda ningún consumidor. */
function teardown(): void {
	const sb = getBrowserSupabase();
	if (sb && sharedChannel) void sb.removeChannel(sharedChannel);
	sharedChannel = null;
	sharedEventId = null;
}

export function useEventTracksChannel(
	eventId: string | null,
	onChange: (p: EventTrackChange) => void,
): void {
	// El callback vive en un ref: cambiar su identidad NO re-suscribe nada
	// (la suscripción sólo depende de `eventId`).
	const cbRef = useRef(onChange);
	cbRef.current = onChange;

	useEffect(() => {
		if (!eventId) return;
		const stable: Subscriber = (p) => cbRef.current(p);
		subscribers.add(stable);
		subscriberCount += 1;
		ensureChannel(eventId);

		return () => {
			subscribers.delete(stable);
			subscriberCount -= 1;
			if (subscriberCount <= 0) {
				subscriberCount = 0;
				teardown();
			}
		};
	}, [eventId]);
}
