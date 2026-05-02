import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Home as HomeIcon, Music2, Wine, Ticket as TicketIcon } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState, type Screen } from "../store/useGameState";
import { cn } from "../lib/utils";

const ITEMS: Array<{ id: Screen; labelKey: string; Icon: typeof HomeIcon }> = [
	{ id: "hub", labelKey: "nav.hub", Icon: HomeIcon },
	{ id: "live", labelKey: "nav.live", Icon: Music2 },
	{ id: "menu", labelKey: "nav.menu", Icon: Wine },
	{ id: "ticket", labelKey: "nav.ticket", Icon: TicketIcon },
];

export function BottomNav() {
	const { t } = useTranslation();
	const current = useGameState((s) => s.currentScreen);
	const setScreen = useGameState((s) => s.setScreen);
	const hasTicket = useGameState((s) => s.activeTicket !== null);
	const containerRef = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			gsap.from(".nav-item", {
				y: 24,
				opacity: 0,
				stagger: 0.06,
				duration: 0.5,
				ease: "power3.out",
			});
		},
		{ scope: containerRef },
	);

	return (
		<div
			ref={containerRef}
			className="bg-zinc-950/85 backdrop-blur-xl transform-gpu translate-z-0 border-t border-zinc-800/50 pt-1.5 px-2 relative z-50 shrink-0 pb-safe"
			style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
		>
			<div className="flex justify-around items-center">
				{ITEMS.map(({ id, labelKey, Icon }) => {
					if (id === "ticket" && !hasTicket) return null;
					const active = current === id;
					const label = t(labelKey);
					return (
						<button
							key={id}
							onClick={() => setScreen(id)}
							aria-label={label}
							aria-current={active ? "page" : undefined}
							className={cn(
								"nav-item flex flex-col items-center gap-0.5 transition-colors px-3 py-1 rounded-xl",
								active
									? "text-cyan-400"
									: "text-zinc-500 hover:text-zinc-300 active:text-zinc-200",
							)}
						>
							<div className="relative w-5 h-5">
								{active && (
									<span className="absolute inset-0 bg-cyan-400/30 rounded-full blur-md" />
								)}
								<Icon className="relative z-10 w-5 h-5" aria-hidden="true" />
							</div>
							<span className="text-[9px] font-bold tracking-wider">
								{label}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
