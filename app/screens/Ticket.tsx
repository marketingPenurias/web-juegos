import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Ticket as TicketIcon,
	GlassWater,
	Gift,
	Coins,
	Loader2,
	RefreshCw,
	ChevronRight,
} from "lucide-react";
import { useGameState } from "../store/useGameState";
import { useRewards, type MyReward } from "../lib/useRewards";
import { cn } from "../lib/utils";
import { Toast } from "../components/Toast";

/**
 * Ticket — "Mis Tickets" (REAL · Operación Wiring).
 *
 *   Antes era un stub que redirigía al hub.  Ahora lista los rewards
 *   comprados por el usuario que siguen siendo canjeables
 *   (`user_rewards.status` ∈ available|redeeming) leídos de
 *   `GET /api/rewards`.  Al pulsar "Enseñar al camarero" arranca/retoma
 *   el canje real (`start_reward_redemption`) y abre la PANTALLA CAMARERO
 *   unificada (`RedemptionScreen` montada a nivel app vía
 *   `activeRedemption`).  Cero mock.
 */

export function Ticket() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);
	const openRedemption = useGameState((s) => s.openRedemption);
	const activeRedemption = useGameState((s) => s.activeRedemption);
	const { list, redeem, pending } = useRewards();

	const [rows, setRows] = useState<MyReward[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		const res = await list();
		if (res.ok) setRows(res.rows);
		else setError(res.error);
		setLoading(false);
	}, [list]);

	useEffect(() => {
		void reload();
	}, [reload]);

	// Al cerrarse la pantalla camarero (activeRedemption → null) refrescamos
	// la lista: un canje consumido sale de available/redeeming.
	useEffect(() => {
		if (activeRedemption === null) void reload();
	}, [activeRedemption, reload]);

	const show = async (reward: MyReward) => {
		if (busyId) return;
		const now = Date.now();
		// Redención ya en curso y todavía válida → reabrimos sin tocar la BD.
		if (
			reward.status === "redeeming" &&
			reward.expires_at &&
			new Date(reward.expires_at).getTime() > now
		) {
			openRedemption({
				rewardId: reward.id,
				productName: reward.product_name,
				priceEur: reward.price_eur,
				expiresAt: reward.expires_at,
			});
			return;
		}
		// available (o redeeming caducado) → arrancamos un canje fresco.
		setBusyId(reward.id);
		const res = await redeem(reward.id);
		setBusyId(null);
		if (!res.ok) {
			setToast(t("ticket.errRedeem", "No se pudo abrir el ticket"));
			void reload();
			return;
		}
		openRedemption({
			rewardId: reward.id,
			productName: reward.product_name,
			priceEur: reward.price_eur,
			expiresAt: res.expires_at,
		});
	};

	return (
		<div className="flex-1 flex flex-col relative z-20 min-h-0 overflow-hidden bg-black">
			<header className="px-6 pt-12 sm:pt-8 pb-3 flex items-center justify-between shrink-0">
				<div>
					<p className="text-[10px] uppercase tracking-[0.3em] text-cyan-400 font-bold flex items-center gap-1">
						<TicketIcon className="w-3 h-3" aria-hidden="true" />
						{t("ticket.barPass")}
					</p>
					<h1 className="text-2xl font-black italic tracking-tight text-white">
						{t("ticket.myTitle", "Mis Tickets")}
					</h1>
				</div>
				<button
					type="button"
					onClick={() => void reload()}
					aria-label={t("common.retry")}
					className={cn(
						"w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95",
						loading && "opacity-60",
					)}
				>
					<RefreshCw
						className={cn("w-4 h-4", loading && "animate-spin")}
						aria-hidden="true"
					/>
				</button>
			</header>

			<main className="flex-1 min-h-0 px-6 pb-6 overflow-y-auto no-scrollbar flex flex-col gap-3">
				{loading && rows.length === 0 && (
					<div className="flex items-center justify-center py-16 text-zinc-500">
						<Loader2 className="w-7 h-7 animate-spin" aria-hidden="true" />
					</div>
				)}

				{!loading && error && rows.length === 0 && (
					<div className="text-center py-12 flex flex-col gap-3 items-center">
						<p className="text-rose-300 text-sm">
							{t("ticket.errLoad", "No se pudieron cargar tus tickets")}
						</p>
						<button
							type="button"
							onClick={() => void reload()}
							className="h-10 px-4 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs font-black uppercase tracking-widest active:scale-95"
						>
							{t("common.retry")}
						</button>
					</div>
				)}

				{!loading && !error && rows.length === 0 && (
					<div className="flex flex-col items-center justify-center text-center gap-4 py-16">
						<div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
							<TicketIcon
								className="w-8 h-8 text-zinc-600"
								aria-hidden="true"
							/>
						</div>
						<div>
							<h2 className="text-lg font-black italic text-white">
								{t("ticket.noTicket")}
							</h2>
							<p className="text-zinc-500 text-sm mt-1 max-w-xs">
								{t("ticket.noTicketSub")}
							</p>
						</div>
						<button
							type="button"
							onClick={() => setScreen("menu")}
							className="h-12 px-6 rounded-2xl bg-linear-to-r from-cyan-500 to-blue-500 text-black font-black text-sm active:scale-95"
						>
							{t("ticket.goToMenu")}
						</button>
					</div>
				)}

				{rows.map((reward) => {
					const isFree = reward.price_eur === 0;
					return (
						<article
							key={reward.id}
							className={cn(
								"rounded-2xl p-4 flex items-center gap-3 border",
								isFree
									? "border-lime-500/50 bg-lime-500/5"
									: "border-zinc-800 bg-zinc-900/50",
							)}
						>
							<div
								className={cn(
									"w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 border",
									isFree
										? "bg-lime-500/10 border-lime-500/40"
										: "bg-zinc-950 border-zinc-800",
								)}
								aria-hidden="true"
							>
								{isFree ? "🎁" : "🍸"}
							</div>
							<div className="flex-1 min-w-0">
								<p className="text-sm font-black text-white truncate">
									{reward.product_name}
								</p>
								<div className="flex items-center gap-2 mt-1">
									<span className="inline-flex items-center gap-1 text-cyan-300 font-black text-[11px] tabular-nums">
										<Coins className="w-3 h-3" aria-hidden="true" />
										{reward.price_tokens}
									</span>
									{!isFree && (
										<span className="text-amber-300 font-black text-[11px] tabular-nums">
											€{reward.price_eur.toFixed(2)}
										</span>
									)}
									{reward.status === "redeeming" && (
										<span className="text-[9px] uppercase tracking-widest font-black px-1.5 py-0.5 rounded-full border text-amber-300 border-amber-500/40 bg-amber-500/10">
											{t("redemption.redeeming")}
										</span>
									)}
								</div>
							</div>
							<button
								type="button"
								onClick={() => void show(reward)}
								disabled={busyId === reward.id || pending}
								className={cn(
									"shrink-0 inline-flex items-center gap-1 h-10 px-4 rounded-xl font-black text-xs active:scale-95",
									isFree
										? "bg-lime-400 text-black"
										: "bg-cyan-500 text-black",
									(busyId === reward.id || pending) &&
										"opacity-60 cursor-wait",
								)}
							>
								{busyId === reward.id ? (
									<Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
								) : (
									<>
										<Gift className="w-4 h-4" aria-hidden="true" />
										{t("ticket.show", "Enseñar")}
										<ChevronRight className="w-3 h-3" aria-hidden="true" />
									</>
								)}
							</button>
						</article>
					);
				})}

				{rows.length > 0 && (
					<button
						type="button"
						onClick={() => setScreen("menu")}
						className="mt-2 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-200 font-black text-[12px] uppercase tracking-widest active:scale-95 inline-flex items-center justify-center gap-2"
					>
						<GlassWater className="w-4 h-4" aria-hidden="true" />
						{t("ticket.goToMenu")}
					</button>
				)}
			</main>

			<Toast message={toast} onDone={() => setToast(null)} tone="warning" />
		</div>
	);
}
