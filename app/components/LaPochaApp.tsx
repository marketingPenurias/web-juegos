import { useGameState, type Screen } from "../store/useGameState";
import { useSession } from "../lib/useSession";
import { usePendingCheckin } from "../lib/usePendingCheckin";
import { useRewards } from "../lib/useRewards";
import { AppFrame } from "./AppFrame";
import { BottomNav } from "./BottomNav";
import { RedemptionScreen } from "./RedemptionScreen";
import { CheckinResultModal } from "./CheckinResultModal";
import { BirthDateGate } from "./BirthDateGate";
import { NowPlaying } from "./NowPlaying";
import { Onboarding } from "../screens/Onboarding";
import { Hub } from "../screens/Hub";
import { LiveBattle } from "../screens/LiveBattle";
import { SecretMenu } from "../screens/SecretMenu";
import { TinderMusical } from "../screens/TinderMusical";
import { RuletaRondas } from "../screens/RuletaRondas";
import { Ticket } from "../screens/Ticket";
import { Profile } from "../screens/Profile";
import { Jukebox } from "../screens/Jukebox";
import { DJDashboard } from "../screens/DJDashboard";

const SCREENS_WITH_NAV = new Set<Screen>(["hub", "live", "menu", "ticket"]);

export default function LaPochaApp() {
	useSession();
	usePendingCheckin();
	const currentScreen = useGameState((s) => s.currentScreen);
	const activeRedemption = useGameState((s) => s.activeRedemption);
	const closeRedemption = useGameState((s) => s.closeRedemption);
	const { consume } = useRewards();
	const showNav = SCREENS_WITH_NAV.has(currentScreen);

	// Consumo REAL del ticket (anti-fraude).  El hold-to-burn de
	// RedemptionScreen llama aquí: marcamos el reward 'consumed' en la BD
	// vía `complete_redemption` y devolvemos si el servidor lo confirmó.
	// `already_consumed` cuenta como éxito (idempotente: el ticket ya está
	// gastado, así que mostrar "QUEMADO" es correcto).
	const handleBurn = async (): Promise<boolean> => {
		if (!activeRedemption) return false;
		const res = await consume(activeRedemption.rewardId);
		return res.ok || (!res.ok && res.error === "already_consumed");
	};

	return (
		<div className="electric-bg min-h-dvh w-full text-white selection:bg-cyan-500/30 relative overflow-hidden overscroll-none">
			<div className="ambient-blob top-[-10%] left-[-10%] w-[40vw] h-[40vw] max-w-[700px] max-h-[700px] bg-cyan-600/25 hidden sm:block" />
			<div className="ambient-blob bottom-[-15%] right-[-10%] w-[45vw] h-[45vw] max-w-[800px] max-h-[800px] bg-lime-500/15 hidden sm:block" />
			<div className="ambient-blob top-[30%] left-[55%] w-[35vw] h-[35vw] max-w-[600px] max-h-[600px] bg-blue-700/20 hidden sm:block" />

			<AppFrame>
				<ScreenRouter screen={currentScreen} />
				{showNav && <NowPlaying />}
				{showNav && <BottomNav />}
			</AppFrame>

			{activeRedemption && (
				<RedemptionScreen
					rewardId={activeRedemption.rewardId}
					productName={activeRedemption.productName}
					priceEur={activeRedemption.priceEur}
					expiresAt={activeRedemption.expiresAt}
					onExpire={closeRedemption}
					onClose={closeRedemption}
					onBurn={handleBurn}
				/>
			)}

			<CheckinResultModal />

			{/* Gate +18 / cumpleaños: bloquea el juego hasta capturar birth_date. */}
			<BirthDateGate />
		</div>
	);
}

function ScreenRouter({ screen }: { screen: Screen }) {
	switch (screen) {
		case "onboarding":
			return <Onboarding />;
		case "hub":
			return <Hub />;
		case "live":
			return <LiveBattle />;
		case "menu":
			return <SecretMenu />;
		case "tinder":
			return <TinderMusical />;
		case "ruleta":
			return <RuletaRondas />;
		case "ticket":
			return <Ticket />;
		case "profile":
			return <Profile />;
		case "jukebox":
			return <Jukebox />;
		case "dj":
			return <DJDashboard />;
		default:
			return <Onboarding />;
	}
}
