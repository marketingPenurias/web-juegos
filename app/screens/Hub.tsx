import { useRef, useState } from "react";
import { gsap, useGSAP } from "../lib/gsap";
import { HubHeader } from "../components/hub/HubHeader";
import { TokenWalletCard } from "../components/hub/TokenWalletCard";
import { TierRibbon } from "../components/hub/TierRibbon";
import { StreakCard } from "../components/hub/StreakCard";
import { MissionsCard } from "../components/hub/MissionsCard";
import { GameLauncherCard } from "../components/hub/GameLauncherCard";
import { HistoryDrawer } from "../components/HistoryDrawer";

/**
 * Hub — composición del piloto.
 *
 *   Cards activas:
 *     · TokenWalletCard   — saldo real (server-truth).
 *     · TierRibbon        — los 4 niveles con tu posición actual.
 *     · MissionsCard      — 3 misiones derivadas de `daily_activity`.
 *     · StreakCard        — "Día 1 de piloto" (MVP, sin invent).
 *     · GameLauncherCard  — accesos a los juegos reales.
 *
 *   Cards retiradas hasta Fase 2 (sin tabla real):
 *     · LeaderboardCard   (vista `tenant_leaderboard` pendiente).
 *     · ViralLoopCard     (RPC `redeem_referral` pendiente).
 *
 *   El GSAP intro anima `.hub-card`; el selector huérfano
 *   `.hub-streak-flame` se eliminó porque ya no tiene match en el DOM
 *   (la StreakCard del piloto no marca las llamas individualmente).
 */

export function Hub() {
	const containerRef = useRef<HTMLDivElement>(null);
	const [historyOpen, setHistoryOpen] = useState(false);

	useGSAP(
		() => {
			gsap.from(".hub-card", {
				y: 24,
				opacity: 0,
				stagger: 0.08,
				duration: 0.55,
				ease: "power3.out",
			});
		},
		{ scope: containerRef },
	);

	return (
		<div
			ref={containerRef}
			className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar pb-6 relative z-20"
		>
			<HubHeader />

			<main className="px-6 flex flex-col gap-5">
				<TokenWalletCard onOpenHistory={() => setHistoryOpen(true)} />
				<TierRibbon />
				<MissionsCard />
				<StreakCard />
				<GameLauncherCard />
			</main>

			<HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
		</div>
	);
}
