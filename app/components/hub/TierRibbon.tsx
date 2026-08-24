import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";
import { useGameState } from "../../store/useGameState";
import { TIERS, TIER_ORDER, isTierCode, type TierCode } from "../../lib/tier";
import { cn } from "../../lib/utils";

/**
 * TierRibbon — banda visual con los niveles de la sala para el Hub.
 *
 *   Tanto el nivel actual como los umbrales vienen del SERVIDOR: cada
 *   discoteca configura su propia escalera (nombres, emojis y puntos), así que
 *   calcularlos aquí con constantes obligaría a mantener dos verdades.  Si la
 *   sesión aún no ha respondido, se cae a los cuatro niveles por defecto solo
 *   para no dejar el hueco vacío en el primer render.
 *
 *   Es la única pista visual de progresión: ninguna otra vista bloquea nada.
 */

export function TierRibbon() {
	const { t } = useTranslation();
	const lifetime = useGameState((s) => s.lifetimeEarned);
	const tokens = useGameState((s) => s.tokens);
	const currentTier = useGameState((s) => s.tier);
	const tiers = useGameState((s) => s.tiers);

	// Escalera real de la sala; respaldo visual mientras carga la sesión.
	const ladder =
		tiers.length > 0
			? tiers
					.filter((tr) => isTierCode(tr.tier_code))
					.map((tr) => ({
						code: tr.tier_code as TierCode,
						displayName: tr.display_name || TIERS[tr.tier_code as TierCode].displayName,
						emoji: tr.badge_emoji || TIERS[tr.tier_code as TierCode].emoji,
						minLifetime: tr.min_lifetime,
					}))
			: TIER_ORDER.map((code) => ({
					code,
					displayName: TIERS[code].displayName,
					emoji: TIERS[code].emoji,
					minLifetime: 0,
				}));
	const containerRef = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			gsap.from(".tier-badge", {
				y: 12,
				opacity: 0,
				stagger: 0.08,
				duration: 0.5,
				ease: "back.out(1.6)",
				force3D: true,
			});
		},
		{ scope: containerRef, dependencies: [currentTier] },
	);

	// Qué le falta para el siguiente nivel y qué gana con él.  Todo sale de la
	// configuración de la sala, así que el mensaje es cierto en cualquier
	// discoteca sin tocarlo.
	const nextStep = useMemo(() => {
		if (tiers.length === 0) return null;
		const current = tiers.find((tr) => tr.tier_code === currentTier);
		if (!current) return null;
		const next = tiers
			.filter((tr) => tr.sort_order > current.sort_order)
			.sort((a, b) => a.sort_order - b.sort_order)[0];
		if (!next) return null;

		const perks: string[] = [];
		const rateNow = current.tokens_per_euro;
		const rateNext = next.tokens_per_euro;
		if (rateNow && rateNext && rateNext < rateNow) {
			perks.push(
				t("hub.perkCheaper", {
					pct: Math.round(((rateNow - rateNext) / rateNow) * 100),
				}),
			);
		}
		// null = sin límite, que es una mejora aunque no sea un número mayor.
		if (next.max_redemptions_per_night === null) {
			perks.push(t("hub.perkUnlimited"));
		} else if (
			current.max_redemptions_per_night !== null &&
			next.max_redemptions_per_night > current.max_redemptions_per_night
		) {
			perks.push(
				t("hub.perkRedemptions", { count: next.max_redemptions_per_night }),
			);
		}

		return {
			displayName: next.display_name,
			missing: Math.max(0, next.min_lifetime - lifetime),
			perks,
		};
	}, [tiers, currentTier, lifetime, t]);

	return (
		<section
			ref={containerRef}
			aria-label={t("hub.tierTitle", "Tu nivel")}
			className="hub-card relative bg-zinc-950/70 rounded-3xl border border-zinc-800 px-4 py-4 overflow-hidden"
		>
			<div className="flex items-center justify-between mb-3 px-1">
				<p className="text-[10px] uppercase tracking-[0.3em] text-zinc-400 font-black">
					{t("hub.tierTitle", "Tu nivel")}
				</p>
				<p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold tabular-nums">
					{t("hub.lifetimeShort", "{{n}} histórico", { n: lifetime })}
				</p>
			</div>

			<div className="grid grid-cols-4 gap-2">
				{ladder.map((step) => {
					const code = step.code;
					const meta = TIERS[code];
					const isCurrent = code === currentTier;
					const isUnlocked = lifetime >= step.minLifetime;
					return (
						<div
							key={code}
							className={cn(
								"tier-badge relative flex flex-col items-center gap-1 rounded-2xl border py-3 px-1 text-center transition-colors",
								isCurrent
									? "border-2 shadow-[0_0_25px_rgba(255,255,255,0.15)]"
									: isUnlocked
										? "border-zinc-700/60"
										: "border-zinc-800 opacity-60",
							)}
							style={{
								borderColor: isCurrent ? meta.colorPrimary : undefined,
								backgroundColor: isCurrent
									? `${meta.colorPrimary}1a`
									: "rgba(9,9,11,0.6)",
							}}
						>
							<span
								className="text-2xl leading-none"
								aria-hidden="true"
								style={{
									filter: isUnlocked ? undefined : "grayscale(0.7)",
								}}
							>
								{step.emoji}
							</span>
							<span
								className={cn(
									"text-[10px] font-black tracking-widest uppercase",
									isCurrent ? "" : "text-zinc-500",
								)}
								style={{
									color: isCurrent ? meta.colorPrimary : undefined,
								}}
							>
								{step.displayName}
							</span>
							{!isUnlocked && (
								<Lock
									className="absolute top-1.5 right-1.5 w-2.5 h-2.5 text-zinc-500"
									aria-hidden="true"
								/>
							)}
							{isCurrent && (
								<span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-black border"
									style={{
										color: meta.colorPrimary,
										borderColor: `${meta.colorPrimary}aa`,
									}}
								>
									{t("hub.tierYou", "Tu nivel")}
								</span>
							)}
						</div>
					);
				})}
			</div>

			{/* El gancho de retención: que alguien nuevo quiera volver una
			    SEGUNDA noche.  Un "sube de nivel" genérico no mueve a nadie;
			    decirle cuánto le falta y qué gana exactamente, sí. */}
			{nextStep ? (
				<p className="text-[10px] text-zinc-400 mt-3 text-center px-1 leading-relaxed">
					{t("hub.tierNext", {
						n: nextStep.missing,
						tier: nextStep.displayName,
					})}
					{nextStep.perks.length > 0 && (
						<span className="text-zinc-500">
							{" · "}
							{nextStep.perks.join(" · ")}
						</span>
					)}
				</p>
			) : (
				<p className="text-[10px] text-zinc-500 mt-3 text-center px-1 leading-relaxed">
					{t("hub.tierTop", "Estás en el nivel máximo · disponible {{n}}", {
						n: tokens,
					})}
				</p>
			)}
		</section>
	);
}
