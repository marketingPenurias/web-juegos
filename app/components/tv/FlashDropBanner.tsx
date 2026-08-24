import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";

/**
 * FlashDropBanner — el Flash Drop en la pantalla del local.
 *
 *   Un drop dura 15-30 minutos y solo funciona si la sala se entera.  Si vive
 *   únicamente en el móvil, se entera quien ya estaba mirando el teléfono, que
 *   es exactamente al revés de lo que buscamos: la pantalla es lo que hace que
 *   la gente SAQUE el móvil.
 *
 *   Es una banda inferior, no una toma de pantalla: el ranking y la batalla
 *   siguen siendo el contenido principal de la noche y taparlos por una
 *   promoción sería cambiar un problema por otro.  Lo que sí hace es entrar
 *   fuerte —el lanzamiento tiene que notarse— y luego quedarse quieta.
 *
 *   Las dos cifras que empujan son el ahorro y lo que queda: "9€ → 4€" y
 *   "quedan 8".  El stock baja en vivo con cada canje, y ver bajar un número
 *   en la pantalla grande es la mejor prueba social que tenemos.
 */

export type TvFlashDrop = {
	id: string;
	label: string | null;
	product_name: string;
	promo_price_eur: number | null;
	list_price_eur: number | null;
	valid_to: string | null;
	stock_total: number | null;
	stock_used: number;
};

function eur(v: number | null): string {
	return v === null ? "—" : `${Math.round(v)}€`;
}

/** mm:ss que queda. Vacío cuando ya terminó. */
function countdown(ms: number): string {
	if (ms <= 0) return "";
	const total = Math.floor(ms / 1000);
	return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function FlashDropBanner({ drop }: { drop: TvFlashDrop | null }) {
	const ref = useRef<HTMLDivElement>(null);
	const [now, setNow] = useState(() => Date.now());

	// Un segundo: en la pantalla grande la cuenta atrás es media promoción.
	useEffect(() => {
		if (!drop) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [drop]);

	// Entrada por cada drop NUEVO (de ahí el id en las dependencias): el
	// lanzamiento tiene que notarse desde la otra punta del local.
	useGSAP(
		() => {
			if (!drop) return;
			gsap.fromTo(
				ref.current,
				{ y: 120, opacity: 0 },
				{ y: 0, opacity: 1, duration: 0.7, ease: "back.out(1.4)", clearProps: "opacity" },
			);
			gsap.fromTo(
				".fd-pulse",
				{ scale: 1 },
				{
					scale: 1.06,
					duration: 0.9,
					repeat: -1,
					yoyo: true,
					ease: "sine.inOut",
				},
			);
		},
		{ scope: ref, dependencies: [drop?.id] },
	);

	if (!drop) return null;

	const msLeft = drop.valid_to ? new Date(drop.valid_to).getTime() - now : 0;
	// Terminado pero aún no llegó el evento de realtime: se retira sola en vez
	// de anunciar una promoción que ya no existe.
	if (msLeft <= 0) return null;

	const left =
		drop.stock_total === null
			? null
			: Math.max(0, drop.stock_total - drop.stock_used);
	const soldOut = left === 0;

	return (
		<div
			ref={ref}
			className="absolute bottom-0 left-0 right-0 z-40 px-8 pb-6 pointer-events-none"
		>
			<div
				className={cnBanner(soldOut)}
				role="status"
				aria-live="polite"
			>
				<div className="fd-pulse flex items-center gap-3 shrink-0">
					<Zap className="w-10 h-10 text-black" aria-hidden="true" />
					<span className="text-3xl font-black italic tracking-tighter text-black uppercase">
						{soldOut ? "Agotado" : "Flash Drop"}
					</span>
				</div>

				<div className="flex-1 min-w-0 flex items-baseline gap-4">
					<span className="text-4xl font-black italic tracking-tight text-black truncate">
						{drop.label ?? drop.product_name}
					</span>
					{!soldOut && drop.list_price_eur !== null && (
						<span className="text-3xl font-black tabular-nums shrink-0">
							<span className="line-through text-black/45">
								{eur(drop.list_price_eur)}
							</span>{" "}
							<span className="text-black">{eur(drop.promo_price_eur)}</span>
						</span>
					)}
				</div>

				{!soldOut && (
					<div className="flex items-center gap-6 shrink-0">
						{left !== null && (
							<div className="text-center">
								<p className="text-4xl font-black tabular-nums text-black leading-none">
									{left}
								</p>
								<p className="text-[11px] font-black uppercase tracking-widest text-black/60">
									quedan
								</p>
							</div>
						)}
						<div className="text-center">
							<p className="text-4xl font-black tabular-nums text-black leading-none">
								{countdown(msLeft)}
							</p>
							<p className="text-[11px] font-black uppercase tracking-widest text-black/60">
								se acaba
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function cnBanner(soldOut: boolean): string {
	// Agotado pierde el fucsia: sigue informando, pero deja de gritar.
	return [
		"rounded-3xl px-8 py-5 flex items-center gap-8",
		"shadow-[0_0_80px_rgba(217,70,239,0.55)]",
		soldOut
			? "bg-zinc-300"
			: "bg-gradient-to-r from-fuchsia-400 via-fuchsia-300 to-amber-300",
	].join(" ");
}
