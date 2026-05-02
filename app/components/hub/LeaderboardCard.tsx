import { useTranslation } from "react-i18next";
import { Coins, Crown } from "lucide-react";
import { useGameState } from "../../store/useGameState";
import { cn } from "../../lib/utils";

const TONES = [
	"text-amber-300 border-amber-400/40 bg-amber-500/10",
	"text-zinc-300 border-zinc-400/40 bg-zinc-500/10",
	"text-orange-300 border-orange-400/40 bg-orange-500/10",
];

export function LeaderboardCard() {
	const { t } = useTranslation();
	const rows = useGameState((s) => s.leaderboard);

	return (
		<section
			aria-label={t("hub.leaderboard")}
			className="hub-card bg-zinc-900/60 backdrop-blur-md transform-gpu translate-z-0 rounded-[24px] p-5 border border-zinc-800"
		>
			<div className="flex items-center justify-between mb-3">
				<div className="flex items-center gap-2">
					<Crown className="w-4 h-4 text-amber-400" aria-hidden="true" />
					<h3 className="text-white font-bold text-[15px]">
						{t("hub.leaderboard")}
					</h3>
				</div>
				<span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
					{t("hub.thisWeek")}
				</span>
			</div>

			<ol className="flex flex-col gap-2">
				{rows.map((row, i) => (
					<li
						key={row.id}
						className="flex items-center gap-3 bg-zinc-950/60 rounded-xl px-3 py-2.5 border border-zinc-900"
					>
						<span
							className={cn(
								"w-7 h-7 rounded-full border flex items-center justify-center text-xs font-black shrink-0",
								TONES[i],
							)}
						>
							{i + 1}
						</span>
						<span className="text-2xl shrink-0" aria-hidden="true">
							{row.avatar}
						</span>
						<div className="flex-1 min-w-0">
							<p className="text-sm font-bold text-white truncate">
								{row.name}
							</p>
						</div>
						<div className="flex items-center gap-1 text-cyan-300 font-black tabular-nums">
							<Coins className="w-3.5 h-3.5" aria-hidden="true" />
							<span className="text-sm">{row.tokens}</span>
						</div>
					</li>
				))}
			</ol>
		</section>
	);
}
