import { useGameState, type Screen } from "../store/useGameState";
import { useSession } from "../lib/useSession";
import { AppFrame } from "./AppFrame";
import { BottomNav } from "./BottomNav";
import { RedemptionScreen } from "./RedemptionScreen";
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
	const currentScreen = useGameState((s) => s.currentScreen);
	const activeRedemption = useGameState((s) => s.activeRedemption);
	const closeRedemption = useGameState((s) => s.closeRedemption);
	const showNav = SCREENS_WITH_NAV.has(currentScreen);

	return (
		<div className="electric-bg min-h-dvh w-full text-white selection:bg-cyan-500/30 relative overflow-hidden overscroll-none">
			<div className="ambient-blob top-[-10%] left-[-10%] w-[40vw] h-[40vw] max-w-[700px] max-h-[700px] bg-cyan-600/25 hidden sm:block" />
			<div className="ambient-blob bottom-[-15%] right-[-10%] w-[45vw] h-[45vw] max-w-[800px] max-h-[800px] bg-lime-500/15 hidden sm:block" />
			<div className="ambient-blob top-[30%] left-[55%] w-[35vw] h-[35vw] max-w-[600px] max-h-[600px] bg-blue-700/20 hidden sm:block" />

			<AppFrame>
				<ScreenRouter screen={currentScreen} />
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
				/>
			)}
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
