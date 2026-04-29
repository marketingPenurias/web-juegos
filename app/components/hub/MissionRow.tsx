import { useTranslation } from "react-i18next";
import { Coins, Heart, Music2, Share2, Trophy } from "lucide-react";
import type { Mission } from "../../store/useGameState";

const ICONS = {
	swipe: Heart,
	music: Music2,
	trophy: Trophy,
	share: Share2,
} as const;

export function MissionRow({ mission }: { mission: Mission }) {
	const { t } = useTranslation();
	const ratio = Math.min(mission.progress / mission.goal, 1);
	const Icon = ICONS[mission.icon] ?? Share2;

	return (
		<div className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 flex items-center gap-3">
			<div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
				<Icon className="w-5 h-5" aria-hidden="true" />
			</div>
			<div className="flex-1 min-w-0">
				<p className="text-sm font-bold text-white leading-tight">
					{t(mission.titleKey)}
				</p>
				<div className="flex items-center gap-2 mt-2">
					<div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
						<div
							className="h-full bg-linear-to-r from-amber-500 to-amber-300 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.5)]"
							style={{ width: `${ratio * 100}%` }}
						/>
					</div>
					<span className="text-[11px] font-black text-zinc-400 tabular-nums">
						{mission.progress}/{mission.goal}
					</span>
				</div>
			</div>
			<div className="text-right shrink-0">
				<p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
					{t("hub.prize")}
				</p>
				<p className="text-sm font-black text-amber-300 flex items-center gap-1 justify-end">
					<Coins className="w-3 h-3" aria-hidden="true" />+{mission.reward}
				</p>
			</div>
		</div>
	);
}
