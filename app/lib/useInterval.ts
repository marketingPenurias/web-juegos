import { useEffect, useRef } from "react";

/**
 * useInterval — short-polling consciente de visibilidad.
 *
 *   Sustituye a las suscripciones Realtime de alto volumen (votos en vivo,
 *   "sonando ahora") por un GET ligero periódico.  Decisión de
 *   escalabilidad (Auditoría 360º · §2): un `setInterval` de 2.5s por
 *   cliente es infinitamente más barato para Postgres que difundir cada
 *   UPDATE de `event_tracks` a todos los móviles del local.
 *
 *   Reglas:
 *     · `delayMs = null` → polling APAGADO (componente sin evento activo).
 *     · Pausa automáticamente cuando la pestaña NO está visible
 *       (`document.hidden`) y reanuda al volver — ni gastamos batería ni
 *       martilleamos la API con la app en segundo plano.
 *     · NO dispara en el montaje: el caller ya hace su carga inicial; este
 *       hook sólo añade los ticks recurrentes.
 *
 *   El callback se guarda en un ref para que cambiar su identidad NO
 *   reinicie el intervalo (sólo `delayMs` lo hace).
 */
export function useInterval(callback: () => void, delayMs: number | null): void {
	const saved = useRef(callback);
	saved.current = callback;

	useEffect(() => {
		if (delayMs === null) return;

		let id: number | null = null;
		const start = () => {
			if (id === null) {
				id = window.setInterval(() => saved.current(), delayMs);
			}
		};
		const stop = () => {
			if (id !== null) {
				window.clearInterval(id);
				id = null;
			}
		};
		const onVisibility = () => {
			if (document.hidden) stop();
			else start();
		};

		if (!document.hidden) start();
		document.addEventListener("visibilitychange", onVisibility);

		return () => {
			stop();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [delayMs]);
}
