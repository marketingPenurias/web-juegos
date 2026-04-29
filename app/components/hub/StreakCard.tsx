import { useTranslation } from "react-i18next";
import { Flame } from "lucide-react";
import { useGameState } from "../../store/useGameState";
import { cn } from "../../lib/utils";

const STEPS = [1, 2, 3, 4];

export function StreakCard() {
	const { t } = useTranslation();
	const streak = useGameState((s) => s.streak);

	return (
		<section
			aria-label={t("hub.loyalty")}
			className="hub-card bg-zinc-900/60 backdrop-blur-md rounded-[24px] p-5 border border-zinc-800"
		>
			<div className="flex justify-between items-center mb-4">
				<h3 className="text-white font-bold text-[15px]">{t("hub.loyalty")}</h3>
				<span className="text-orange-400 text-xs font-black uppercase tracking-widest bg-orange-950/50 px-2 py-0.5 rounded-full border border-orange-500/20">
					{t("hub.weekendsRow", { count: streak })}
				</span>
			</div>

			<div className="flex justify-between items-center px-2 relative">
				<div className="absolute top-1/2 -translate-y-1/2 left-6 right-6 h-1 bg-zinc-800 rounded-full z-0 overflow-hidden">
					<div
						className="h-full bg-linear-to-r from-orange-600 to-orange-400"
						style={{ width: `${Math.min((streak / 4) * 100, 100)}%` }}
					/>
				</div>

				{STEPS.map((step) => {
					const active = step <= streak;
					return (
						<div
							key={step}
							className={cn(
								"hub-streak-flame relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 shadow-lg transition-colors",
								active
									? "bg-zinc-950 border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)]"
									: "bg-zinc-900 border-zinc-800",
							)}
						>
							<Flame
								className={cn(
									"w-5 h-5",
									active ? "text-orange-500 fill-orange-500" : "text-zinc-700",
								)}
								aria-hidden="true"
							/>
						</div>
					);
				})}
			</div>
		</section>
	);
}
