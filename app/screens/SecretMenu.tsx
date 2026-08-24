import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Coins, GlassWater, Gift, Lock, Clock, Zap } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { useTenant } from "../lib/tenant";
import { useCatalog, type CatalogProduct } from "../lib/useCatalog";
import { useRewards } from "../lib/useRewards";
import { TokenBadge } from "../components/TokenBadge";
import { Toast } from "../components/Toast";
import { cn } from "../lib/utils";

/**
 * SecretMenu — el menú de promociones, ya resuelto por el servidor.
 *
 *   Los tokens compran DESCUENTO, no producto: una copa de 9 € se queda en
 *   6 € y lo que cuesta en tokens es ese descuento multiplicado por la tasa
 *   del nivel.  Por eso la tarjeta enseña las dos cifras — el precio de barra
 *   tachado y el que va a pagar — en vez de un precio en tokens a secas: el
 *   valor está en el ahorro, y sin verlo la promoción no se entiende.
 *
 *   Esta pantalla NO decide nada de eso.  `/api/catalog` devuelve por producto
 *   su estado (`available` / `not_now` / `locked_tier`), su coste para este
 *   usuario y la pista de qué le falta.  El cliente solo pinta: si duplicara
 *   las reglas de nivel, día, franja horaria, vigencia o stock, acabarían
 *   contradiciendo a la BD en cuanto la sala cambiara un horario.
 *
 *   Flujo de compra:
 *     1. tap → `useRewards.purchase()` (POST /api/rewards)
 *     2. OK  → `useRewards.redeem()` (start_reward_redemption)
 *     3. OK  → `openRedemption(...)` abre la pantalla del camarero.
 *
 *   Defense in depth: `purchase_reward` revalida en el servidor contra la
 *   misma regla que se le enseñó al usuario.
 */

function eur(value: number | null | undefined): string {
	// Los precios del local no llevan decimales (9 €, no 9,00 €).
	return `${Number(value ?? 0).toFixed(0)}€`;
}

