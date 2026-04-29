import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import { useGameState } from "../../store/useGameState";
import { MissionRow } from "./MissionRow";

export function MissionsCard() {
	const { t } = useTranslation();
	const missions = useGameState((s) => s.missions);

	return (
		<section aria-label={t("hub.missions")} className="hub-card">
			<div className="flex items-center justify-between mb-3 px-1">
				<div className="flex items-center gap-2">
					<Trophy className="w-4 h-4 text-amber-400" aria-hidden="true" />
					<h3 className="text-white font-bold text-[15px]">
						{t("hub.missions")}
					</h3>
				</div>
				<span className="text-xs text-zinc-500 font-bold uppercase tracking-wider">
					{t("hub.missionsCount", { open: missions.length })}
				</span>
			</div>

			<div className="flex flex-col gap-3">
				{missions.map((m) => (
					<MissionRow key={m.id} mission={m} />
				))}
			</div>
		</section>
	);
}
