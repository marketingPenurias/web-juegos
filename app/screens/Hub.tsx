import { useRef, useState } from "react";
import { gsap, useGSAP } from "../lib/gsap";
import { HubHeader } from "../components/hub/HubHeader";
import { TokenWalletCard } from "../components/hub/TokenWalletCard";
import { StreakCard } from "../components/hub/StreakCard";
import { MissionsCard } from "../components/hub/MissionsCard";
import { LeaderboardCard } from "../components/hub/LeaderboardCard";
import { GameLauncherCard } from "../components/hub/GameLauncherCard";
import { ViralLoopCard } from "../components/hub/ViralLoopCard";
import { HistoryDrawer } from "../components/HistoryDrawer";

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
				<StreakCard />
				<MissionsCard />
				<LeaderboardCard />
				<GameLauncherCard />
				<ViralLoopCard />
			</main>

			<HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
		</div>
	);
}
