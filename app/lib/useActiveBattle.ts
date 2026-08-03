import { useCallback, useEffect } from "react";
import { getBrowserSupabase } from "./supabase.client";
import { useInterval } from "./useInterval";
import { useGameState } from "../store/useGameState";

/**
 * useActiveBattle — ¿hay un duelo EN VIVO ahora mismo?
 *
 *   Alimenta el aviso flotante ("nube") que aparece sobre *Directo* en el
 *   BottomNav y en el lanzador de juegos, para que la gente sepa que hay
 *   batalla sin tener que entrar a mirar.
 *
 *   Se monta UNA sola vez (en `LaPochaApp`) y publica el resultado en el store:
 *   así los consumidores leen un booleano y no abrimos un socket por
 *   componente.  `LiveBattle` mantiene su propio canal porque necesita el
 *   detalle del duelo (temas y porcentajes), no sólo si existe.
 *
 *   Red: Realtime `live_battles` como vía primaria (bajo volumen: una fila por
 *   duelo) + poll de seguridad lento por si el WebSocket cae.  El cierre por
 *   `ends_at` lo hace el cron cada minuto, de ahí que 30s baste.
 */

const FALLBACK_POLL_MS = 30_000;

export function useActiveBattle(): void {
	const eventId = useGameState((s) => s.activeEventId);
	const setBattleActive = useGameState((s) => s.setBattleActive);

	const check = useCallback(async () => {
		const supabase = getBrowserSupabase();
		if (!supabase || !eventId) {
			setBattleActive(false);
			return;
		}
		const { data } = await supabase
			.from("live_battles")
			.select("id")
			.eq("event_id", eventId)
			.eq("status", "live")
			.limit(1)
			.maybeSingle();
		setBattleActive(Boolean(data?.id));
	}, [eventId, setBattleActive]);

	useEffect(() => {
		if (!eventId) {
			setBattleActive(false);
			return;
		}
		void check();

		const supabase = getBrowserSupabase();
		if (!supabase) return;
		const channel = supabase
			.channel(`app:battle-indicator:${eventId}`)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "live_battles",
					filter: `event_id=eq.${eventId}`,
				},
				// Cualquier cambio (alta, cierre, borrado) → re-preguntamos el estado
				// real en vez de deducirlo del payload: una sola query trivial y sin
				// riesgo de desincronizarnos.
				() => void check(),
			)
			.subscribe();

		return () => {
			void supabase.removeChannel(channel);
		};
	}, [eventId, check, setBattleActive]);

	useInterval(() => void check(), eventId ? FALLBACK_POLL_MS : null);
}
