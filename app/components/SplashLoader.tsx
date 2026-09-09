import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { gsap, useGSAP } from "../lib/gsap";
import { resolveTheme, useTenant } from "../lib/tenant";

/**
 * SplashLoader — lo que se ve mientras la sesión aún no ha llegado.
 *
 *   El problema real (informe de Lucía, 5 de septiembre): la gente entra
 *   por el QR, la app pinta el Hub con los valores de maqueta —450 fichas,
 *   racha 3— y el gate del cumpleaños tarda en aparecer porque espera a
 *   `/api/session`.  Durante esos segundos alguien está mirando datos
 *   falsos, y en la puerta de una discoteca eso es peor que no ver nada.
 *
 *   Así que mientras `sessionPending` esté arriba se tapa la app entera con
 *   esta pantalla.  No es un spinner genérico: lleva la marca del local, de
 *   modo que el primer fotograma ya dice dónde estás.
 *
 *   El aviso de conexión lenta aparece a los 4 s.  En un local la red va
 *   mal por definición, y una frase que reconozca lo que está pasando evita
 *   que la gente cierre la pestaña pensando que la app está rota.
 */

const SLOW_MS = 4000;

export function SplashLoader() {
	const { t } = useTranslation();
	const tenant = useTenant();
	const theme = resolveTheme(tenant.theme);
	const root = useRef<HTMLDivElement>(null);
	const [slow, setSlow] = useState(false);

	useEffect(() => {
		const id = window.setTimeout(() => setSlow(true), SLOW_MS);
		return () => window.clearTimeout(id);
	}, []);

	useGSAP(
		() => {
			// Entrada suave: si la sesión llega rápido esto no llega ni a
			// verse del todo, y es justo lo que queremos.
			gsap.from(".splash-mark", {
				scale: 0.9,
				opacity: 0,
				duration: 0.45,
				ease: "power2.out",
			});
			// Latido — el pulso de la sala, no una rueda de carga.
			gsap.to(".splash-mark", {
				scale: 1.04,
				duration: 0.9,
				repeat: -1,
				yoyo: true,
				ease: "sine.inOut",
			});
			// Barra indeterminada: recorre el ancho sin prometer un porcentaje
			// que no sabemos.
			gsap.fromTo(
				".splash-bar",
				{ xPercent: -100 },
				{
					xPercent: 250,
					duration: 1.1,
					repeat: -1,
					ease: "power1.inOut",
				},
			);
		},
		{ scope: root },
	);

	return (
		<div
			ref={root}
			role="status"
			aria-live="polite"
			className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-neutral-950 px-8 text-center"
		>
			{/* El logo del local si lo tiene subido; si no, el búho de
			    NightGraph.  Nunca un texto de relleno: esto es lo primero que
			    ve alguien que acaba de escanear el QR en la puerta. */}
			<div
				className="splash-mark h-28 w-28 overflow-hidden rounded-3xl"
				style={{ boxShadow: `0 0 70px -10px ${theme.primary}` }}
			>
				<img
					src={theme.logoUrl || "/logo-nightgraph.jpg"}
					alt=""
					aria-hidden="true"
					className="h-full w-full object-cover"
				/>
			</div>

			<div className="space-y-1">
				<p className="text-lg font-bold text-white">{tenant.name}</p>
				<p className="text-sm text-zinc-400">{t("splash.loading")}</p>
			</div>

			<div className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
				<div
					className="splash-bar h-full w-1/3 rounded-full"
					style={{ backgroundColor: theme.primary }}
				/>
			</div>

			{slow && (
				<p className="max-w-[16rem] text-xs leading-relaxed text-zinc-500">
					{t("splash.slow")}
				</p>
			)}
		</div>
	);
}
