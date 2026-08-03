import { useRef } from "react";
import { Crown, Music2, Sparkles, Trophy } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";
import type { Track } from "./types";

/** Celebración a pantalla completa del tema ganador de una batalla. */
export function WinnerOverlay({ track }: { track: Track }) {
	const ref = useRef<HTMLDivElement>(null);
	useGSAP(
		() => {
			const tl = gsap.timeline();
			tl.fromTo(".wo-bg", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" })
				.fromTo(".wo-crown", { scale: 0, rotate: -30, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.7, ease: "back.out(2.2)" }, "-=0.1")
				.fromTo(".wo-card", { scale: 0.7, opacity: 0, y: 40 }, { scale: 1, opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.6)" }, "-=0.4")
				.fromTo(".wo-label", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, "-=0.3");
			// Latido continuo de la corona mientras dura la celebración.
			gsap.to(".wo-crown", { scale: 1.12, duration: 0.9, yoyo: true, repeat: -1, ease: "sine.inOut", delay: 0.7 });
			// Destellos radiales.
			gsap.fromTo(".wo-ray", { scale: 0.4, opacity: 0.6 }, { scale: 2.4, opacity: 0, duration: 1.8, repeat: -1, ease: "power2.out", stagger: 0.3 });
		},
		{ scope: ref },
	);

	return (
		<div ref={ref} className="absolute inset-0 z-50 flex items-center justify-center">
			<div className="wo-bg absolute inset-0 bg-black/85 backdrop-blur-md" />
			<div className="absolute inset-0 pointer-events-none flex items-center justify-center">
				<div className="wo-ray absolute w-[60vw] h-[60vw] rounded-full bg-(--jumbo-accent)/20 blur-2xl" />
				<div className="wo-ray absolute w-[45vw] h-[45vw] rounded-full bg-(--jumbo-primary)/20 blur-2xl" />
			</div>

			<div className="relative z-10 flex flex-col items-center text-center gap-6 px-12">
				<Crown className="wo-crown w-28 h-28 text-(--jumbo-accent) drop-shadow-[0_0_40px_rgba(255,215,0,0.7)]" aria-hidden="true" />
				<p className="wo-label inline-flex items-center gap-3 text-(--jumbo-accent) font-black uppercase tracking-[0.4em] text-2xl">
					<Trophy className="w-8 h-8" aria-hidden="true" /> Ganadora de la batalla
				</p>
				<div className="wo-card flex flex-col items-center gap-5">
					<div
						className="w-72 h-72 rounded-[2rem] overflow-hidden bg-zinc-950 border-2 border-(--jumbo-accent)/70 flex items-center justify-center"
						style={{ boxShadow: "0 0 90px rgba(255,215,0,0.55)" }}
					>
						{track.cover_image_url ? (
							<img src={track.cover_image_url} alt="" className="w-full h-full object-cover" />
						) : (
							<Music2 className="w-28 h-28 text-(--jumbo-accent)" aria-hidden="true" />
						)}
					</div>
					<div className="min-w-0">
						<p className="text-6xl font-black italic tracking-tighter">{track.title}</p>
						<p className="text-3xl text-zinc-300 mt-2">{track.artist}</p>
					</div>
					<div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-(--jumbo-accent)/15 border border-(--jumbo-accent)/50">
						<Sparkles className="w-6 h-6 text-(--jumbo-accent)" aria-hidden="true" />
						<span className="text-2xl font-black tabular-nums text-(--jumbo-accent)">{track.total_votes}</span>
						<span className="text-sm uppercase tracking-widest text-(--jumbo-accent)/80 font-bold">votos</span>
					</div>
				</div>
			</div>
		</div>
	);
}
