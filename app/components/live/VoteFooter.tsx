import { useTranslation } from "react-i18next";
import { Check, Zap } from "lucide-react";
import { cn } from "../../lib/utils";

export type VoteAction = "free" | "boost";

type Props = {
	disabled: boolean;
	hasSelection: boolean;
	tokens: number;
	boostCost: number;
	onConfirm: (action: VoteAction) => void;
};

export function VoteFooter({
	disabled,
	hasSelection,
	tokens,
	boostCost,
	onConfirm,
}: Props) {
	const { t } = useTranslation();
	const cannotBoost = disabled || !hasSelection || tokens < boostCost;
	const cannotConfirm = disabled || !hasSelection;

	return (
		<footer className="live-fade px-6 pb-3 pt-3 relative z-30 shrink-0 bg-zinc-950/95 backdrop-blur-md transform-gpu translate-z-0 border-t border-zinc-900/80">
			<div className="absolute inset-0 bg-linear-to-t from-black via-zinc-950/90 to-transparent -z-10 pointer-events-none" />

			<p className="text-center text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">
				{disabled
					? t("live.alreadyVoted")
					: hasSelection
						? t("live.selectionReady")
						: t("live.tapToSelect")}
			</p>

			<div className="grid grid-cols-[1fr_1.4fr] gap-3">
				<button
					type="button"
					onClick={() => onConfirm("free")}
					disabled={cannotConfirm}
					className={cn(
						"h-14 rounded-2xl bg-[#0f0f12] border flex flex-col items-center justify-center gap-0.5 transition-colors relative overflow-hidden focus-visible:ring-2 focus-visible:ring-cyan-400",
						cannotConfirm
							? "border-zinc-800 opacity-50 cursor-not-allowed"
							: "border-cyan-400/60 active:bg-zinc-800",
					)}
				>
					<span className="text-base font-bold text-white tracking-wide flex items-center gap-1.5">
						<Check className="w-4 h-4" aria-hidden="true" />
						{t("live.confirmVote")}
					</span>
					<span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">
						{t("live.voteFreeSub")}
					</span>
				</button>

				<button
					type="button"
					onClick={() => onConfirm("boost")}
					disabled={cannotBoost}
					className={cn(
						"h-14 rounded-2xl bg-linear-to-br from-amber-300 via-amber-500 to-amber-700 flex flex-col items-center justify-center gap-0.5 relative overflow-hidden focus-visible:ring-2 focus-visible:ring-amber-300",
						cannotBoost
							? "opacity-60 cursor-not-allowed grayscale-[0.5]"
							: "shadow-[0_0_20px_rgba(245,158,11,0.5)] active:scale-95 transition-transform",
					)}
				>
					<div className="flex items-center gap-1.5 relative z-10">
						<Zap
							className="w-4 h-4 fill-black text-black drop-shadow-sm"
							aria-hidden="true"
						/>
						<span className="text-base font-black text-black tracking-tight drop-shadow-[0_1px_1px_rgba(255,255,255,0.4)]">
							{t("live.boostTitle")}
						</span>
					</div>
					<div className="flex items-center gap-1 bg-black/20 px-2 py-0.5 rounded-full relative z-10 backdrop-blur-sm transform-gpu translate-z-0 mt-0.5 border border-black/10">
						<span className="text-[10px] font-extrabold text-black/80 uppercase tracking-widest">
							{t("live.boostCost", { n: boostCost })}
						</span>
					</div>
					<div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/30 pointer-events-none" />
				</button>
			</div>
		</footer>
	);
}
