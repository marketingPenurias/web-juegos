import { useTranslation } from "react-i18next";
import { LogOut, Sparkles, User } from "lucide-react";
import { useGameState } from "../../store/useGameState";
import { LanguageSwitch } from "../LanguageSwitch";

export function HubHeader() {
	const { t } = useTranslation();
	const profile = useGameState((s) => s.profile);
	const setScreen = useGameState((s) => s.setScreen);
	const logout = useGameState((s) => s.logout);

	return (
		<header className="px-6 pt-12 sm:pt-8 flex justify-between items-center mb-6">
			<button
				type="button"
				onClick={() => setScreen("profile")}
				aria-label={t("hub.openProfile")}
				className="flex items-center gap-3 active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-full"
			>
				<div className="w-12 h-12 rounded-full bg-linear-to-tr from-cyan-600 to-blue-500 p-0.5">
					<div className="w-full h-full bg-zinc-950 rounded-full flex items-center justify-center">
						<User className="text-cyan-400 w-6 h-6" aria-hidden="true" />
					</div>
				</div>
				<div className="text-left">
					<h2 className="text-white font-black text-lg leading-tight">
						{profile.handle}
					</h2>
					<div className="flex items-center gap-1">
						<Sparkles className="w-3 h-3 text-amber-400" aria-hidden="true" />
						<span className="text-amber-400 text-xs font-bold uppercase tracking-wider">
							{t("hub.levelStatus")}
						</span>
					</div>
				</div>
			</button>

			<div className="flex items-center gap-2">
				<LanguageSwitch compact />
				<button
					type="button"
					onClick={logout}
					aria-label={t("hub.logout")}
					className="w-10 h-10 rounded-full bg-zinc-900/80 flex items-center justify-center border border-zinc-800 text-zinc-400 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					<LogOut className="w-4 h-4" aria-hidden="true" />
				</button>
			</div>
		</header>
	);
}
