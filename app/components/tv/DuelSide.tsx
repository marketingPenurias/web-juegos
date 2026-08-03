import { Music2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Track } from "./types";

/** Un bando del duelo: portada, título y barra que crece hacia el centro. */
export function DuelSide({ track, pct, side, origin, barRef, leading }: {
	track: Track; pct: number; side: "a" | "b"; origin: "left" | "right"; barRef: React.RefObject<HTMLDivElement | null>; leading: boolean;
}) {
	const color = side === "a" ? "var(--jumbo-primary)" : "var(--jumbo-accent)";
	return (
		<div className={cn("jb-duel-enter rounded-3xl border p-6 flex flex-col items-center text-center gap-4", leading ? "border-(--jumbo-accent)/70 bg-(--jumbo-accent)/5" : "border-zinc-800 bg-zinc-900/40")}>
			<div className="w-40 h-40 rounded-3xl overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center" style={{ boxShadow: `0 0 50px ${color}55` }}>
				{track.cover_image_url ? <img src={track.cover_image_url} alt="" className="w-full h-full object-cover" /> : <Music2 className="w-16 h-16 text-zinc-700" aria-hidden="true" />}
			</div>
			<div className="min-w-0 w-full">
				<p className="text-3xl font-black italic tracking-tight truncate">{track.title}</p>
				<p className="text-base text-zinc-400 truncate">{track.artist}</p>
			</div>
			<div className="w-full">
				{/* La barra del bando B crece desde la DERECHA para que ambas
				    choquen en el centro (impacto visual de duelo). */}
				<div className="h-5 w-full rounded-full bg-zinc-800 overflow-hidden">
					<div
						ref={barRef}
						className={cn("h-full rounded-full", origin === "right" ? "origin-right" : "origin-left")}
						style={{ background: color, transform: "scaleX(0.5)" }}
					/>
				</div>
				<div className="flex items-center justify-between mt-2">
					<span className="text-5xl font-black tabular-nums" style={{ color }}>{pct}%</span>
					<span className="text-2xl font-black tabular-nums text-zinc-400">{track.total_votes} <span className="text-sm uppercase tracking-widest">votos</span></span>
				</div>
			</div>
		</div>
	);
}
