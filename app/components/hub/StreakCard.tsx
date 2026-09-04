import { useTranslation } from "react-i18next";
import { Flame } from "lucide-react";
import { cn } from "../../lib/utils";
import { useGameState } from "../../store/useGameState";

/**
 * StreakCard — cuántas noches seguidas ha venido.
 *
 *   Durante el piloto esto decía "Día 1 de piloto" con el número escrito a
 *   fuego, porque no había dato de racha que enseñar.  Ya lo hay: llega en
 *   el bundle de `/api/session`.  Seguía puesto a 1 y se notaba — el DJ lo
 *   vio la noche del 3 de septiembre y avisó.
 *
 *   Las llamas van hasta cuatro.  Quien lleve más de cuatro noches las ve
 *   todas encendidas y el número exacto arriba: la barra es un ánimo, no un
 *   marcador.
 */

const TOTAL_STEPS = 4;

export function StreakCard() {
	const { t } = useTranslation();
	const streak = useGameState((s) => s.streak) ?? 0;

	// La barra y las llamas se llenan hasta cuatro; el número de arriba no.
	const pasos = Math.min(Math.max(streak, 0), TOTAL_STEPS);

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
					{streak > 0
						? t("hub.streakNights", "{{n}} noches seguidas", { n: streak })
						: t("hub.streakFirst", "Tu primera noche")}
				</span>
			</div>

			<div className="flex justify-between items-center px-2 relative">
				<div className="absolute top-1/2 -translate-y-1/2 left-6 right-6 h-1 bg-zinc-800 rounded-full z-0 overflow-hidden">
					<div
						className="h-full bg-linear-to-r from-orange-600 to-orange-400"
						style={{
							width: `${(pasos / TOTAL_STEPS) * 100}%`,
						}}
					/>
				</div>

				{Array.from({ length: TOTAL_STEPS }, (_, i) => {
					const step = i + 1;
					const active = step <= pasos;
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
