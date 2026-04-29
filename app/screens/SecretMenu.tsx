import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Zap, ChevronRight, Coins } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { TokenBadge } from "../components/TokenBadge";
import { Toast } from "../components/Toast";
import { cn } from "../lib/utils";

const COCKTAILS = [
	{
		id: "jager",
		name: "Jäger VIP Bomb",
		desc: "El clásico que nunca falla. Directo a tu mesa.",
		image:
			"https://images.unsplash.com/photo-1584526663341-2274881c5d7e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxqYWdlciUyMGJvbWIlMjBzaG90fGVufDF8fHx8MTc3NzQwNTg0N3ww&ixlib=rb-4.1.0&q=80&w=1080",
		tokens: 150,
		euros: 6.5,
		sponsored: true,
	},
	{
		id: "neon",
		name: "Neon Margarita",
		desc: "Brilla en la oscuridad. Sabor a lima eléctrica.",
		image:
			"https://images.unsplash.com/photo-1713539042291-6530b8395758?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxuZW9uJTIwY29ja3RhaWx8ZW58MXx8fHwxNzc3NDA1ODUwfDA&ixlib=rb-4.1.0&q=80&w=1080",
		tokens: 200,
		euros: 8.0,
	},
	{
		id: "blue",
		name: "Blue Thunder",
		desc: "Vodka, blue curaçao y pura energía.",
		image:
			"https://images.unsplash.com/photo-1645268911066-9f2d1344106b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxuZW9uJTIwY29ja3RhaWwlMjBjbHVifGVufDF8fHx8MTc3NzQwNTg0N3ww&ixlib=rb-4.1.0&q=80&w=1080",
		tokens: 220,
		euros: 9.5,
	},
];

export function SecretMenu() {
	const { t } = useTranslation();
	const tokens = useGameState((s) => s.tokens);
	const spendTokens = useGameState((s) => s.spendTokens);
	const createTicket = useGameState((s) => s.createTicket);
	const setScreen = useGameState((s) => s.setScreen);
	const [toast, setToast] = useState<string | null>(null);
	const [tone, setTone] = useState<"default" | "warning" | "success">(
		"default",
	);
	const containerRef = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			gsap.from(".cocktail-card", {
				x: -24,
				opacity: 0,
				duration: 0.5,
				stagger: 0.1,
				ease: "power3.out",
			});
			gsap.from(".sticky-cta", {
				y: 60,
				opacity: 0,
				duration: 0.5,
				delay: 0.3,
				ease: "back.out(1.7)",
			});
		},
		{ scope: containerRef },
	);

	const handleOrder = (id: string) => {
		const item = COCKTAILS.find((c) => c.id === id);
		if (!item) return;
		const ok = spendTokens(item.tokens);
		if (!ok) {
			setTone("warning");
			setToast(t("menu.toastMissingTokens", { n: item.tokens - tokens }));
			return;
		}
		createTicket(item.name, item.tokens);
		setTone("success");
		setToast(t("menu.toastTicket"));
		window.setTimeout(() => setScreen("ticket"), 800);
	};

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col relative z-20 h-full overflow-hidden pb-4"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-4 flex flex-col gap-1">
				<div className="flex items-center justify-between mb-2">
					<div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-500/30 w-fit">
						<Lock
							className="w-3.5 h-3.5 text-cyan-400"
							aria-hidden="true"
						/>
						<span className="text-[10px] font-black tracking-widest text-cyan-300 uppercase">
							{t("menu.onlyLevel4")}
						</span>
					</div>
					<TokenBadge />
				</div>
				<h1 className="text-3xl font-black italic tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">
					{t("menu.secretMenu")}
				</h1>
				<p className="text-zinc-400 text-sm font-medium">
					{t("menu.premiumNoQueue")}
				</p>
			</header>

			<main className="flex-1 px-6 overflow-y-auto no-scrollbar flex flex-col gap-4 pb-28">
				{COCKTAILS.map((item) => (
					<article
						key={item.id}
						className={cn(
							"cocktail-card relative bg-zinc-900/40 backdrop-blur-md rounded-2xl p-3 flex gap-4 items-center group border",
							item.sponsored
								? "border-cyan-400/60 shadow-[0_0_30px_rgba(0,240,255,0.25)]"
								: "border-zinc-800",
						)}
					>
						{item.sponsored && (
							<span className="absolute -top-2 left-4 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest rounded-full bg-cyan-400 text-black z-10 shadow-[0_0_15px_rgba(0,240,255,0.55)]">
								{t("menu.sponsored")}
							</span>
						)}
						<div className="w-20 h-20 rounded-xl overflow-hidden relative shrink-0 border border-zinc-800">
							<img
								src={item.image}
								alt={item.name}
								className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
							/>
							<div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent" />
						</div>

						<div className="flex-1 flex flex-col justify-center">
							<h3 className="text-white font-bold text-[15px] leading-tight mb-1">
								{item.name}
							</h3>
							<p className="text-zinc-500 text-[11px] leading-snug line-clamp-2 mb-2">
								{item.desc}
							</p>

							<div className="flex items-center gap-3">
								<div className="flex items-center gap-1 bg-cyan-950/50 px-2 py-0.5 rounded-full border border-cyan-900/50">
									<Coins
										className="w-3 h-3 text-cyan-400"
										aria-hidden="true"
									/>
									<span className="text-cyan-300 font-bold text-[11px]">
										{item.tokens}
									</span>
								</div>
								<span className="font-bold text-[11px] text-zinc-400">
									€{item.euros.toFixed(2)}
								</span>
							</div>
						</div>

						<button
							type="button"
							onClick={() => handleOrder(item.id)}
							aria-label={t("menu.orderItem", { name: item.name })}
							className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 active:scale-95 group-hover:bg-cyan-500 group-hover:text-black transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400"
						>
							<ChevronRight className="w-4 h-4" aria-hidden="true" />
						</button>
					</article>
				))}
			</main>

			<div className="absolute bottom-4 left-6 right-6 sticky-cta">
				<button
					type="button"
					onClick={() => handleOrder("jager")}
					className="w-full h-[60px] rounded-2xl bg-linear-to-r from-cyan-500 to-blue-600 text-black font-black text-[15px] tracking-wide flex items-center justify-center gap-2 shadow-[0_10px_30px_rgba(0,240,255,0.3)] relative overflow-hidden focus-visible:ring-2 focus-visible:ring-cyan-300"
				>
					<Zap className="w-5 h-5 fill-black" aria-hidden="true" />
					<span className="relative z-10">{t("menu.fastTrack")}</span>
				</button>
			</div>

			<Toast message={toast} onDone={() => setToast(null)} tone={tone} />
		</div>
	);
}
