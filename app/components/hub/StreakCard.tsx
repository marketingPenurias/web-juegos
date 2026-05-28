import { useTranslation } from "react-i18next";
import { Flame } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * StreakCard — MVP del piloto.
 *
 *   No tenemos tabla `user_streaks` ni cron diario que mantenga la
 *   racha; hasta Fase 2 esto vive como "Día 1 de piloto" — fijo y
 *   honesto.  El multiplicador visual (1ª llama activa, resto
 *   apagadas) sirve de pista de "lo que viene" sin inventar números.
 *
 *   Sin datos de usuarios falsos.  Cuando el cron mensual aterrice,
 *   sustituiremos `currentDay`, `targetDays` y `multiplier` por
 *   campos del bundle de `/api/session`.
 */

const TOTAL_STEPS = 4;
const CURRENT_DAY = 1;

export function StreakCard() {
	const { t } = useTranslation();

	return (
		<section
			aria-label={t("hub.loyalty")}
			className="hub-card bg-zinc-900/60 backdrop-blur-md transform-gpu translate-z-0 rounded-3xl p-5 border border-zinc-800"
		>
			<div className="flex justify-between items-center mb-4">
				<h3 className="text-white font-bold text-[15px]">
					{t("hub.loyalty")}
				</h3>
				<span className="text-orange-400 text-xs font-black uppercase tracking-widest bg-orange-950/50 px-2 py-0.5 rounded-full border border-orange-500/20">
					{t("hub.pilotDay", "Día {{n}} de piloto", { n: CURRENT_DAY })}
				</span>
			</div>

			<div className="flex justify-between items-center px-2 relative">
				<div className="absolute top-1/2 -translate-y-1/2 left-6 right-6 h-1 bg-zinc-800 rounded-full z-0 overflow-hidden">
					<div
						className="h-full bg-linear-to-r from-orange-600 to-orange-400"
						style={{
							width: `${(CURRENT_DAY / TOTAL_STEPS) * 100}%`,
						}}
					/>
				</div>

				{Array.from({ length: TOTAL_STEPS }, (_, i) => {
					const step = i + 1;
					const active = step <= CURRENT_DAY;
					return (
						<div
							key={step}
							className={cn(
								"relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 shadow-lg transition-colors will-change-transform",
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

			<p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold text-center mt-3">
				{t(
					"hub.streakHint",
					"Vuelve cada noche para sumar a tu racha",
				)}
			</p>
		</section>
	);
}
