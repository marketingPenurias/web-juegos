import { useRef } from "react";
import { Disc3 } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";
import type { Track } from "./types";

/** Mitad derecha del split view: la canción que suena ahora mismo. */
export function NowPlayingPanel({ track }: { track: Track | null }) {
	const ref = useRef<HTMLElement>(null);
	// Animación de entrada + latido sutil cada vez que cambia la canción.
	useGSAP(
		() => {
			if (!track) return;
			gsap.fromTo(
				".np-card",
				{ opacity: 0, scale: 0.94, y: 16 },
				{ opacity: 1, scale: 1, y: 0, duration: 0.6, ease: "back.out(1.4)" },
			);
		},
		{ scope: ref, dependencies: [track?.id] },
	);

	return (
		<aside
			ref={ref}
			className="flex-1 min-w-0 flex flex-col items-center justify-center gap-6 rounded-3xl border border-(--jumbo-primary)/40 bg-black/40 backdrop-blur-md p-8 text-center"
		>
			<div className="inline-flex items-center gap-2 text-(--jumbo-primary) font-black uppercase tracking-[0.35em] text-base">
				<span className="w-2.5 h-2.5 rounded-full bg-(--jumbo-primary) animate-pulse" />
				Sonando ahora
			</div>

			{track ? (
				<div className="np-card flex flex-col items-center gap-6 w-full">
					<div
						className="w-[22rem] h-[22rem] max-w-[38vw] max-h-[38vw] rounded-[2rem] overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center"
						style={{ boxShadow: "0 0 70px var(--jumbo-primary)55" }}
					>
						{track.cover_image_url ? (
							<img src={track.cover_image_url} alt="" className="w-full h-full object-cover" />
						) : (
							<Disc3 className="w-32 h-32 text-(--jumbo-primary) animate-spin [animation-duration:4s]" aria-hidden="true" />
						)}
					</div>
					<div className="min-w-0 w-full">
						<p className="text-5xl font-black italic tracking-tighter truncate">{track.title}</p>
						<p className="text-2xl text-zinc-400 truncate mt-1">{track.artist}</p>
					</div>
				</div>
			) : (
				<div className="np-card flex flex-col items-center gap-5 opacity-70">
					<div className="w-[18rem] h-[18rem] max-w-[32vw] max-h-[32vw] rounded-[2rem] bg-zinc-950/60 border border-zinc-800 flex items-center justify-center">
						<Disc3 className="w-24 h-24 text-zinc-700" aria-hidden="true" />
					</div>
					<p className="text-2xl font-black italic tracking-tight text-zinc-500">
						El DJ aún no ha puesto ninguna canción
					</p>
				</div>
			)}
		</aside>
	);
}

// ── Overlay de celebración del GANADOR de la batalla (ambas TVs · V17) ─
