import { useRef, useState } from "react";
import { gsap, useGSAP } from "../lib/gsap";
import { HubHeader } from "../components/hub/HubHeader";
import { TokenWalletCard } from "../components/hub/TokenWalletCard";
import { TierRibbon } from "../components/hub/TierRibbon";
import { StreakCard } from "../components/hub/StreakCard";
import { MissionsCard } from "../components/hub/MissionsCard";
import { LeaderboardCard } from "../components/hub/LeaderboardCard";
import { GameLauncherCard } from "../components/hub/GameLauncherCard";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { WelcomeModal } from "../components/WelcomeModal";

/**
 * Hub — composición del piloto.
 *
 *   Cards activas:
 *     · TokenWalletCard   — saldo real (server-truth).
 *     · TierRibbon        — los 4 niveles con tu posición actual.
 *     · MissionsCard      — 3 misiones derivadas de `daily_activity`.
 *     · StreakCard        — "Día 1 de piloto" (MVP, sin invent).
 *     · LeaderboardCard   — top real por saldo (`/api/leaderboard`).
 *     · GameLauncherCard  — accesos a los juegos reales.
 *
 *   Cards en barbecho (`components/_future/`, sin backend aún):
 *     · MissionRow        (tabla `missions` con metas pendiente).
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
				{/* V17: los juegos suben al top del Hub (justo bajo el monedero)
				    para dar protagonismo al Jukebox/Tinder — antes quedaban al
				    final, por debajo del ranking y la racha. */}
				<GameLauncherCard />
				<TierRibbon />
				<MissionsCard />
				<LeaderboardCard />
				<StreakCard />
			</main>

			<HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
			<WelcomeModal />
		</div>
	);
}
