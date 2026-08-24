import { useEffect, useRef, useState } from "react";
import { PartyPopper } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";

/**
 * RedemptionTicker — prueba social en la pantalla del local.
 *
 *   El menú secreto es invisible desde fuera: nadie sabe que la gente está
 *   canjeando de verdad, así que parece un adorno de la app.  Anunciar cada
 *   canje en la pantalla convierte una compra privada en una señal para toda
 *   la sala: "esto funciona y la gente lo está usando".
 *
 *   **Sin nombres, a propósito.**  Para el efecto basta con que HAYA pasado; a
 *   quién le pasó no aporta nada y ata a una persona con lo que se ha bebido
 *   delante de todo el local.
 *
 *   Se muestra de uno en uno y en cola: en una hora punta pueden caer varios
 *   canjes seguidos, y apilarlos convertiría la esquina de la pantalla en
 *   ruido ilegible.
 *
 *   Recibe SOLO el último evento con su número de orden, no la lista entera.
 *   Esta pantalla está encendida toda la noche: una lista acumulada crecería
 *   sin techo durante horas.  El contador basta para saber si hay algo nuevo.
 */

const VISIBLE_MS = 5000;
/** Tope de cola: en una avalancha se anuncian los últimos, no todos. */
const MAX_PENDING = 5;

export type RedemptionEvent = { seq: number; name: string };

export function RedemptionTicker({ latest }: { latest: RedemptionEvent | null }) {
	const [current, setCurrent] = useState<string | null>(null);
	const pending = useRef<string[]>([]);
	const lastSeq = useRef(0);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!latest || latest.seq <= lastSeq.current) return;
		lastSeq.current = latest.seq;
		pending.current.push(latest.name);
		// Si entran más rápido de lo que se pueden enseñar, se descartan los más
		// viejos: anunciar con dos minutos de retraso no es prueba social.
		if (pending.current.length > MAX_PENDING) {
			pending.current = pending.current.slice(-MAX_PENDING);
		}
	}, [latest]);

	useEffect(() => {
		const id = setInterval(() => {
			setCurrent((cur) => {
				if (cur) return cur; // uno cada vez
				return pending.current.shift() ?? null;
			});
		}, 400);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		if (!current) return;
		const id = setTimeout(() => setCurrent(null), VISIBLE_MS);
		return () => clearTimeout(id);
	}, [current]);

	useGSAP(
		() => {
			if (!current) return;
			gsap.fromTo(
				ref.current,
				{ x: 80, opacity: 0 },
				{ x: 0, opacity: 1, duration: 0.5, ease: "back.out(1.6)", clearProps: "opacity" },
			);
		},
		{ scope: ref, dependencies: [current] },
	);

	if (!current) return null;

	return (
		<div
			ref={ref}
			// Arriba a la derecha: no pisa el ranking (izquierda), ni la banda del
			// Flash Drop (abajo), ni el overlay del ganador (centro).
			className="absolute top-8 right-8 z-30 pointer-events-none"
			role="status"
			aria-live="polite"
		>
			<div className="rounded-2xl bg-lime-400/95 px-6 py-3.5 flex items-center gap-3 shadow-[0_0_50px_rgba(57,255,20,0.45)]">
				<PartyPopper className="w-7 h-7 text-black shrink-0" aria-hidden="true" />
				<div>
					<p className="text-[11px] font-black uppercase tracking-[0.2em] text-black/60 leading-none">
						Acaban de canjear
					</p>
					<p className="text-2xl font-black italic tracking-tight text-black leading-tight">
						{current}
					</p>
				</div>
			</div>
		</div>
	);
}
