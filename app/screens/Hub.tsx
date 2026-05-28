import { useRef, useState } from "react";
import { gsap, useGSAP } from "../lib/gsap";
import { HubHeader } from "../components/hub/HubHeader";
import { TokenWalletCard } from "../components/hub/TokenWalletCard";
import { TierRibbon } from "../components/hub/TierRibbon";
import { GameLauncherCard } from "../components/hub/GameLauncherCard";
import { HistoryDrawer } from "../components/HistoryDrawer";

// Pilot scope: StreakCard / MissionsCard / LeaderboardCard / ViralLoopCard
// quedan fuera del Hub porque siguen alimentándose de datos mock
// (streak, missions array, top-3 invented, "1/4 amigos invitados").
// Sus botones son inertes y conectarlos contra BD se programó en
// Fase 2 (tablas `user_streaks`, `user_missions`, vista
// `tenant_leaderboard`, RPC `redeem_referral`).  Mañana no se enseñan
// al CEO — directriz CTO "cero mocks en producción".

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
			gsap.from(".hub-streak-flame", {
				scale: 0,
				opacity: 0,
				stagger: 0.08,
				duration: 0.45,
				delay: 0.2,
				ease: "back.out(2)",
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
				<GameLauncherCard />
			</main>

			<HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
		</div>
	);
}
