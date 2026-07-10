import { useTranslation } from "react-i18next";
import {
	ChevronRight,
	Dices,
	Disc3,
	Heart,
	Music2,
	type LucideIcon,
} from "lucide-react";
import { useGameState, type Screen } from "../../store/useGameState";
import { cn } from "../../lib/utils";

type Game = {
	id: Screen;
	titleKey: string;
	subtitleKey: string;
	Icon: LucideIcon;
	gradient: string;
	ring: string;
};

// Orden de aparición (V17): el Jukebox es el juego estrella → primero,
// seguido del Tinder Musical.  Luego la Batalla en directo y la Ruleta.
const GAMES: Game[] = [
	{
		id: "jukebox",
		titleKey: "hub.gameJukeboxTitle",
		subtitleKey: "hub.gameJukeboxSub",
		Icon: Disc3,
		gradient: "from-amber-500/30 to-orange-700/20",
		ring: "ring-amber-400/40",
	},
	{
		id: "tinder",
		titleKey: "hub.gameTinderTitle",
		subtitleKey: "hub.gameTinderSub",
		Icon: Heart,
		gradient: "from-pink-600/30 to-rose-700/20",
		ring: "ring-pink-500/40",
	},
	{
		id: "live",
		titleKey: "hub.gameLiveTitle",
		subtitleKey: "hub.gameLiveSub",
		Icon: Music2,
		gradient: "from-cyan-600/30 to-blue-700/20",
		ring: "ring-cyan-500/40",
	},
	{
		id: "ruleta",
		titleKey: "hub.gameRuletaTitle",
		subtitleKey: "hub.gameRuletaSub",
		Icon: Dices,
		gradient: "from-lime-600/30 to-emerald-700/20",
		ring: "ring-lime-500/40",
	},
];

export function GameLauncherCard() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);

	return (
		<section aria-label={t("hub.gamesInRoom")} className="hub-card">
			<div className="flex items-center justify-between mb-3 px-1">
				<h3 className="text-white font-bold text-[15px]">
					{t("hub.gamesInRoom")}
				</h3>
				<span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
					{t("hub.liveNow")}
				</span>
			</div>

			<div className="flex gap-3 overflow-x-auto no-scrollbar -mx-6 px-6 pb-2 snap-x snap-mandatory scroll-pl-6">
				{GAMES.map(({ id, titleKey, subtitleKey, Icon, gradient, ring }) => (
					<button
						type="button"
						key={id}
						onClick={() => setScreen(id)}
						className={cn(
							"shrink-0 w-[60%] snap-start text-left rounded-[20px] p-4 border border-zinc-800 bg-linear-to-br relative overflow-hidden active:scale-[0.98] transition-transform ring-1 focus-visible:ring-2 focus-visible:ring-cyan-400",
							gradient,
							ring,
						)}
					>
						<div className="absolute -top-6 -right-6 w-24 h-24 bg-white/5 rounded-full blur-2xl pointer-events-none" />
						<Icon
							className="w-7 h-7 text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.45)]"
							aria-hidden="true"
						/>
						<p className="mt-3 text-base font-black text-white leading-tight">
							{t(titleKey)}
						</p>
						<p className="text-[11px] text-zinc-300 mt-0.5">{t(subtitleKey)}</p>
						<div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-white/80">
							{t("hub.play")}{" "}
							<ChevronRight className="w-3 h-3" aria-hidden="true" />
						</div>
					</button>
				))}
			</div>
		</section>
	);
}
