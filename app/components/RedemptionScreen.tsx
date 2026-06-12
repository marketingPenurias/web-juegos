import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flame, ShieldCheck, Timer, X, Gift } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { cn } from "../lib/utils";

/**
 * RedemptionScreen — PANTALLA CAMARERO (pilot critical UX).
 *
 *   Diseño optimizado para que un camarero de discoteca a 2 metros y
 *   con luces estroboscópicas lea SIN DUDA:
 *
 *     1. NOMBRE DEL PRODUCTO (text-5xl en mobile, text-7xl en pantalla
 *        grande, italic font-black, contraste blanco puro sobre fondo
 *        oscuro).
 *     2. PRECIO A COBRAR EN EUROS — text-8xl dorado neón cuando hay
 *        cargo, o "GRATIS" verde neón con icono regalo cuando es 0€.
 *     3. Código corto de 6 chars (verificación visual rápida contra el
 *        panel staff) + countdown 5min para evitar screenshots.
 *
 *   Anti-screenshot:
 *     - GSAP wave continuo (capturas salen estáticas).
 *     - Código alfanumérico parpadeando (yoyo opacidad).
 *     - Anillo cónico rotando lentamente.
 *
 *   Lifecycle:
 *     - Recibe `expiresAt` (ISO) de `start_reward_redemption` RPC.
 *     - Cuando llega a 0:00, dispara `onExpire()` — el padre limpia el
 *       state y cierra la pantalla.
 *     - 4Hz tick interval (cada 250ms) para suavizar el reloj sin
 *       bajar a 60Hz innecesariamente.
 */

type Props = {
	rewardId: string;
	productName: string;
	priceEur: number; // 0 = GRATIS
	expiresAt: string;
	onExpire: () => void;
	onClose?: () => void;
	// Consumo REAL del ticket (anti-fraude).  Se invoca al completar el
	// hold-to-burn y DEBE confirmar contra el backend
	// (`complete_redemption`).  Devuelve `true` SÓLO si el servidor marcó
	// el reward como 'consumed' (o ya lo estaba — idempotente).  La
	// animación de "QUEMADO" sólo se muestra cuando esto resuelve a true;
	// si es false (sin red / no canjeable) la barra se revierte y el
	// ticket NO se da por consumido.
	onBurn?: () => Promise<boolean>;
};

const SHORT_CODE_RE = /[^A-Z0-9]/g;

