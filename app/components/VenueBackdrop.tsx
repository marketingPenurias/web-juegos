import { useRef } from "react";
import { gsap, useGSAP } from "../lib/gsap";

/**
 * VenueBackdrop — fondo dinámico de la TV con las fotos del local.
 *
 *   Dos modos:
 *     · CARRUSEL (default): rota las fotos con un CROSSFADE lento (GSAP) +
 *       Ken Burns sutil para que el fondo "respire" sin distraer.
 *     · FIJADO (`pinnedUrl`): el DJ ha clavado una imagen desde /admin →
 *       se muestra ESTÁTICA, sin animación (ej. flyer "Promo Chupitos").
 *
 *   Encima va una capa oscura para legibilidad (Batalla, Leaderboard, QR).
 *   Diseñado para vivir DETRÁS del contenido (lo posiciona el padre con
 *   z-index): sólo ocupa el `absolute inset-0` que le den.
 */

const HOLD_S = 6; // segundos visible cada foto
const FADE_S = 2.2; // duración del crossfade
const KENBURNS_S = 14; // zoom lento (ida/vuelta)

export function VenueBackdrop({
	urls,
	pinnedUrl = null,
}: {
	urls: string[];
	pinnedUrl?: string | null;
}) {
	const ref = useRef<HTMLDivElement>(null);

	// Imagen fija → una sola foto estática.  Carrusel → todas las del local.
	const isPinned = Boolean(pinnedUrl);
	const photos = isPinned ? [pinnedUrl as string] : urls;

	useGSAP(
		() => {
			// FIJADO: estática, sin animar (lo pidió el CTO para los flyers).
			if (isPinned) return;

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
		{ scope: ref, dependencies: [photos.join("|"), isPinned] },
	);

	return (
		<div ref={ref} className="absolute inset-0 overflow-hidden" aria-hidden="true">
			{photos.map((url) => (
				<div
					key={url}
					className="venue-photo absolute inset-0 will-change-transform"
					style={{
						backgroundImage: `url("${url}")`,
						backgroundSize: "cover",
						backgroundPosition: "center",
						// Fijada → visible ya (sin GSAP).  Carrusel → GSAP la revela.
						opacity: isPinned ? 1 : 0,
					}}
				/>
			))}
			{/* Capa oscura para legibilidad del leaderboard / batalla / QR. */}
			<div className="absolute inset-0 bg-black/65" />
		</div>
	);
}
