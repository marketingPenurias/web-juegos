import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
	Check,
	ChevronRight,
	Coins,
	Heart,
	Music2,
	Sparkles,
	Trophy,
} from "lucide-react";
import { useGameState, type Screen } from "../../store/useGameState";
import { cn } from "../../lib/utils";

/**
 * MissionsCard — versión REAL (piloto Bronce).
 *
 *   Cada misión es una pista visual de actividad servidor-truth:
 *     · "Tira la Ruleta"        ← daily_activity.ruleta_spin
 *     · "Swipea en Tinder"      ← daily_activity.tinder_swipe
 *     · "Vota en directo"       ← daily_activity.vote_track
 *
 *   `reward` viene de `rewardRules` (tabla `tenant_token_rewards`)
 *   con fallback razonable si el rule no está cargado todavía.
 *   Cero números hardcoded en el componente.
 *
 *   Al tap, navega al juego correspondiente (`setScreen`).
 */

type MissionDef = {
	id: string;
	titleKey: string;
	screen: Screen;
	icon: typeof Heart;
	dailyKey:
		| "ruleta_spin"
		| "tinder_swipe"
		| "vote_track"
		| "tinder_completion"
		| "jukebox_boost";
	rewardCode: string;
	fallbackReward: number;
};

const MISSIONS: MissionDef[] = [
	{
		id: "ruleta",
		titleKey: "hub.missionRuleta",
		screen: "ruleta",
		icon: Sparkles,
		dailyKey: "ruleta_spin",
		rewardCode: "ruleta_spin",
		fallbackReward: 15,
	},
	{
		id: "tinder",
		titleKey: "hub.missionTinder",
		screen: "tinder",
		icon: Heart,
		dailyKey: "tinder_swipe",
		rewardCode: "tinder_completion",
		fallbackReward: 20,
	},
	{
		id: "live",
		titleKey: "hub.missionLive",
		screen: "live",
		icon: Music2,
		dailyKey: "vote_track",
		rewardCode: "livebattle_vote",
		fallbackReward: 0,
	},
];

export function MissionsCard() {
	const { t } = useTranslation();
	const dailyActivity = useGameState((s) => s.dailyActivity);
	const rewardRules = useGameState((s) => s.rewardRules);
	const setScreen = useGameState((s) => s.setScreen);

	const rows = useMemo(
		() =>
			MISSIONS.map((m) => {
				const rule = rewardRules.find((r) => r.event_code === m.rewardCode);
				const reward = rule ? rule.amount : m.fallbackReward;
				return {
					...m,
					reward,
					done: dailyActivity[m.dailyKey],
				};
			}),
		[dailyActivity, rewardRules],
	);

	const openCount = rows.filter((r) => !r.done).length;

	return (
		<section
			aria-label={t("hub.missions")}
			className="hub-card bg-zinc-900/60 backdrop-blur-md transform-gpu translate-z-0 rounded-3xl p-5 border border-zinc-800"
		>
			<div className="flex items-center justify-between mb-3 px-1">
				<div className="flex items-center gap-2">
					<Trophy className="w-4 h-4 text-amber-400" aria-hidden="true" />
					<h3 className="text-white font-bold text-[15px]">
						{t("hub.missions")}
					</h3>
				</div>
				<span className="text-xs text-zinc-500 font-bold uppercase tracking-wider tabular-nums">
					{t("hub.missionsCount", {
						open: openCount,
						total: rows.length,
					})}
				</span>
			</div>

			<div className="flex flex-col gap-3">
				{rows.map(({ id, titleKey, icon: Icon, done, reward, screen }) => (
					<button
						key={id}
						type="button"
						onClick={() => setScreen(screen)}
						className={cn(
							"text-left bg-zinc-950/60 border rounded-2xl p-4 flex items-center gap-3 active:scale-[0.99] transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400",
							done
								? "border-lime-500/40 shadow-[0_0_12px_rgba(57,255,20,0.18)]"
								: "border-zinc-800",
						)}
						aria-pressed={done}
					>
						<div
							className={cn(
								"w-10 h-10 rounded-xl border flex items-center justify-center shrink-0",
								done
									? "bg-lime-500/15 border-lime-500/50 text-lime-300"
									: "bg-amber-500/15 border-amber-500/30 text-amber-400",
							)}
							aria-hidden="true"
						>
							{done ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
						</div>
						<div className="flex-1 min-w-0">
							<p
								className={cn(
									"text-sm font-bold leading-tight",
									done ? "text-lime-200" : "text-white",
								)}
							>
								{t(titleKey)}
							</p>
							<p className="text-[11px] text-zinc-500 mt-0.5">
								{done
									? t("hub.missionDone")
									: t("hub.missionPending")}
							</p>
						</div>
						<div className="text-right shrink-0">
							{reward > 0 && (
								<p className="text-sm font-black text-amber-300 flex items-center gap-1 justify-end">
									<Coins className="w-3 h-3" aria-hidden="true" />+{reward}
								</p>
							)}
							<p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
								{t("hub.prize")}
							</p>
						</div>
						<ChevronRight
							className={cn(
								"w-4 h-4 shrink-0",
								done ? "text-lime-400/60" : "text-zinc-600",
							)}
							aria-hidden="true"
						/>
					</button>
				))}
			</div>
		</section>
	);
}