export function SecretMenu() {
	const { t } = useTranslation();
	const tenant = useTenant();
	const tokens = useGameState((s) => s.tokens);
	const setBalance = useGameState((s) => s.setBalance);
	const openRedemption = useGameState((s) => s.openRedemption);
	const setScreen = useGameState((s) => s.setScreen);
	const redeemTutorialSeen = useGameState((s) => s.redeemTutorialSeen);
	const markRedeemTutorialSeen = useGameState((s) => s.markRedeemTutorialSeen);

	const { catalog, products, loading, error, reload } = useCatalog();
	const { purchase, redeem, pending } = useRewards();

	const [toast, setToast] = useState<string | null>(null);
	const [tone, setTone] = useState<"default" | "warning" | "success">(
		"default",
	);
	const [purchasing, setPurchasing] = useState<string | null>(null);
	// Gate del tutorial anti-fraude de primer canje.
	const [pendingProduct, setPendingProduct] = useState<CatalogProduct | null>(
		null,
	);

	const containerRef = useRef<HTMLDivElement>(null);

	const groups = useMemo(() => {
		const available: CatalogProduct[] = [];
		const notNow: CatalogProduct[] = [];
		const lockedTier: CatalogProduct[] = [];
		for (const p of products) {
			if (p.status === "available") available.push(p);
			else if (p.status === "not_now") notNow.push(p);
			else lockedTier.push(p);
		}
		// Las campañas van primero: son las que caducan.
		available.sort((a, b) => {
			const ca = a.kind === "base" ? 1 : 0;
			const cb = b.kind === "base" ? 1 : 0;
			return ca - cb || a.cost_tokens - b.cost_tokens;
		});
		return { available, notNow, lockedTier };
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

	// Gate: la PRIMERA vez que el usuario pulsa canjear mostramos el tutorial
	// anti-fraude antes de tocar el ledger.
	const handleBuy = (product: CatalogProduct) => {
		if (purchasing) return;
		if (!redeemTutorialSeen) {
			setPendingProduct(product);
			return;
		}
		void doPurchase(product);
	};

	const confirmTutorial = () => {
		markRedeemTutorialSeen();
		const product = pendingProduct;
		setPendingProduct(null);
		if (product) void doPurchase(product);
	};

	const doPurchase = async (product: CatalogProduct) => {
		if (purchasing) return;
		if (tokens < product.cost_tokens) {
			setTone("warning");
			setToast(
				t("menu.toastMissingTokens", {
					n: product.cost_tokens - tokens,
				}),
			);
			return;
		}

		setPurchasing(product.product_id);
		const result = await purchase(product.product_id);
		if (!result.ok) {
			setTone("warning");
			setToast(
				result.detail
					? `${result.error}: ${result.detail}`
					: translateError(result.error),
			);
			setPurchasing(null);
			return;
		}

		if (typeof result.balance === "number") {
			setBalance(result.balance);
		}

		// Encadenamos start_reward_redemption para abrir la pantalla del
		// camarero sin pasos manuales — el usuario quiere consumir YA.
		const redeemResult = await redeem(result.reward_id);
		if (!redeemResult.ok) {
			// La compra está hecha y queda como "available" en user_rewards:
			// el usuario puede reintentar el canje desde el historial.
			setTone("warning");
			setToast(
				redeemResult.detail
					? `${redeemResult.error}: ${redeemResult.detail}`
					: translateError(redeemResult.error),
			);
			setPurchasing(null);
			return;
		}

		setTone("success");
		setToast(t("menu.toastTicket"));
		openRedemption({
			rewardId: result.reward_id,
			productName: product.name,
			// Lo que tiene que pagar en barra, no el precio de carta.
			priceEur: Number(product.promo_price_eur ?? 0),
			expiresAt: redeemResult.expires_at,
		});
		setPurchasing(null);
		// Un canje puede agotar el stock de una campaña o consumir el último
		// canje de la noche: hay que releer para no ofrecer lo que ya no está.
		void reload();
	};

	const translateError = (code: string): string => {
		switch (code) {
			case "insufficient_funds":
				return t("menu.errInsufficient");
			case "product_unavailable":
				return t("menu.errUnavailable");
			case "promo_sold_out":
				return t("menu.errSoldOut");
			case "night_limit_reached":
				return t("menu.errNightLimit");
			case "week_limit_reached":
				return t("menu.errWeekLimit");
			case "profile_not_found":
				return t("menu.errProfileMissing");
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
				{/* Cuántos canjes le quedan: evita la frustración de elegir una
				    promoción y que el servidor la rechace al final del flujo. */}
				{catalog.redemptions_left !== null ? (
					<p className="text-zinc-400 text-sm font-medium">
						{catalog.redemptions_left > 0
							? t("menu.redemptionsLeft", {
									count: catalog.redemptions_left,
								})
							: t(
									"menu.noRedemptionsLeft",
									"Ya has usado tus canjes de esta noche",
								)}
					</p>
				) : (
					<p className="text-zinc-400 text-sm font-medium">
						{t("menu.premiumNoQueue")}
					</p>
				)}
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

				{groups.available.length > 0 && (
					<section className="flex flex-col gap-3">
						<h2 className="text-[10px] uppercase tracking-[0.3em] text-lime-400 font-black px-1">
							{t("menu.availableNow")}
						</h2>
						{groups.available.map((p) => (
							<ProductCard
								key={p.product_id}
								product={p}
								nextTierName={catalog.next_tier}
								affordable={tokens >= p.cost_tokens}
								busy={purchasing === p.product_id || pending}
								onBuy={() => void handleBuy(p)}
							/>
						))}
					</section>
				)}

				{groups.notNow.length > 0 && (
					<section className="flex flex-col gap-3 mt-4">
						<h2 className="text-[10px] uppercase tracking-[0.3em] text-cyan-300 font-black px-1">
							{t("menu.notNow")}
						</h2>
						{groups.notNow.map((p) => (
							<UnavailableCard key={p.product_id} product={p} variant="time" />
						))}
					</section>
				)}

				{groups.lockedTier.length > 0 && (
					<section className="flex flex-col gap-3 mt-4">
						<h2 className="text-[10px] uppercase tracking-[0.3em] text-amber-300 font-black px-1">
							{t("menu.unlockSoon")}
						</h2>
						{groups.lockedTier.map((p) => (
							<UnavailableCard key={p.product_id} product={p} variant="tier" />
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

			{pendingProduct && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-100 bg-black/85 backdrop-blur-md transform-gpu translate-z-0 flex items-center justify-center px-8"
				>
					<div className="w-full max-w-[340px] rounded-4xl bg-linear-to-br from-zinc-900 to-zinc-950 border border-amber-400/50 p-7 text-center shadow-[0_0_60px_rgba(245,158,11,0.35)]">
						<div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-400/50 mx-auto flex items-center justify-center mb-4 text-3xl">
							⚠️
						</div>
						<h2 className="text-xl font-black italic tracking-tight text-white mb-2">
							{t("menu.burnTutorialTitle", "¡Ojo con el ticket!")}
						</h2>
						<p className="text-sm text-zinc-300 mb-1">
							{t(
								"menu.burnTutorialBody",
								"No quemes el ticket hasta que estés DELANTE del camarero.",
							)}
						</p>
						<p className="text-[11px] text-zinc-500 mb-6">
							{t(
								"menu.burnTutorialHint",
								"Una vez consumido, el premio se gasta. Enséñalo en barra y manténlo pulsado allí.",
							)}
						</p>
						<button
							type="button"
							onClick={confirmTutorial}
							className="w-full h-12 rounded-2xl bg-linear-to-r from-amber-300 via-amber-500 to-amber-600 text-black font-black tracking-tight active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-amber-300 mb-2"
						>
							{t("menu.burnTutorialOk", "Entendido, canjear")}
						</button>
						<button
							type="button"
							onClick={() => setPendingProduct(null)}
							className="w-full h-10 rounded-2xl bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold text-sm active:scale-95"
						>
							{t("common.cancel", "Aún no")}
						</button>
					</div>
				</div>
			)}

			<Toast message={toast} onDone={() => setToast(null)} tone={tone} />
		</div>
	);
}

/**
 * Precio en euros: barra tachada + lo que pagará.  Es el argumento de venta
 * entero, así que se muestra igual en las tarjetas bloqueadas — que vea lo
 * que se está perdiendo.
 */
function PriceTag({
	product,
	dim = false,
}: {
	product: CatalogProduct;
	dim?: boolean;
}) {
	if (product.redemption_type === "free_product") return null;
	return (
		<span className="inline-flex items-baseline gap-1.5">
			<span
				className={cn(
					"text-[11px] line-through tabular-nums",
					dim ? "text-zinc-600" : "text-zinc-500",
				)}
			>
				{eur(product.list_price_eur)}
			</span>
			<span
				className={cn(
					"font-black text-[13px] tabular-nums",
					dim ? "text-zinc-400" : "text-amber-300",
				)}
			>
				{eur(product.promo_price_eur)}
			</span>
		</span>
	);
}

function ProductCard({
	product,
	nextTierName,
	affordable,
	busy,
	onBuy,
}: {
	product: CatalogProduct;
	nextTierName: string | null;
	affordable: boolean;
	busy: boolean;
	onBuy: () => void;
}) {
	const { t } = useTranslation();
	const isFree = product.redemption_type === "free_product";
	const isCampaign = product.kind !== "base";

	return (
		<article
			className={cn(
				"sm-card relative bg-zinc-900/50 backdrop-blur-md transform-gpu translate-z-0 rounded-2xl p-4 flex flex-col gap-3 border",
				isCampaign
					? "border-fuchsia-500/60 shadow-[0_0_25px_rgba(217,70,239,0.22)]"
					: isFree
						? "border-lime-500/50 shadow-[0_0_25px_rgba(57,255,20,0.18)]"
						: "border-zinc-800",
			)}
		>
			{isCampaign && (
				<span className="absolute -top-2 left-3 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full bg-fuchsia-400 text-black shadow-[0_0_12px_rgba(217,70,239,0.6)] inline-flex items-center gap-1">
					<Zap className="w-2.5 h-2.5" aria-hidden="true" />
					{product.label ?? t("menu.flashDrop")}
				</span>
			)}
			{!isCampaign && isFree && (
				<span className="absolute -top-2 left-3 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full bg-lime-400 text-black shadow-[0_0_12px_rgba(57,255,20,0.6)] inline-flex items-center gap-1">
					<Gift className="w-2.5 h-2.5" aria-hidden="true" />
					{t("menu.freeTag")}
				</span>
			)}

			<div className="flex items-start gap-3">
				<div
					className={cn(
						"w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0 border",
						isCampaign
							? "bg-fuchsia-500/10 border-fuchsia-500/40"
							: isFree
								? "bg-lime-500/10 border-lime-500/40"
								: "bg-zinc-950 border-zinc-800",
					)}
					aria-hidden="true"
				>
					{isCampaign ? "⚡" : isFree ? "🎁" : "🍸"}
				</div>
				<div className="flex-1 min-w-0">
					<h3 className="text-base font-black italic tracking-tight text-white leading-tight">
						{product.name}
					</h3>
					<div className="flex flex-wrap items-center gap-2 mt-1.5">
						<div className="inline-flex items-center gap-1 bg-cyan-950/50 px-2 py-0.5 rounded-full border border-cyan-900/50">
							<Coins className="w-3 h-3 text-cyan-400" aria-hidden="true" />
							<span className="text-cyan-300 font-black text-[11px] tabular-nums">
								{product.cost_tokens}
							</span>
						</div>
						<PriceTag product={product} />
					</div>
					{/* La ambición: lo que le costaría si subiera de nivel. */}
					{product.cost_at_next_tier !== null &&
						product.cost_at_next_tier < product.cost_tokens &&
						nextTierName && (
							<p className="text-[10px] text-zinc-500 mt-1">
								{t("menu.cheaperAtNextTier", {
									tier: nextTierName,
									n: product.cost_at_next_tier,
								})}
							</p>
						)}
				</div>
			</div>

			<button
				type="button"
				onClick={onBuy}
				disabled={busy}
				className={cn(
					"w-full h-11 rounded-xl font-black text-[12px] uppercase tracking-widest active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-300",
					isCampaign
						? "bg-linear-to-r from-fuchsia-400 to-purple-500 text-black shadow-[0_0_20px_rgba(217,70,239,0.4)]"
						: isFree
							? "bg-linear-to-r from-lime-400 to-emerald-500 text-black shadow-[0_0_20px_rgba(57,255,20,0.4)]"
							: "bg-cyan-500 text-black",
					busy && "opacity-60 cursor-wait",
					!affordable && !busy && "opacity-60",
				)}
			>
				{busy
					? t("menu.processing")
					: !affordable
						? t("menu.missingTokens")
						: isFree
							? t("menu.activate")
							: t("menu.canjear")}
			</button>
		</article>
	);
}

/**
 * Tarjeta de lo que no puede pedir.  `unlock_hint` lo redacta el servidor
 * ("Hoy de 22:00 a 00:00", "Desde Plata"), que es quien conoce la
 * configuración de la sala: aquí solo se elige el color y el icono.
 */
function UnavailableCard({
	product,
	variant,
}: {
	product: CatalogProduct;
	variant: "time" | "tier";
}) {
	const { t } = useTranslation();
	const isTime = variant === "time";
	const Icon = isTime ? Clock : Lock;

	return (
		<article
			className={cn(
				"sm-card relative rounded-2xl p-4 flex gap-3 items-center border opacity-90 bg-zinc-900/30",
				isTime ? "border-cyan-900/50" : "border-zinc-800",
			)}
			aria-disabled="true"
		>
			<div
				className={cn(
					"w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0 border",
					isTime
						? "bg-cyan-950/30 border-cyan-800/40"
						: "bg-zinc-950 border-zinc-800",
				)}
				aria-hidden="true"
			>
				{isTime ? "🕘" : "🔒"}
			</div>
			<div className="flex-1 min-w-0 pr-16">
				<div className="flex items-center gap-2">
					<h3 className="text-sm font-bold text-zinc-300 leading-tight line-clamp-2">
						{product.name}
					</h3>
					<Icon
						className="w-3.5 h-3.5 text-zinc-500 shrink-0"
						aria-hidden="true"
					/>
				</div>
				{product.unlock_hint && (
					<p
						className={cn(
							"text-[11px] mt-0.5",
							isTime ? "text-cyan-300/80" : "text-amber-300/80",
						)}
					>
						{product.unlock_hint}
					</p>
				)}
				<div className="flex flex-wrap items-center gap-2 mt-1.5">
					<div className="inline-flex items-center gap-1 bg-zinc-950 px-2 py-0.5 rounded-full border border-zinc-800">
						<Coins className="w-3 h-3 text-zinc-500" aria-hidden="true" />
						<span className="text-zinc-400 font-black text-[11px] tabular-nums">
							{product.cost_tokens}
						</span>
					</div>
					<PriceTag product={product} dim />
				</div>
			</div>
			<span
				className={cn(
					"absolute top-2 right-2 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider border backdrop-blur-sm",
					isTime
						? "text-cyan-300 border-cyan-500/40 bg-cyan-950/70"
						: "text-amber-300 border-amber-500/40 bg-amber-950/70",
				)}
			>
				{isTime
					? t("menu.comeBackLater")
					: t("menu.lockedTag")}
			</span>
		</article>
	);
}
