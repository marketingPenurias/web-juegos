import { useTranslation } from "react-i18next";
import { Coins, Crown, Loader2 } from "lucide-react";
import { useLeaderboard } from "../../lib/useLeaderboard";
import { cn } from "../../lib/utils";

/**
 * LeaderboardCard — REAL (Operación Wiring).
 *
 *   Lee el top de jugadores por saldo de tokens desde `/api/leaderboard`
 *   (server-truth) vía `useLeaderboard`.  Resalta tu fila (`is_me`) y, si
 *   no estás en el top visible, muestra tu rango global al pie.
 */

const TONES = [
	"text-amber-300 border-amber-400/40 bg-amber-500/10",
	"text-zinc-300 border-zinc-400/40 bg-zinc-500/10",
	"text-orange-300 border-orange-400/40 bg-orange-500/10",
];

export function LeaderboardCard() {
	const { t } = useTranslation();
	const { rows, myRank, loading, error } = useLeaderboard(10);

	const meVisible = rows.some((r) => r.is_me);

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

			{loading && rows.length === 0 ? (
				<div className="flex items-center justify-center py-6 text-zinc-500">
					<Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
				</div>
			) : error && rows.length === 0 ? (
				<p className="text-center text-zinc-500 text-sm py-6">
					{t("hub.leaderboardEmpty", "Aún no hay ranking esta noche.")}
				</p>
			) : rows.length === 0 ? (
				<p className="text-center text-zinc-500 text-sm py-6">
					{t("hub.leaderboardEmpty", "Aún no hay ranking esta noche.")}
				</p>
			) : (
				<ol className="flex flex-col gap-2">
					{rows.map((row) => (
						<li
							key={row.rank}
							className={cn(
								"flex items-center gap-3 rounded-xl px-3 py-2.5 border",
								row.is_me
									? "bg-cyan-950/40 border-cyan-500/40"
									: "bg-zinc-950/60 border-zinc-900",
							)}
						>
							<span
								className={cn(
									"w-7 h-7 rounded-full border flex items-center justify-center text-xs font-black shrink-0",
									TONES[row.rank - 1] ??
										"text-zinc-400 border-zinc-700 bg-zinc-800/50",
								)}
							>
								{row.rank}
							</span>
							<div className="flex-1 min-w-0">
								<p
									className={cn(
										"text-sm font-bold truncate",
										row.is_me ? "text-cyan-200" : "text-white",
									)}
								>
									{row.is_me ? t("hub.leaderboardYou", "Tú") : row.name}
								</p>
							</div>
							<div className="flex items-center gap-1 text-cyan-300 font-black tabular-nums">
								<Coins className="w-3.5 h-3.5" aria-hidden="true" />
								<span className="text-sm">{row.tokens}</span>
							</div>
						</li>
					))}
				</ol>
			)}

			{!meVisible && myRank !== null && rows.length > 0 && (
				<p className="text-center text-[11px] text-zinc-500 font-bold mt-3">
					{t("hub.leaderboardYourRank", "Tu posición: #{{n}}", { n: myRank })}
				</p>
			)}
		</section>
	);
}
