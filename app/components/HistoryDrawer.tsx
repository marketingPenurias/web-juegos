import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Coins, X } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { cn } from "../lib/utils";

type Props = { open: boolean; onClose: () => void };

export function HistoryDrawer({ open, onClose }: Props) {
	const { t, i18n } = useTranslation();
	const transactions = useGameState((s) => s.transactions);
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

	if (!open) return null;

	const fmt = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "es", {
		hour: "2-digit",
		minute: "2-digit",
		day: "2-digit",
		month: "short",
	});

	return (
		<div
			ref={overlayRef}
			className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end justify-center"
			onClick={onClose}
			role="presentation"
		>
			<div
				ref={sheetRef}
				role="dialog"
				aria-modal="true"
				aria-label={t("history.title")}
				className="w-full max-w-md bg-zinc-950 border-t border-zinc-800 rounded-t-[28px] p-5 max-h-[75dvh] flex flex-col shadow-[0_-20px_60px_rgba(0,0,0,0.7)]"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="w-12 h-1.5 bg-zinc-700 rounded-full mx-auto mb-4" />

				<div className="flex items-center justify-between mb-4">
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

				{transactions.length === 0 ? (
					<p className="py-12 text-center text-zinc-500 text-sm">
						{t("history.empty")}
					</p>
				) : (
					<ul className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-2 pr-1">
						{transactions.map((tx) => {
							const positive = tx.delta >= 0;
							return (
								<li
									key={tx.id}
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
												{t(tx.labelKey)}
											</p>
											<p className="text-[11px] text-zinc-500">
												{fmt.format(new Date(tx.createdAt))}
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
										{tx.delta}
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
