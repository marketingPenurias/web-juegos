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
 *   ⚡ ANTI FAN-OUT CUADRÁTICO (Auditoría 360º · §2):
 *   Este canal escucha SÓLO `INSERT` y `DELETE` — eventos RAROS (el DJ
 *   mete/quita un tema).  El `UPDATE` de `event_tracks` se ELIMINÓ a
 *   propósito: cada voto incrementaba `total_votes`, y con `postgres_changes`
 *   sobre UPDATE eso se difundía a TODOS los clientes del evento (500 votos
 *   × 500 móviles = 250k mensajes/min por local) saturando el WAL de
 *   Postgres → Realtime.  Los porcentajes en vivo y el "sonando ahora" se
 *   refrescan ahora por SHORT-POLLING (GET ligero cada 2.5s) en `LiveBattle`
 *   y `NowPlaying`, no por WebSocket.
 *
 *   Cada consumidor recibe el payload crudo de INSERT/DELETE y decide qué
 *   hacer (NowPlaying limpia si borran el tema que sonaba; LiveBattle lo
 *   ignora y se apoya en el polling).
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

	// Fan-out a TODOS los consumidores enganchados al singleton.
	const fanout = (payload: unknown) => {
		for (const sub of subscribers) sub(payload as EventTrackChange);
	};

	// SÓLO INSERT + DELETE.  El UPDATE (votos) se sirve por short-polling
	// para no saturar el WAL/WebSockets (ver cabecera del módulo).
	sharedChannel = supabase
		.channel(`event_tracks:shared:${eventId}`)
		.on(
			"postgres_changes",
			{
				event: "INSERT",
				schema: "public",
				table: "event_tracks",
				filter: `event_id=eq.${eventId}`,
			},
			fanout,
		)
		.on(
			"postgres_changes",
			{
				event: "DELETE",
				schema: "public",
				table: "event_tracks",
				filter: `event_id=eq.${eventId}`,
			},
			fanout,
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
