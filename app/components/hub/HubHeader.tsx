import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, User } from "lucide-react";
import { useGameState } from "../../store/useGameState";
import { useAuthUser } from "../../lib/useAuthUser";
import { TIERS, tierFromLifetime } from "../../lib/tier";
import { getBrowserSupabase } from "../../lib/supabase.client";
import { LanguageSwitch } from "../LanguageSwitch";

/**
 * HubHeader — versión REAL.
 *
 *   · Nombre + avatar ← Supabase Auth (`useAuthUser`).
 *   · Badge del tier ← `lifetimeEarned` vía `tierFromLifetime`.
 *   · Sin sesión, muestra placeholder "Invitado" en vez de un mock que
 *     parezca real ("Alejandro Vega").
 *   · Logout cierra Supabase Auth Y el store local.
 */

export function HubHeader() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);
	const lifetime = useGameState((s) => s.lifetimeEarned);
	const logoutStore = useGameState((s) => s.logout);
	const authUser = useAuthUser();

	const tier = useMemo(() => tierFromLifetime(lifetime), [lifetime]);
	const tierMeta = TIERS[tier];

	const displayName =
		authUser?.displayName?.trim() ||
		authUser?.email?.split("@")[0] ||
		t("profile.guest", "Invitado");

	const handleLogout = async () => {
		const supabase = getBrowserSupabase();
		if (supabase) {
			try {
				await supabase.auth.signOut();
			} catch {
				/* swallow */
			}
		}
		logoutStore();
	};

	return (
		<header className="px-6 pt-12 sm:pt-8 flex justify-between items-center mb-6">
			<button
				type="button"
				onClick={() => setScreen("profile")}
				aria-label={t("hub.openProfile")}
				className="flex items-center gap-3 active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-full"
			>
				<div
					className="w-12 h-12 rounded-full p-0.5"
					style={{
						background: `linear-gradient(135deg, ${tierMeta.colorPrimary}, ${tierMeta.colorAccent})`,
					}}
				>
					<div className="w-full h-full bg-zinc-950 rounded-full flex items-center justify-center overflow-hidden">
						{authUser?.avatarUrl ? (
							<img
								src={authUser.avatarUrl}
								alt=""
								referrerPolicy="no-referrer"
								className="w-full h-full object-cover"
							/>
						) : (
							<User
								className="w-6 h-6"
								style={{ color: tierMeta.colorPrimary }}
								aria-hidden="true"
							/>
						)}
					</div>
				</div>
				<div className="text-left">
					<h2 className="text-white font-black text-lg leading-tight truncate max-w-[180px]">
						{displayName}
					</h2>
					<div className="flex items-center gap-1">
						<span className="text-xs" aria-hidden="true">
							{tierMeta.emoji}
						</span>
						<span
							className="text-xs font-bold uppercase tracking-wider"
							style={{ color: tierMeta.colorPrimary }}
						>
							{t("hub.tierStatus", "Nivel {{tier}}", {
								tier: tierMeta.displayName,
							})}
						</span>
					</div>
				</div>
			</button>

			<div className="flex items-center gap-2">
				<LanguageSwitch compact />
				<button
					type="button"
					onClick={() => void handleLogout()}
					aria-label={t("hub.logout")}
					className="w-10 h-10 rounded-full bg-zinc-900/80 flex items-center justify-center border border-zinc-800 text-zinc-400 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					<LogOut className="w-4 h-4" aria-hidden="true" />
				</button>
			</div>
		</header>
	);
}
