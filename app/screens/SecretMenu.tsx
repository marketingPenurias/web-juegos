import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	BadgePercent,
	Coins,
	GlassWater,
	Gift,
	Lock,
	Sparkles,
	Crown,
} from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { useTenant } from "../lib/tenant";
import { useCatalog, type CatalogProduct } from "../lib/useCatalog";
import { useRewards } from "../lib/useRewards";
import { TIERS, type TierCode } from "../lib/tier";
import { TokenBadge } from "../components/TokenBadge";
import { Toast } from "../components/Toast";
import { cn } from "../lib/utils";

/**
 * SecretMenu — Catálogo real consumido de `tenant_products`.
 *
 *   Piloto MVP (decisión CTO): la UI asume Bronce.  Cualquier producto
 *   con `min_tier_required` definido se renderiza como "Próximamente",
 *   sin disparar el flujo de compra.  La lógica de bloqueos profunda
 *   (día, límites, balance) vive en Fase 2.
 *
 *   Flujo de compra real:
 *     1. usuario tap → `useRewards.purchase()` (POST /api/rewards)
 *     2. al OK → `useRewards.redeem()` (start_reward_redemption)
 *     3. al OK → `openRedemption({ rewardId, productName, priceEur,
 *        expiresAt })` mostrando la PANTALLA CAMARERO unificada.
 *
 *   Defense in depth: aunque el cliente nunca debería disparar la
 *   compra de un producto bloqueado, la RPC `purchase_reward`
 *   re-valida tier + día + límite + balance server-side.
 */

const DAY_LABELS: Record<number, string> = {
	1: "Lun",
	2: "Mar",
	3: "Mié",
	4: "Jue",
	5: "Vie",
	6: "Sáb",
	7: "Dom",
};

function formatDays(days: number[] | null): string | null {
	if (!days || days.length === 0) return null;
	return days
		.slice()
		.sort((a, b) => a - b)
		.map((d) => DAY_LABELS[d] ?? "?")
		.join(" · ");
}

function tierIcon(code: TierCode | null) {
	if (!code) return Sparkles;
	if (code === "platino") return Crown;
	return Lock;
}

