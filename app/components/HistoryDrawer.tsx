import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Coins, X } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useHistory, type LedgerEntry } from "../lib/useHistory";
import { cn } from "../lib/utils";

type Props = { open: boolean; onClose: () => void };

/**
 * HistoryDrawer — consume `/api/history` en tiempo real.
 *
 *   El fetch sólo se dispara cuando el drawer está abierto (gate por
 *   `active` en `useHistory`) para no gastar un round-trip por
 *   sesión si el usuario no lo abre.  Cada apertura refresca, así
 *   que tras una compra/canje no hace falta invalidar manualmente.
 */

const REASON_LABEL_KEYS: Record<string, string> = {
	ruleta_spin: "history.tx_ruleta",
	tinder_completion: "history.tx_tinder",
	"history.tx_tinder": "history.tx_tinder",
	vote_boost: "history.tx_boost_song",
	vote_free: "history.tx_vote_free",
	jukebox_boost: "history.tx_jukebox_boost",
	reward_purchase: "history.tx_order",
	signup_bonus: "history.tx_signup",
};

function entryLabel(entry: LedgerEntry, t: (key: string) => string): string {
	if (entry.product_name_at_time) return entry.product_name_at_time;
	const key = REASON_LABEL_KEYS[entry.reason];
	if (key) return t(key);
	return entry.reason;
}

export function HistoryDrawer({ open, onClose }: Props) {
	const { t, i18n } = useTranslation();
	const { rows, loading, error, reload } = useHistory(open);
	const overlayRef = useRef<HTMLDivElement>(null);
	const sheetRef = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			if (!open) return;
			gsap.fromTo(
				overlayRef.current,
				{ opacity: 0 },
				{ opacity: 1, duration: 0.25, ease: "power2.out" },
			);
			gsap.fromTo(
				sheetRef.current,
				{ yPercent: 100 },
				{ yPercent: 0, duration: 0.4, ease: "power3.out" },
			);
		},
		{ dependencies: [open] },
	);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	const fmt = useMemo(
		() =>
			new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "es", {
				hour: "2-digit",
				minute: "2-digit",
				day: "2-digit",
				month: "short",
			}),
		[i18n.resolvedLanguage],
	);

	if (!open) return null;

	return (
		<div
			ref={overlayRef}
			className="fixed inset-0 z-90 bg-black/60 backdrop-blur-sm transform-gpu translate-z-0 flex items-end justify-center"
			onClick={onClose}
			role="presentation"
		>
			<div
				ref={sheetRef}
				role="dialog"
				aria-modal="true"
				aria-label={t("history.title")}
				className="w-full max-w-md bg-zinc-950 border-t border-zinc-800 rounded-t-[28px] pt-3 px-5 pb-5 h-[75dvh] flex flex-col min-h-0 shadow-[0_-20px_60px_rgba(0,0,0,0.7)]"
				onClick={(e) => e.stopPropagation()}
				onTouchMove={(e) => e.stopPropagation()}
			>
				<div className="w-12 h-1.5 bg-zinc-700 rounded-full mx-auto mb-3 shrink-0" />

				<div className="flex items-center justify-between mb-4 shrink-0">
					<h2 className="text-xl font-black italic tracking-tight text-white">
						{t("history.title")}
					</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label={t("common.close")}
						className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
					>
						<X className="w-4 h-4" aria-hidden="true" />
					</button>
				</div>

				{loading && rows.length === 0 && (
					<p className="py-12 text-center text-zinc-500 text-sm">
						{t("history.loading", "Cargando…")}
					</p>
				)}

				{error && rows.length === 0 && !loading && (
					<div className="py-12 text-center flex flex-col items-center gap-3">
						<p className="text-rose-300 text-sm">
							{t("history.errLoad", "No se pudo cargar el historial")}
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
					<p className="py-12 text-center text-zinc-500 text-sm">
						{t("history.empty")}
					</p>
				)}

				{rows.length > 0 && (
					<ul
						className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-2 pr-1 pb-2"
						style={{
							WebkitOverflowScrolling: "touch",
							overscrollBehavior: "contain",
						}}
					>
						{rows.map((entry) => {
							const positive = entry.amount >= 0;
							return (
								<li
									key={entry.id}
									className="flex items-center justify-between gap-3 bg-zinc-900/60 border border-zinc-800 rounded-2xl px-4 py-3"
								>
									<div className="flex items-center gap-3 min-w-0">
										<div
											className={cn(
												"w-9 h-9 rounded-xl border flex items-center justify-center shrink-0",
												positive
													? "bg-lime-500/10 border-lime-500/40 text-lime-300"
													: "bg-rose-500/10 border-rose-500/40 text-rose-300",
											)}
										>
											<Coins className="w-4 h-4" aria-hidden="true" />
										</div>
										<div className="min-w-0">
											<p className="text-sm font-bold text-white truncate">
												{entryLabel(entry, t)}
											</p>
											<p className="text-[11px] text-zinc-500">
												{fmt.format(new Date(entry.created_at))}
											</p>
										</div>
									</div>
									<span
										className={cn(
											"text-sm font-black tabular-nums",
											positive ? "text-lime-300" : "text-rose-300",
										)}
									>
										{positive ? "+" : ""}
										{entry.amount}
									</span>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}
