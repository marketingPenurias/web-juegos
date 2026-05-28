import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";
import { useGameState } from "../../store/useGameState";
import { TIERS, TIER_ORDER, tierFromLifetime } from "../../lib/tier";
import { cn } from "../../lib/utils";

/**
 * TierRibbon — banda visual con los 4 niveles para el Hub.
 *
 *   Piloto MVP: el tier "actual" se calcula desde `lifetimeEarned` con
 *   `tierFromLifetime`.  Para el piloto donde casi nadie pasará de
 *   500 tokens, el badge Bronce es el normal y los superiores aparecen
 *   con candado y "Próximamente".  En Fase 2 se sustituye por el
 *   estado real (incluyendo riesgo / downgrade Platino).
 *
 *   Cero lógica de bloqueos en otras vistas — esta cinta es la única
 *   pista visual de progresión para el piloto.
 */

export function TierRibbon() {
	const { t } = useTranslation();
	const lifetime = useGameState((s) => s.lifetimeEarned);
	const tokens = useGameState((s) => s.tokens);
	const currentTier = tierFromLifetime(lifetime);
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
				{TIER_ORDER.map((code) => {
					const meta = TIERS[code];
					const isCurrent = code === currentTier;
					const isUnlocked = lifetime >= meta.minLifetime;
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
								{meta.emoji}
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
								{meta.displayName}
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

			<p className="text-[10px] text-zinc-500 mt-3 text-center px-1 leading-relaxed">
				{t(
					"hub.tierFooter",
					"Sube de nivel ganando tokens en los juegos · disponible {{n}}",
					{ n: tokens },
				)}
			</p>
		</section>
	);
}
