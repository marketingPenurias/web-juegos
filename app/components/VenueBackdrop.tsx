import { useRef } from "react";
import { gsap, useGSAP } from "../lib/gsap";

/**
 * VenueBackdrop — fondo dinámico de la TV con las fotos del local.
 *
 *   Renderiza todas las imágenes apiladas a pantalla completa y las hace
 *   rotar con un CROSSFADE lento (GSAP) + un Ken Burns sutil (zoom muy
 *   lento) para que el fondo "respire" sin distraer de las mecánicas
 *   (Batalla, Leaderboard, QR).  Encima va una capa oscura para mantener
 *   la legibilidad del contenido.
 *
 *   Diseñado para vivir DETRÁS del contenido (lo posiciona el padre con
 *   z-index): este componente sólo ocupa el `absolute inset-0` que le den.
 */

const HOLD_S = 6; // segundos visible cada foto
const FADE_S = 2.2; // duración del crossfade
const KENBURNS_S = 14; // zoom lento (ida/vuelta)

export function VenueBackdrop({ urls }: { urls: string[] }) {
	const ref = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			const layers = gsap.utils.toArray<HTMLElement>(".venue-photo");
			if (layers.length === 0) return;

			// Estado base: todas ocultas y ligeramente ampliadas; la 1ª visible.
			gsap.set(layers, { opacity: 0, scale: 1.05 });
			gsap.set(layers[0], { opacity: 1 });

			// Ken Burns continuo e independiente en cada capa.
			layers.forEach((layer, i) => {
				gsap.to(layer, {
					scale: 1.14,
					duration: KENBURNS_S,
					ease: "none",
					repeat: -1,
					yoyo: true,
					delay: i * 1.5,
				});
			});

			// Una sola foto → nada que rotar.
			if (layers.length === 1) return;

			// Carrusel: crossfade encadenado en bucle infinito.
			const tl = gsap.timeline({ repeat: -1 });
			layers.forEach((layer, i) => {
				const next = layers[(i + 1) % layers.length];
				tl.to(next, { opacity: 1, duration: FADE_S, ease: "power2.inOut" }, `+=${HOLD_S}`)
					.to(layer, { opacity: 0, duration: FADE_S, ease: "power2.inOut" }, "<");
			});
		},
		{ scope: ref, dependencies: [urls.join("|")] },
	);

	return (
		<div ref={ref} className="absolute inset-0 overflow-hidden" aria-hidden="true">
			{urls.map((url) => (
				<div
					key={url}
					className="venue-photo absolute inset-0 will-change-transform"
					style={{
						backgroundImage: `url("${url}")`,
						backgroundSize: "cover",
						backgroundPosition: "center",
						opacity: 0,
					}}
				/>
			))}
			{/* Capa oscura para legibilidad del leaderboard / batalla / QR. */}
			<div className="absolute inset-0 bg-black/65" />
		</div>
	);
}
