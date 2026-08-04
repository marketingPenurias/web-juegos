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
	// V20: hay duelo en vivo → "nube" flotante sobre Directo.
	const battleActive = useGameState((s) => s.battleActive);
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

	// La nube flota suavemente mientras dure la batalla.  Se re-lanza al
	// aparecer/desaparecer, no en cada render.
	useGSAP(
		() => {
			if (!battleActive) return;
			gsap.fromTo(
				".nav-battle-cloud",
				{ y: 4, opacity: 0, scale: 0.85 },
				{ y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2)" },
			);
			gsap.to(".nav-battle-cloud", {
				y: -3,
				duration: 1.1,
				yoyo: true,
				repeat: -1,
				ease: "sine.inOut",
				delay: 0.45,
			});
		},
		{ scope: containerRef, dependencies: [battleActive] },
	);

	return (
		<div
			ref={containerRef}
			className="bg-zinc-950/85 backdrop-blur-xl transform-gpu translate-z-0 border-t border-zinc-800/50 pt-1.5 px-2 relative z-50 shrink-0 pb-safe"
			style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
		>
			<div className="flex justify-around items-center">
				{ITEMS.map(({ id, labelKey, Icon }) => {
					const active = current === id;
					const label = t(labelKey);
					return (
						<button
							key={id}
							onClick={() => setScreen(id)}
							aria-label={
								id === "live" && battleActive
									? `${label} · ${t("nav.battleLive", "¡Batalla en directo!")}`
									: label
							}
							aria-current={active ? "page" : undefined}
							className={cn(
								"nav-item relative flex flex-col items-center gap-0.5 transition-colors px-3 py-1 rounded-xl",
								active
									? "text-cyan-400"
									: "text-zinc-500 hover:text-zinc-300 active:text-zinc-200",
							)}
						>
							{/* V20 · "Nube" de batalla en vivo: avisa de que hay duelo sin
							    tener que entrar a mirar.  Sólo sobre Directo. */}
							{id === "live" && battleActive && (
								<span
									className="nav-battle-cloud absolute -top-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none whitespace-nowrap rounded-full bg-linear-to-r from-rose-500 to-red-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white shadow-[0_0_14px_rgba(244,63,94,0.7)]"
									aria-hidden="true"
								>
									{t("nav.battleLive", "¡Batalla!")}
									{/* Piquito de la nube apuntando al icono */}
									<span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-red-600" />
								</span>
							)}
							<div className="relative w-5 h-5">
								{active && (
									<span className="absolute inset-0 bg-cyan-400/30 rounded-full blur-md" />
								)}
								{/* Halo rojo pulsante cuando hay batalla y no estás en ella */}
								{id === "live" && battleActive && !active && (
									<span className="absolute -inset-1 rounded-full bg-rose-500/30 blur-md animate-pulse" />
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

			{/* Branding corporativo sutil — "Powered by Nightgraph" */}
			<div className="flex items-center justify-center gap-1.5 pt-1 pb-0.5 opacity-40">
				<img
					src="/logo-nightgraph.jpg"
					alt=""
					aria-hidden="true"
					className="w-3 h-3 rounded-full object-cover"
				/>
				<span className="text-[8px] font-bold tracking-[0.2em] uppercase text-zinc-500">
					Powered by Nightgraph
				</span>
			</div>
		</div>
	);
}