function shortCodeFor(uuid: string): string {
	const cleaned = uuid.toUpperCase().replace(SHORT_CODE_RE, "");
	return cleaned.slice(-6) || "------";
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

export function RedemptionScreen({
	rewardId,
	productName,
	priceEur,
	expiresAt,
	onExpire,
	onClose,
	onBurn,
}: Props) {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement>(null);
	const waveRef = useRef<HTMLDivElement>(null);
	const codeRef = useRef<HTMLDivElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const ringRef = useRef<HTMLDivElement>(null);
	const priceRef = useRef<HTMLDivElement>(null);
	const burnFillRef = useRef<HTMLDivElement>(null);
	const burnTweenRef = useRef<ReturnType<typeof gsap.to> | null>(null);

	const code = useMemo(() => shortCodeFor(rewardId), [rewardId]);
	const expiresAtMs = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
	const isFree = priceEur <= 0;

	const [remaining, setRemaining] = useState(() =>
		Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)),
	);
	const [burning, setBurning] = useState(false);
	const [burned, setBurned] = useState(false);
	const [verifying, setVerifying] = useState(false);
	const [burnError, setBurnError] = useState(false);

	// ── Hold-to-burn (anti-fraude) ──────────────────────────────────────
	// Mantener pulsado 2s rellena la barra GSAP.  Si suelta antes del 100%,
	// la barra vuelve a 0 INMEDIATAMENTE (reverse) y NO se consume.  Al
	// llegar al 100% NO damos el ticket por quemado todavía: confirmamos el
	// consumo contra el backend (`onBurn` → `complete_redemption`) y SÓLO
	// si el servidor responde ok mostramos "QUEMADO".  Cero fraude por
	// captura/refresco: el reward queda 'consumed' en la BD.
	const startBurn = () => {
		if (burned || verifying || remaining === 0 || !burnFillRef.current) return;
		setBurnError(false);
		setBurning(true);
		burnTweenRef.current = gsap.to(burnFillRef.current, {
			scaleX: 1,
			duration: 2,
			ease: "none",
			onComplete: () => {
				void finalizeBurn();
			},
		});
	};

	// Confirmación server-authoritative del consumo.
	const finalizeBurn = async () => {
		setBurning(false);
		setVerifying(true);
		let confirmed = false;
		try {
			// Sin handler de consumo no podemos garantizar el single-use →
			// jamás fingimos éxito (sería volver al "ticket teatro").
			confirmed = onBurn ? await onBurn() : false;
		} catch {
			confirmed = false;
		}
		setVerifying(false);
		if (confirmed) {
			setBurned(true);
			// Pequeño respiro para que se vea el estado "QUEMADO" antes de
			// que el padre limpie el canje.
			window.setTimeout(() => onExpire(), 900);
			return;
		}
		// Falló el consumo (sin red, no canjeable…): revertir la barra y
		// permitir reintento.  El ticket NO se da por quemado.
		setBurnError(true);
		if (burnFillRef.current) {
			gsap.to(burnFillRef.current, {
				scaleX: 0,
				duration: 0.18,
				ease: "power2.out",
			});
		}
	};

	const cancelBurn = () => {
		// Durante la verificación o tras quemar, ignorar el gesto.
		if (burned || verifying) return;
		setBurning(false);
		burnTweenRef.current?.kill();
		burnTweenRef.current = null;
		if (burnFillRef.current) {
			gsap.to(burnFillRef.current, {
				scaleX: 0,
				duration: 0.18,
				ease: "power2.out",
			});
		}
	};

	useEffect(() => {
		const tick = () => {
			const next = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
			setRemaining(next);
			if (next === 0) onExpire();
		};
		tick();
		const id = window.setInterval(tick, 250);
		return () => window.clearInterval(id);
	}, [expiresAtMs, onExpire]);

	useGSAP(
		() => {
			gsap.fromTo(
				containerRef.current,
				{ opacity: 0 },
				{ opacity: 1, duration: 0.3, ease: "power2.out", force3D: true },
			);
			gsap.fromTo(
				cardRef.current,
				{ scale: 0.88, opacity: 0, y: 30 },
				{
					scale: 1,
					opacity: 1,
					y: 0,
					duration: 0.65,
					ease: "back.out(1.6)",
					force3D: true,
				},
			);
			gsap.fromTo(
				priceRef.current,
				{ scale: 0.7, opacity: 0 },
				{
					scale: 1,
					opacity: 1,
					duration: 0.6,
					delay: 0.25,
					ease: "back.out(2.2)",
					force3D: true,
				},
			);
			if (waveRef.current) {
				gsap.to(waveRef.current, {
					backgroundPosition: "200% 0",
					duration: 2.4,
					repeat: -1,
					ease: "none",
				});
			}
			if (codeRef.current) {
				gsap.to(codeRef.current, {
					opacity: 0.45,
					duration: 0.8,
					yoyo: true,
					repeat: -1,
					ease: "sine.inOut",
				});
			}
			if (ringRef.current) {
				gsap.to(ringRef.current, {
					rotation: 360,
					duration: 18,
					repeat: -1,
					ease: "none",
					force3D: true,
				});
			}
		},
		{ scope: containerRef },
	);

	const minutes = Math.floor(remaining / 60);
	const seconds = remaining % 60;
	const expired = remaining === 0;

	const accent = isFree ? "lime" : "amber";

	return (
		<div
			ref={containerRef}
			role="dialog"
			aria-modal="true"
			aria-label={t("redemption.title")}
			className="fixed inset-0 z-100 bg-black/92 backdrop-blur-md transform-gpu translate-z-0 flex items-center justify-center px-4"
		>
			{onClose && (
				<button
					type="button"
					onClick={onClose}
					aria-label={t("common.close")}
					className="absolute top-4 right-4 w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					<X className="w-5 h-5" aria-hidden="true" />
				</button>
			)}

			<div
				ref={cardRef}
				className={cn(
					"relative w-full max-w-[420px] rounded-4xl overflow-hidden border-2 bg-linear-to-br from-zinc-950 via-zinc-900 to-black p-6 text-center will-change-transform",
					expired
						? "border-zinc-700 grayscale"
						: isFree
							? "border-lime-400/70 shadow-[0_0_80px_rgba(57,255,20,0.45)]"
							: "border-amber-400/70 shadow-[0_0_80px_rgba(255,215,0,0.45)]",
				)}
			>
				<div
					ref={waveRef}
					className="absolute inset-0 pointer-events-none opacity-25"
					style={{
						background: isFree
							? "linear-gradient(120deg, transparent 0%, rgba(57,255,20,0.35) 40%, transparent 80%)"
							: "linear-gradient(120deg, transparent 0%, rgba(255,215,0,0.35) 40%, transparent 80%)",
						backgroundSize: "200% 100%",
					}}
					aria-hidden="true"
				/>
				<div
					ref={ringRef}
					className="absolute -inset-1 rounded-4xl pointer-events-none will-change-transform"
					style={{
						background: isFree
							? "conic-gradient(from 0deg, transparent 0%, rgba(57,255,20,0.45) 30%, transparent 60%)"
							: "conic-gradient(from 0deg, transparent 0%, rgba(255,215,0,0.45) 30%, transparent 60%)",
						maskImage: "radial-gradient(circle, transparent 67%, black 70%)",
						WebkitMaskImage:
							"radial-gradient(circle, transparent 67%, black 70%)",
					}}
					aria-hidden="true"
				/>

				<div className="relative z-10 flex flex-col gap-4">
					<div
						className={cn(
							"inline-flex items-center gap-2 px-3 py-1 rounded-full mx-auto border",
							isFree
								? "bg-lime-500/15 border-lime-400/50"
								: "bg-amber-500/15 border-amber-400/50",
						)}
					>
						<ShieldCheck
							className={cn(
								"w-3.5 h-3.5",
								isFree ? "text-lime-300" : "text-amber-300",
							)}
							aria-hidden="true"
						/>
						<span
							className={cn(
								"text-[10px] font-black tracking-widest uppercase",
								isFree ? "text-lime-300" : "text-amber-300",
							)}
						>
							{expired
								? t("redemption.expired")
								: t("redemption.staffMustValidate")}
						</span>
					</div>

					{/* ── PRODUCT NAME (GIANT) — primer dato que ve el camarero ── */}
					<div className="px-1">
						<p className="text-[10px] uppercase tracking-[0.4em] text-zinc-500 font-black mb-2">
							{t("redemption.product")}
						</p>
						<h2
							className={cn(
								"font-black italic tracking-tighter leading-[0.92] text-white drop-shadow-[0_2px_20px_rgba(255,255,255,0.25)]",
								productName.length > 28
									? "text-3xl sm:text-4xl"
									: "text-4xl sm:text-5xl",
							)}
						>
							{productName.toUpperCase()}
						</h2>
					</div>

					{/* ── PRICE BLOCK (GIGANTIC) — segundo dato crítico ── */}
					<div
						ref={priceRef}
						className={cn(
							"relative mx-auto my-2 rounded-2xl border-2 px-6 py-5",
							isFree
								? "bg-lime-500/10 border-lime-400/60"
								: "bg-amber-500/10 border-amber-400/60",
						)}
					>
						<p className="text-[10px] uppercase tracking-[0.4em] text-zinc-400 font-black mb-1">
							{t("redemption.staffCharge")}
						</p>
						{isFree ? (
							<div className="flex items-center justify-center gap-3">
								<Gift
									className="w-10 h-10 text-lime-300 drop-shadow-[0_0_20px_rgba(57,255,20,0.7)]"
									aria-hidden="true"
								/>
								<span className="text-6xl sm:text-7xl font-black italic tracking-tighter text-lime-300 drop-shadow-[0_0_25px_rgba(57,255,20,0.8)]">
									{t("redemption.free")}
								</span>
							</div>
						) : (
							<div className="flex items-baseline justify-center gap-1">
								<span className="text-6xl sm:text-8xl font-black italic tracking-tighter text-amber-300 tabular-nums drop-shadow-[0_0_25px_rgba(255,215,0,0.8)]">
									{priceEur.toFixed(priceEur % 1 === 0 ? 0 : 2)}
								</span>
								<span className="text-3xl sm:text-5xl font-black italic text-amber-300 drop-shadow-[0_0_20px_rgba(255,215,0,0.8)]">
									€
								</span>
							</div>
						)}
					</div>

					{/* ── Timer + Verification code ── */}
					<div className="flex items-center justify-center gap-2 text-rose-300 font-black">
						<Timer className="w-5 h-5" aria-hidden="true" />
						<span className="font-mono text-3xl tabular-nums drop-shadow-[0_0_10px_rgba(244,63,94,0.5)]">
							{pad(minutes)}:{pad(seconds)}
						</span>
					</div>

					<div
						ref={codeRef}
						className="font-mono text-3xl tracking-[0.4em] text-white py-3 border-y border-dashed border-zinc-700 select-none"
					>
						{code}
					</div>

					<p className="text-[10px] text-zinc-500 leading-relaxed px-2">
						{t("redemption.screenshotWarning")}
					</p>

					{/* ── HOLD-TO-BURN (anti-fraude) ── */}
					{!expired && !burned && (
						<>
							<button
								type="button"
								disabled={verifying}
								onPointerDown={verifying ? undefined : startBurn}
								onPointerUp={cancelBurn}
								onPointerLeave={cancelBurn}
								onPointerCancel={cancelBurn}
								className="relative mt-1 h-14 w-full rounded-2xl overflow-hidden border-2 border-rose-500/60 bg-rose-950/40 active:scale-[0.99] touch-none select-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-80"
								aria-label={t("redemption.holdToBurn", "Mantén pulsado para quemar el ticket")}
							>
								<div
									ref={burnFillRef}
									className="absolute inset-0 origin-left bg-linear-to-r from-rose-600 to-orange-500"
									style={{ transform: "scaleX(0)" }}
									aria-hidden="true"
								/>
								<span className="relative z-10 flex items-center justify-center gap-2 font-black uppercase tracking-widest text-sm text-white">
									<Flame className="w-5 h-5" aria-hidden="true" />
									{verifying
										? t("redemption.verifying", "Validando…")
										: burning
											? t("redemption.burning", "Sigue pulsando…")
											: t("redemption.holdToBurn", "Mantén pulsado para quemar")}
								</span>
							</button>
							{burnError && (
								<p
									role="alert"
									className="text-[11px] text-rose-300 font-bold -mt-1"
								>
									{t(
										"redemption.burnError",
										"No se pudo validar el ticket. Revisa la conexión e inténtalo otra vez.",
									)}
								</p>
							)}
						</>
					)}

					{burned && (
						<div className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-rose-600/25 border border-rose-500/60 mx-auto">
							<Flame className="w-5 h-5 text-rose-300" aria-hidden="true" />
							<span className="text-sm font-black tracking-widest text-rose-100 uppercase">
								{t("redemption.burned", "¡Ticket quemado!")}
							</span>
						</div>
					)}

					{expired && (
						<div className="mt-1 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/40 mx-auto">
							<Flame
								className="w-4 h-4 text-rose-300"
								aria-hidden="true"
							/>
							<span className="text-[10px] font-black tracking-widest text-rose-200 uppercase">
								{t("redemption.expiredAction")}
							</span>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
