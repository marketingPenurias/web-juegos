import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Zap } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";
import { formatEur as eur } from "../../lib/money";
import type { TvFlashDrop } from "./FlashDropBanner";

/**
 * FlashDropAlert — el momento del lanzamiento, a pantalla completa.
 *
 *   La banda de abajo (`FlashDropBanner`) es el recordatorio: se queda los
 *   quince o treinta minutos que dura la promoción.  Pero el lanzamiento en
 *   sí no tenía momento, y ahí es donde se gana o se pierde: una banda que
 *   aparece abajo mientras la sala mira el ranking se la come el ruido.
 *
 *   Es el mismo trato que le damos a la batalla de temas —toma de pantalla y
 *   QR para actuar— porque el trabajo es idéntico: convertir la atención de
 *   la sala en gente sacando el móvil.  Doce segundos y se va; después manda
 *   otra vez la música y queda la banda.
 *
 *   Sólo salta con un drop RECIÉN lanzado.  Una pantalla que se reinicia a
 *   mitad de noche recibe el drop que lleva veinte minutos corriendo, y
 *   anunciarlo como nuevo sería mentirle a la sala; para eso ya está la
 *   banda.  Y se enseña UNA vez por campaña, no en cada reconexión.
 */

const SHOW_MS = 12_000;
/** Margen para considerar que el drop acaba de lanzarse. */
const FRESH_MS = 90_000;

export function FlashDropAlert({
	drop,
	qrUrl,
}: {
	drop: TvFlashDrop | null;
	qrUrl: string;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [shownId, setShownId] = useState<string | null>(null);
	// Campañas ya anunciadas: el Realtime manda un UPDATE por cada canje y no
	// vamos a tomar la pantalla cada vez que alguien pide una copa.
	const announced = useRef<Set<string>>(new Set());

	useEffect(() => {
		if (!drop) return;
		if (announced.current.has(drop.id)) return;
		const startedAt = drop.valid_from
			? new Date(drop.valid_from).getTime()
			: null;
		// Sin fecha de inicio no se anuncia: más vale callarse que gritar algo
		// que la sala ya vio hace media hora.
		if (startedAt === null || Date.now() - startedAt > FRESH_MS) {
			announced.current.add(drop.id);
			return;
		}
		announced.current.add(drop.id);
		setShownId(drop.id);
		const id = window.setTimeout(() => setShownId(null), SHOW_MS);
		return () => window.clearTimeout(id);
	}, [drop]);

	useGSAP(
		() => {
			if (!shownId) return;
			// Misma cautela que en la cuña: si el navegador congela los
			// fotogramas, una entrada desde `opacity: 0` deja doce segundos de
			// nada en una pantalla que nadie va a tocar.
			if (document.visibilityState !== "visible") return;
			gsap.from(".fda-in", {
				y: 40,
				opacity: 0,
				stagger: 0.1,
				duration: 0.6,
				ease: "back.out(1.4)",
			});
			gsap.to(".fda-bolt", {
				scale: 1.12,
				duration: 0.7,
				repeat: -1,
				yoyo: true,
				ease: "sine.inOut",
			});
		},
		{ scope: rootRef, dependencies: [shownId] },
	);

	if (!drop || shownId !== drop.id) return null;

	const left =
		drop.stock_total === null
			? null
			: Math.max(0, drop.stock_total - drop.stock_used);

	return (
		<div
			ref={rootRef}
			className="absolute inset-0 z-[48] bg-black/90 backdrop-blur-xl flex items-center justify-center overflow-hidden px-8 py-8 xl:px-16"
			role="status"
			aria-live="polite"
		>
			<div className="w-full max-w-[1500px] grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-10 xl:gap-20 items-center justify-items-center xl:justify-items-stretch">
				<div className="min-w-0 text-center xl:text-left">
					<div className="fda-in flex items-center justify-center xl:justify-start gap-4">
						<span className="fda-bolt inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-fuchsia-400">
							<Zap className="w-9 h-9 text-black" aria-hidden="true" />
						</span>
						<span className="text-4xl font-black italic uppercase tracking-tighter text-fuchsia-300">
							Flash Drop
						</span>
					</div>

					<h2 className="fda-in mt-6 text-5xl sm:text-6xl xl:text-8xl font-black italic tracking-tighter leading-[0.9] truncate">
						{drop.label ?? drop.product_name}
					</h2>

					<div className="fda-in mt-8 flex flex-wrap items-baseline justify-center xl:justify-start gap-4 xl:gap-6">
						{drop.list_price_eur !== null && (
							<span className="text-4xl xl:text-6xl font-black tabular-nums text-zinc-600 line-through">
								{eur(drop.list_price_eur)}
							</span>
						)}
						<span className="text-6xl xl:text-8xl font-black tabular-nums text-amber-300 drop-shadow-[0_0_40px_rgba(252,211,77,0.5)]">
							{eur(drop.promo_price_eur)}
						</span>
					</div>

					{left !== null && (
						<p className="fda-in mt-6 text-xl xl:text-3xl font-black uppercase tracking-widest text-zinc-400">
							Sólo quedan{" "}
							<span className="text-white tabular-nums">{left}</span>
						</p>
					)}
				</div>

				<div className="fda-in flex flex-col items-center gap-5 shrink-0">
					<div className="rounded-3xl bg-white p-6 shadow-[0_0_80px_rgba(217,70,239,0.5)]">
						<QRCodeSVG
							value={qrUrl}
							level="M"
							marginSize={0}
							fgColor="#000000"
							bgColor="#ffffff"
							className="w-52 h-52 xl:w-72 xl:h-72"
						/>
					</div>
					<p className="text-3xl font-black italic tracking-tight">
						Escanea y pídelo
					</p>
				</div>
			</div>
		</div>
	);
}
