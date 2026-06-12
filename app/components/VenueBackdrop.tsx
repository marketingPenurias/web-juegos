import { useEffect, useRef } from "react";
import { gsap, useGSAP } from "../lib/gsap";

/**
 * VenueBackdrop — fondo de la TV: VÍDEO del local + FOTOS, con 3 modos
 * que controla el DJ desde /admin (persistido en tenant_events.metadata).
 *
 *   El VÍDEO (`videoUrl`) es la identidad del local y, salvo en modo
 *   "foto fija", se reproduce SIEMPRE de fondo.  Las fotos son una capa
 *   por encima cuyo comportamiento depende del modo:
 *
 *     · "video"    → sólo el vídeo (fotos ocultas).
 *     · "photo"    → una foto FIJA (`pinnedUrl`); el vídeo se PAUSA y la
 *                    foto se muestra estática, sin animar.
 *     · "carousel" → MIXTO: el vídeo corre de base y las fotos entran/salen
 *                    con crossfade + Ken Burns, revelando el vídeo entre
 *                    foto y foto (el vídeo tiene "airtime").  Si no hay
 *                    vídeo, las fotos hacen crossfade continuo entre ellas.
 *
 *   Encima va una capa oscura para la legibilidad (Batalla, Top, QR).
 *   Vive DETRÁS del contenido (lo posiciona el padre con z-index): sólo
 *   ocupa el `absolute inset-0` que le den.
 */

export type TvBackdropMode = "video" | "photo" | "carousel";

const KENBURNS_S = 14; // zoom lento (ida/vuelta)
const FADE_S = 2.2; // duración del crossfade
const PHOTO_HOLD_S = 5; // foto visible en modo mixto
const VIDEO_GAP_S = 4; // vídeo solo entre fotos (mixto) → airtime del vídeo
const PHOTO_ONLY_HOLD_S = 6; // foto visible si NO hay vídeo (crossfade continuo)

export function VenueBackdrop({
	videoUrl,
	photos,
	mode,
	pinnedUrl = null,
}: {
	videoUrl: string | null;
	photos: string[];
	mode: TvBackdropMode;
	pinnedUrl?: string | null;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const videoRef = useRef<HTMLVideoElement>(null);

	const hasVideo = Boolean(videoUrl);

	// Capas de foto a renderizar según el modo.
	//   photo    → sólo la foto fijada.
	//   carousel → todas las fotos del local.
	//   video    → ninguna (sólo el vídeo).
	const photoLayers =
		mode === "photo" && pinnedUrl
			? [pinnedUrl]
			: mode === "carousel"
				? photos
				: [];

	// Pausar/reanudar el vídeo según el modo (en "photo" se pausa).
	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;
		if (mode === "photo") {
			v.pause();
		} else {
			void v.play().catch(() => {
				/* autoplay puede rechazarse sin gesto; el loop/muted lo reintenta */
			});
		}
	}, [mode, videoUrl]);

	useGSAP(
		() => {
			const layers = gsap.utils.toArray<HTMLElement>(".venue-photo");

			// FOTO FIJA → estática, visible, sin animar.
			if (mode === "photo") {
				gsap.set(layers, { opacity: 1, scale: 1 });
				return;
			}

			// Sin capas de foto (modo "video", o carrusel sin fotos) → nada que animar.
			if (layers.length === 0) return;

			// Ken Burns continuo e independiente en cada capa.
			gsap.set(layers, { opacity: 0, scale: 1.05 });
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

			if (hasVideo) {
				// MIXTO con vídeo: el vídeo es la base; cada foto entra, se mantiene
				// y sale (revelando el vídeo entre fotos → el vídeo se ve siempre).
				const tl = gsap.timeline({ repeat: -1 });
				layers.forEach((layer) => {
					tl.to(layer, { opacity: 1, duration: FADE_S, ease: "power2.inOut" }, `+=${VIDEO_GAP_S}`)
						.to(layer, { opacity: 0, duration: FADE_S, ease: "power2.inOut" }, `+=${PHOTO_HOLD_S}`);
				});
				return;
			}

			// Sin vídeo: crossfade continuo entre fotos (siempre una visible).
			gsap.set(layers[0], { opacity: 1 });
			if (layers.length === 1) return;
			const tl = gsap.timeline({ repeat: -1 });
			layers.forEach((layer, i) => {
				const next = layers[(i + 1) % layers.length];
				tl.to(next, { opacity: 1, duration: FADE_S, ease: "power2.inOut" }, `+=${PHOTO_ONLY_HOLD_S}`)
					.to(layer, { opacity: 0, duration: FADE_S, ease: "power2.inOut" }, "<");
			});
		},
		{ scope: ref, dependencies: [photoLayers.join("|"), mode, hasVideo] },
	);

	return (
		<div ref={ref} className="absolute inset-0 overflow-hidden" aria-hidden="true">
			{/* VÍDEO base — siempre montado si existe; se pausa en modo "foto". */}
			{hasVideo && (
				<video
					ref={videoRef}
					key={videoUrl as string}
					src={videoUrl as string}
					autoPlay
					loop
					muted
					playsInline
					className="absolute inset-0 w-full h-full object-cover"
				/>
			)}

			{/* Capa(s) de foto por encima del vídeo. */}
			{photoLayers.map((url) => (
				<div
					key={url}
					className="venue-photo absolute inset-0 will-change-transform"
					style={{
						backgroundImage: `url("${url}")`,
						backgroundSize: "cover",
						backgroundPosition: "center",
						// "photo" → visible ya (estática).  Carrusel → GSAP la revela.
						opacity: mode === "photo" ? 1 : 0,
					}}
				/>
			))}

			{/* Capa oscura para legibilidad del leaderboard / batalla / QR. */}
			<div className="absolute inset-0 bg-black/65" />
		</div>
	);
}
