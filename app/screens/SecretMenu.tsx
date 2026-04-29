import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	BadgePercent,
	Coins,
	GlassWater,
	Lock,
	Shirt,
	Sparkles,
	Zap,
} from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { TokenBadge } from "../components/TokenBadge";
import { Toast } from "../components/Toast";
import { cn } from "../lib/utils";

type Category = "drinks" | "secret" | "merch";

type Item = {
	id: string;
	nameKey: string;
	descKey: string;
	emoji: string;
	tokens: number;
	euros: number;
	originalEuros?: number;
	discount?: number;
	category: Category;
	sponsored?: boolean;
	secret?: boolean;
};

const CATALOG: Item[] = [
	{
		id: "jager-monster",
		nameKey: "menu.items.jagerMonster.name",
		descKey: "menu.items.jagerMonster.desc",
		emoji: "🦌",
		tokens: 120,
		euros: 7,
		originalEuros: 9,
		discount: 22,
		category: "drinks",
		sponsored: true,
	},
	{
		id: "ron-cola",
		nameKey: "menu.items.ronCola.name",
		descKey: "menu.items.ronCola.desc",
		emoji: "🥃",
		tokens: 90,
		euros: 6,
		originalEuros: 7.5,
		discount: 20,
		category: "drinks",
	},
	{
		id: "ginebra-limon",
		nameKey: "menu.items.ginebraLimon.name",
		descKey: "menu.items.ginebraLimon.desc",
		emoji: "🍋",
		tokens: 110,
		euros: 7.5,
		category: "drinks",
	},
	{
		id: "cerveza-jarra",
		nameKey: "menu.items.cervezaJarra.name",
		descKey: "menu.items.cervezaJarra.desc",
		emoji: "🍺",
		tokens: 70,
		euros: 5,
		originalEuros: 6,
		discount: 17,
		category: "drinks",
	},
	{
		id: "neon-shot",
		nameKey: "menu.items.neonShot.name",
		descKey: "menu.items.neonShot.desc",
		emoji: "🧪",
		tokens: 50,
		euros: 3.5,
		category: "secret",
		secret: true,
	},
	{
		id: "carajillo-pocha",
		nameKey: "menu.items.carajillo.name",
		descKey: "menu.items.carajillo.desc",
		emoji: "☕",
		tokens: 60,
		euros: 4,
		category: "secret",
		secret: true,
	},
	{
		id: "merch-tee",
		nameKey: "menu.items.merchTee.name",
		descKey: "menu.items.merchTee.desc",
		emoji: "👕",
		tokens: 220,
		euros: 18,
		originalEuros: 22,
		discount: 18,
		category: "merch",
	},
	{
		id: "merch-cap",
		nameKey: "menu.items.merchCap.name",
		descKey: "menu.items.merchCap.desc",
		emoji: "🧢",
		tokens: 180,
		euros: 15,
		category: "merch",
	},
	{
		id: "merch-pulsera",
		nameKey: "menu.items.merchPulsera.name",
		descKey: "menu.items.merchPulsera.desc",
		emoji: "🪩",
		tokens: 60,
		euros: 4,
		category: "merch",
	},
];

const FILTERS: Array<{ id: "all" | Category; labelKey: string; Icon: typeof GlassWater }> = [
	{ id: "all", labelKey: "menu.filterAll", Icon: Sparkles },
	{ id: "drinks", labelKey: "menu.filterDrinks", Icon: GlassWater },
	{ id: "secret", labelKey: "menu.filterSecret", Icon: Lock },
	{ id: "merch", labelKey: "menu.filterMerch", Icon: Shirt },
];