export function SecretMenu() {
	const { t } = useTranslation();
	const tenant = useTenant();
	const tokens = useGameState((s) => s.tokens);
	const setBalance = useGameState((s) => s.setBalance);
	const openRedemption = useGameState((s) => s.openRedemption);
	const setScreen = useGameState((s) => s.setScreen);

	const { products, loading, error, reload } = useCatalog();
	const { purchase, redeem, pending } = useRewards();

	const [toast, setToast] = useState<string | null>(null);
	const [tone, setTone] = useState<"default" | "warning" | "success">(
		"default",
	);
	const [purchasing, setPurchasing] = useState<string | null>(null);

	const containerRef = useRef<HTMLDivElement>(null);

	const groups = useMemo(() => {
		const unlocked: CatalogProduct[] = [];
		const locked: CatalogProduct[] = [];
		for (const p of products) {
			if (p.min_tier_required && p.min_tier_required !== "bronce") {
				locked.push(p);
			} else {
				unlocked.push(p);
			}
		}
		return { unlocked, locked };
	}, [products]);

	useGSAP(
		() => {
			gsap.from(".sm-card", {
				y: 18,
				opacity: 0,
				stagger: 0.05,
				duration: 0.45,
				ease: "power3.out",
			});
		},
		{ scope: containerRef, dependencies: [products.length] },
	);

	const handleBuy = async (product: CatalogProduct) => {
		if (purchasing) return;
		if (tokens < product.price_tokens) {
			setTone("warning");
			setToast(
				t("menu.toastMissingTokens", {
					n: product.price_tokens - tokens,
				}),
			);
			return;
		}

		setPurchasing(product.id);
		const result = await purchase(product.id);
		if (!result.ok) {
			setTone("warning");
			setToast(translateError(result.error));
			setPurchasing(null);
			return;
		}

		// Actualiza balance espejo en cliente (servidor es la fuente).
		if (typeof result.balance === "number") {
			setBalance(result.balance);
		}

		// Encadenamos start_reward_redemption para abrir la pantalla del
		// camarero sin pasos manuales — el usuario quiere consumir YA.
		const redeemResult = await redeem(result.reward_id);
		if (!redeemResult.ok) {
			// La compra está hecha y queda como "available" en user_rewards.
			// El usuario puede reintentar el canje desde el historial.
			setTone("warning");
			setToast(translateError(redeemResult.error));
			setPurchasing(null);
			return;
		}

		setTone("success");
		setToast(t("menu.toastTicket"));
		openRedemption({
			rewardId: result.reward_id,
			productName: product.name,
			priceEur: Number(product.reference_fiat ?? 0),
			expiresAt: redeemResult.expires_at,
		});
		setPurchasing(null);
	};

	const translateError = (code: string): string => {
		switch (code) {
			case "insufficient_funds":
				return t("menu.errInsufficient");
			case "product_unavailable":
				return t("menu.errUnavailable");
			case "product_wrong_day":
				return t("menu.errWrongDay", "Este producto no está disponible hoy");
			case "tier_required":
				return t(
					"menu.errTierRequired",
					"Necesitas subir de nivel para canjear esto",
				);
			case "night_limit_reached":
				return t(
					"menu.errNightLimit",
					"Ya canjeaste este producto esta noche",
				);
			case "week_limit_reached":
				return t(
					"menu.errWeekLimit",
					"Has alcanzado el límite semanal de este producto",
				);
			case "month_limit_reached":
				return t(
					"menu.errMonthLimit",
					"Has alcanzado el límite mensual de este producto",
				);
			case "profile_not_found":
				return t(
					"menu.errProfileMissing",
					"No encontramos tu perfil. Recarga la app y reintenta.",
				);
			case "reward_unavailable":
				return t("menu.errRewardUnavailable");
			case "unauthorized":
				return t("menu.errUnauth");
			case "network_error":
				return t("menu.errNetwork");
			default:
				return t("menu.errGeneric");
		}
	};

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col relative z-20 min-h-0 overflow-hidden bg-black"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-3 flex flex-col gap-2 shrink-0">
				<div className="flex items-center justify-between">
					<div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-500/30 w-fit">
						<GlassWater
							className="w-3.5 h-3.5 text-cyan-400"
							aria-hidden="true"
						/>
						<span className="text-[10px] font-black tracking-widest text-cyan-300 uppercase">
							{tenant.name} · {t("menu.realCatalog")}
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

			<main className="flex-1 min-h-0 px-6 pt-4 pb-32 overflow-y-auto no-scrollbar flex flex-col gap-4">
				{loading && products.length === 0 && (
					<p className="text-center text-zinc-500 text-sm py-8">
						{t("menu.loading")}
					</p>
				)}
				{error && products.length === 0 && (
					<div className="text-center py-8 flex flex-col gap-3 items-center">
						<p className="text-rose-300 text-sm">{t("menu.errLoad")}</p>
						<button
							type="button"
							onClick={() => void reload()}
							className="h-10 px-4 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs font-black uppercase tracking-widest active:scale-95"
						>
							{t("menu.retry")}
						</button>
					</div>
				)}

				{groups.unlocked.length > 0 && (
					<section className="flex flex-col gap-3">
						<h2 className="text-[10px] uppercase tracking-[0.3em] text-lime-400 font-black px-1">
							{t("menu.availableNow")}
						</h2>
						{groups.unlocked.map((p) => (
							<ProductCard
								key={p.id}
								product={p}
								busy={purchasing === p.id || pending}
								onBuy={() => void handleBuy(p)}
							/>
						))}
					</section>
				)}

				{groups.locked.length > 0 && (
					<section className="flex flex-col gap-3 mt-4">
						<h2 className="text-[10px] uppercase tracking-[0.3em] text-amber-300 font-black px-1">
							{t("menu.unlockSoon")}
						</h2>
						{groups.locked.map((p) => (
							<LockedCard key={p.id} product={p} />
						))}
					</section>
				)}

				{!loading && products.length === 0 && !error && (
					<p className="text-center text-zinc-500 text-sm py-8">
						{t("menu.empty")}
					</p>
				)}
			</main>

			<div className="absolute bottom-4 left-6 right-6">
				<button
					type="button"
					onClick={() => setScreen("hub")}
					className="w-full h-[52px] rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-200 font-black text-[13px] tracking-widest uppercase active:scale-95 transition-transform"
				>
					{t("menu.backToHub")}
				</button>
			</div>

			<Toast message={toast} onDone={() => setToast(null)} tone={tone} />
		</div>
	);
}

