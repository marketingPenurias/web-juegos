import { useRef, useState } from "react";
import { gsap, useGSAP } from "../lib/gsap";
import { HubHeader } from "../components/hub/HubHeader";
import { TokenWalletCard } from "../components/hub/TokenWalletCard";
import { TierRibbon } from "../components/hub/TierRibbon";
import { StreakCard } from "../components/hub/StreakCard";
import { MissionsCard } from "../components/hub/MissionsCard";
import { LeaderboardCard } from "../components/hub/LeaderboardCard";
import { NamePromptCard } from "../components/hub/NamePromptCard";
import { InviteCard } from "../components/hub/InviteCard";
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
 *     · NamePromptCard    — solo si aún no eligió nombre para el ranking.
 *     · LeaderboardCard   — top real por saldo (`/api/leaderboard`).
 *     · InviteCard        — enlace de invitación; cobra con el check-in del amigo.
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

	// `fromTo` con opacidad final EXPLÍCITA, no `from`.
	//
	//   `from(opacity: 0)` toma el valor ACTUAL como destino, así que si el
	//   efecto se reejecuta mientras una tarjeta sigue en 0, el destino pasa a
	//   ser 0 y se queda invisible para siempre.  Es el fallo que nos mordió en
	//   la V17, y cuesta de diagnosticar porque no deja rastro: DOM completo,
	//   cero errores en consola y `opacity: 0` calculado.
	//
	//   Hoy este efecto corre una sola vez y no se dispara, pero basta con
	//   añadir una dependencia para reabrirlo.  `fromTo` lo cierra por
	//   construcción y `clearProps` deja el estilo en línea fuera al acabar.
	useGSAP(
		() => {
			gsap.fromTo(
				".hub-card",
				{ y: 24, opacity: 0 },
				{
					y: 0,
					opacity: 1,
					stagger: 0.08,
					duration: 0.55,
					ease: "power3.out",
					clearProps: "opacity,transform",
				},
			);
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
				{/* Solo aparece si aún no ha elegido nombre. */}
				<NamePromptCard />
				{/* V17: los juegos suben al top del Hub (justo bajo el monedero)
				    para dar protagonismo al Jukebox/Tinder — antes quedaban al
				    final, por debajo del ranking y la racha. */}
				<GameLauncherCard />
				<TierRibbon />
				<MissionsCard />
				<LeaderboardCard />
				<InviteCard />
				<StreakCard />
			</main>

			<HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
			<WelcomeModal />
		</div>
	);
}