export function SecretMenu() {
	const { t } = useTranslation();
	const tokens = useGameState((s) => s.tokens);
	const spendTokens = useGameState((s) => s.spendTokens);
	const createTicket = useGameState((s) => s.createTicket);
	const setScreen = useGameState((s) => s.setScreen);

	const [filter, setFilter] = useState<"all" | Category>("all");
	const [toast, setToast] = useState<string | null>(null);
	const [tone, setTone] = useState<"default" | "warning" | "success">("default");
	const containerRef = useRef<HTMLDivElement>(null);

	const items = useMemo(
		() => (filter === "all" ? CATALOG : CATALOG.filter((c) => c.category === filter)),
		[filter],
	);

	useGSAP(
		() => {
			gsap.from(".item-card", {
				x: -24,
				opacity: 0,
				duration: 0.45,
				stagger: 0.07,
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
		{ scope: containerRef, dependencies: [filter] },
	);

	const handleOrder = (id: string) => {
		const item = CATALOG.find((c) => c.id === id);
		if (!item) return;
		const ok = spendTokens(item.tokens, "history.tx_order");
		if (!ok) {
			setTone("warning");
			setToast(t("menu.toastMissingTokens", { n: item.tokens - tokens }));
			return;
		}
		createTicket(t(item.nameKey), item.tokens);
		setTone("success");
		setToast(t("menu.toastTicket"));
		window.setTimeout(() => setScreen("ticket"), 800);
	};

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col relative z-20 min-h-0 overflow-hidden bg-black"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-3 flex flex-col gap-2 shrink-0">
				<div className="flex items-center justify-between">
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

				<div className="flex gap-2 overflow-x-auto no-scrollbar -mx-6 px-6 pt-2">
					{FILTERS.map(({ id, labelKey, Icon }) => {
						const active = filter === id;
						return (
							<button
								key={id}
								type="button"
								onClick={() => setFilter(id)}
								aria-pressed={active}
								className={cn(
									"shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-black uppercase tracking-widest border transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400",
									active
										? "bg-cyan-500 text-black border-cyan-400 shadow-[0_0_15px_rgba(0,240,255,0.45)]"
										: "bg-zinc-900 text-zinc-400 border-zinc-800 active:scale-95",
								)}
							>
								<Icon className="w-3 h-3" aria-hidden="true" />
								{t(labelKey)}
							</button>
						);
					})}
				</div>
			</header>

			<main className="flex-1 min-h-0 px-6 pt-4 pb-32 overflow-y-auto no-scrollbar flex flex-col gap-4">
				{items.map((item) => (
					<MenuItemCard key={item.id} item={item} onOrder={() => handleOrder(item.id)} />
				))}
			</main>

			<div className="absolute bottom-4 left-6 right-6 sticky-cta">
				<button
					type="button"
					onClick={() => handleOrder("jager-monster")}
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

function MenuItemCard({ item, onOrder }: { item: Item; onOrder: () => void }) {
	const { t } = useTranslation();

	return (
		<article
			className={cn(
				"item-card relative bg-zinc-900/40 backdrop-blur-md rounded-2xl p-3 flex gap-3 items-center group border",
				item.sponsored
					? "border-cyan-400/60 shadow-[0_0_25px_rgba(0,240,255,0.25)]"
					: "border-zinc-800",
			)}
		>
			{item.sponsored && (
				<span className="absolute top-2 right-3 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full bg-cyan-400 text-black z-10 shadow-[0_0_12px_rgba(0,240,255,0.6)]">
					{t("menu.sponsored")}
				</span>
			)}
			{item.discount && (
				<span className="absolute -top-2 left-3 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full bg-lime-400 text-black z-10 shadow-[0_0_12px_rgba(57,255,20,0.55)] inline-flex items-center gap-0.5">
					<BadgePercent className="w-2.5 h-2.5" aria-hidden="true" />-{item.discount}%
				</span>
			)}

			<div
				className={cn(
					"w-16 h-16 rounded-xl flex items-center justify-center text-3xl shrink-0 border",
					item.secret
						? "bg-fuchsia-500/10 border-fuchsia-400/50"
						: "bg-zinc-950 border-zinc-800",
				)}
				aria-hidden="true"
			>
				{item.secret ? "🔒" : item.emoji}
			</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<h3 className="text-sm font-bold text-white truncate">
						{t(item.nameKey)}
					</h3>
					{item.secret && (
						<span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-fuchsia-500/15 border border-fuchsia-400/40 text-[9px] font-black text-fuchsia-300 uppercase tracking-widest shrink-0">
							{t("menu.secretTag")}
						</span>
					)}
				</div>
				<p className="text-zinc-500 text-[11px] leading-snug line-clamp-2 mb-1.5">
					{t(item.descKey)}
				</p>
				<div className="flex items-center gap-2">
					<div className="inline-flex items-center gap-1 bg-cyan-950/50 px-2 py-0.5 rounded-full border border-cyan-900/50">
						<Coins className="w-3 h-3 text-cyan-400" aria-hidden="true" />
						<span className="text-cyan-300 font-bold text-[11px] tabular-nums">
							{item.tokens}
						</span>
					</div>
					<span className="font-bold text-[11px] text-white tabular-nums">
						€{item.euros.toFixed(2)}
					</span>
					{item.originalEuros && (
						<span className="font-bold text-[10px] text-zinc-500 line-through tabular-nums">
							€{item.originalEuros.toFixed(2)}
						</span>
					)}
				</div>
			</div>

			<button
				type="button"
				onClick={onOrder}
				aria-label={t("menu.orderItem", { name: t(item.nameKey) })}
				className="h-9 px-3 rounded-full bg-cyan-500 text-black text-[11px] font-black uppercase tracking-widest active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-300 shrink-0"
			>
				{t("menu.orderShort")}
			</button>
		</article>
	);
}
