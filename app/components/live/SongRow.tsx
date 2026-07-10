import { Check, Music2 } from "lucide-react";
import { cn } from "../../lib/utils";

type Color = "cyan" | "lime";

const PALETTE: Record<
	Color,
	{ text: string; bar: string; shadow: string; ring: string; chip: string }
> = {
	cyan: {
		text: "text-cyan-400 drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]",
		bar: "bg-linear-to-r from-cyan-600 via-cyan-500 to-cyan-400",
		shadow: "0 0 20px rgba(0,240,255,0.4)",
		ring: "ring-cyan-400/80 shadow-[0_0_25px_rgba(0,240,255,0.55)]",
		chip: "text-cyan-950",
	},
	lime: {
		text: "text-lime-400 drop-shadow-[0_0_8px_rgba(57,255,20,0.5)]",
		bar: "bg-linear-to-r from-lime-600 via-lime-500 to-lime-400",
		shadow: "0 0 20px rgba(57,255,20,0.4)",
		ring: "ring-lime-400/80 shadow-[0_0_25px_rgba(57,255,20,0.55)]",
		chip: "text-lime-950",
	},
};

type Props = {
	name: string;
	color: Color;
	percent: number;
	barRef: React.RefObject<HTMLDivElement | null>;
	pctRef: React.RefObject<HTMLSpanElement | null>;
	selected: boolean;
	confirmed: boolean;
	onSelect: () => void;
	disabled: boolean;
};

export function SongRow({
	name,
	color,
	percent,
	barRef,
	pctRef,
	selected,
	confirmed,
	onSelect,
	disabled,
}: Props) {
	const palette = PALETTE[color];

	return (
		<button
			type="button"
			onClick={onSelect}
			disabled={disabled}
			aria-pressed={selected}
			className={cn(
				// Borde SIEMPRE visible → la fila se lee como tarjeta pulsable
				// (antes parecía sólo una barra de progreso y nadie la tocaba).
				"relative w-full text-left rounded-2xl p-2 border-2 transition-all focus-visible:ring-2 focus-visible:ring-cyan-400",
				selected
					? `ring-2 ${palette.ring} border-transparent`
					: "border-zinc-700 bg-zinc-900/30 active:scale-[0.99]",
				disabled && !confirmed && "opacity-60",
			)}
		>
			<div className="flex justify-between items-end mb-2 px-1">
				<span className="font-bold text-lg text-white tracking-tight flex items-center gap-2">
					{name}
					{!selected && !disabled && (
						<span className={cn("text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-white/10", palette.text)}>
							Toca para votar
						</span>
					)}
				</span>
				<span
					ref={pctRef}
					className={cn("font-black text-2xl tabular-nums", palette.text)}
				>
					{percent}%
				</span>
			</div>

			<div className="h-14 w-full bg-zinc-900/60 rounded-2xl overflow-hidden border border-zinc-800/80 relative backdrop-blur-md transform-gpu translate-z-0 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]">
				<div
					ref={barRef}
					className={cn(
						"absolute top-0 left-0 h-full w-full flex items-center justify-end pr-4 will-change-transform",
						palette.bar,
					)}
					style={{
						transformOrigin: "left center",
						transform: `scaleX(${percent / 100})`,
						boxShadow: palette.shadow,
					}}
				>
					<Music2
						className={cn("w-5 h-5 opacity-60", palette.chip)}
						aria-hidden="true"
					/>
				</div>
			</div>

			{confirmed && (
				<div className="absolute -right-2 -top-2 w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(0,240,255,0.6)] border-2 border-black z-10">
					<Check
						className="w-4 h-4 text-black font-bold"
						aria-hidden="true"
					/>
				</div>
			)}
		</button>
	);
}