function ProductCard({
	product,
	busy,
	onBuy,
}: {
	product: CatalogProduct;
	busy: boolean;
	onBuy: () => void;
}) {
	const { t } = useTranslation();
	const isFree = Number(product.reference_fiat ?? 0) === 0;
	const days = formatDays(product.available_days);

	return (
		<article
			className={cn(
				"sm-card relative bg-zinc-900/50 backdrop-blur-md transform-gpu translate-z-0 rounded-2xl p-4 flex flex-col gap-3 border",
				isFree
					? "border-lime-500/50 shadow-[0_0_25px_rgba(57,255,20,0.18)]"
					: "border-zinc-800",
			)}
		>
			{isFree && (
				<span className="absolute -top-2 left-3 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full bg-lime-400 text-black shadow-[0_0_12px_rgba(57,255,20,0.6)] inline-flex items-center gap-1">
					<Gift className="w-2.5 h-2.5" aria-hidden="true" />
					{t("menu.freeTag")}
				</span>
			)}

			<div className="flex items-start gap-3">
				<div
					className={cn(
						"w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0 border",
						isFree
							? "bg-lime-500/10 border-lime-500/40"
							: "bg-zinc-950 border-zinc-800",
					)}
					aria-hidden="true"
				>
					{isFree ? "🎁" : "🍸"}
				</div>
				<div className="flex-1 min-w-0">
					<h3 className="text-base font-black italic tracking-tight text-white leading-tight">
						{product.name}
					</h3>
					<div className="flex flex-wrap items-center gap-2 mt-1.5">
						<div className="inline-flex items-center gap-1 bg-cyan-950/50 px-2 py-0.5 rounded-full border border-cyan-900/50">
							<Coins className="w-3 h-3 text-cyan-400" aria-hidden="true" />
							<span className="text-cyan-300 font-black text-[11px] tabular-nums">
								{product.price_tokens}
							</span>
						</div>
						{!isFree && (
							<span className="font-black text-[11px] text-amber-300 tabular-nums">
								€{Number(product.reference_fiat ?? 0).toFixed(2)}
							</span>
						)}
						{days && (
							<span className="font-bold text-[10px] text-zinc-400 uppercase tracking-widest">
								{days}
							</span>
						)}
					</div>
				</div>
			</div>

			<button
				type="button"
				onClick={onBuy}
				disabled={busy}
				className={cn(
					"w-full h-11 rounded-xl font-black text-[12px] uppercase tracking-widest active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-300",
					isFree
						? "bg-linear-to-r from-lime-400 to-emerald-500 text-black shadow-[0_0_20px_rgba(57,255,20,0.4)]"
						: "bg-cyan-500 text-black",
					busy && "opacity-60 cursor-wait",
				)}
			>
				{busy
					? t("menu.processing")
					: isFree
						? t("menu.activate")
						: t("menu.canjear")}
			</button>
		</article>
	);
}

function LockedCard({ product }: { product: CatalogProduct }) {
	const { t } = useTranslation();
	const tier = (product.min_tier_required ?? "plata") as TierCode;
	const meta = TIERS[tier];
	const Icon = tierIcon(tier);
	const isFree = Number(product.reference_fiat ?? 0) === 0;

	return (
		<article
			className="sm-card relative bg-zinc-900/30 rounded-2xl p-4 flex gap-3 items-center border border-zinc-800 opacity-90"
			aria-disabled="true"
		>
			<div
				className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0 border"
				style={{
					backgroundColor: `${meta.colorPrimary}1A`,
					borderColor: `${meta.colorPrimary}55`,
				}}
				aria-hidden="true"
			>
				{meta.emoji}
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<h3 className="text-sm font-bold text-zinc-300 truncate">
						{product.name}
					</h3>
					<Icon className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
				</div>
				<p className="text-[11px] text-zinc-500 mt-0.5">
					{t("menu.unlockAt", { tier: meta.displayName })}
				</p>
				<div className="flex flex-wrap items-center gap-2 mt-1.5">
					<div className="inline-flex items-center gap-1 bg-zinc-950 px-2 py-0.5 rounded-full border border-zinc-800">
						<Coins className="w-3 h-3 text-zinc-500" aria-hidden="true" />
						<span className="text-zinc-400 font-black text-[11px] tabular-nums">
							{product.price_tokens}
						</span>
					</div>
					{!isFree && (
						<span className="font-bold text-[10px] text-zinc-500 tabular-nums">
							€{Number(product.reference_fiat ?? 0).toFixed(2)}
						</span>
					)}
				</div>
			</div>
			<span
				className="shrink-0 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border"
				style={{
					color: meta.colorPrimary,
					borderColor: `${meta.colorPrimary}66`,
					backgroundColor: `${meta.colorPrimary}14`,
				}}
			>
				<BadgePercent className="w-3 h-3 inline mr-1" aria-hidden="true" />
				{t("menu.comingSoon")}
			</span>
		</article>
	);
}
