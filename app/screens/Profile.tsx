import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
	ArrowLeft,
	Bell,
	ChevronRight,
	Coins,
	Languages,
	LogOut,
	Mail,
	Shield,
	Sparkles,
	User,
} from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { useAuthUser } from "../lib/useAuthUser";
import { TIERS, tierFromLifetime, tierProgressFraction } from "../lib/tier";
import { getBrowserSupabase } from "../lib/supabase.client";
import { LanguageSwitch } from "../components/LanguageSwitch";

/**
 * Profile — versión REAL.
 *
 *   · email/handle ← Supabase Auth (`useAuthUser`).  Sin sesión, se
 *     muestra etiqueta "Invitado" en vez de un mock que parezca real.
 *   · tokens disponibles ← `useGameState.tokens` (sincronizado por
 *     useSession).
 *   · tier + progreso ← `lifetimeEarned` vía helpers en `lib/tier`.
 *   · "Cerrar sesión" cierra la sesión Supabase Y limpia el store
 *     (logout).  Sin eso, el SIGNED_OUT no llega y el usuario se queda
 *     con balance de la sesión anterior persistido en sessionStorage.
 */

export function Profile() {
	const { t } = useTranslation();
	const tokens = useGameState((s) => s.tokens);
	const lifetime = useGameState((s) => s.lifetimeEarned);
	const setScreen = useGameState((s) => s.setScreen);
	const logoutStore = useGameState((s) => s.logout);
	const authUser = useAuthUser();

	const containerRef = useRef<HTMLDivElement>(null);

	const tier = useMemo(() => tierFromLifetime(lifetime), [lifetime]);
	const tierMeta = TIERS[tier];
	const progress = useMemo(
		() => tierProgressFraction(lifetime, tier),
		[lifetime, tier],
	);

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
				/* swallow — store logout still clears UI */
			}
		}
		logoutStore();
	};

	useGSAP(
		() => {
			gsap.from(".profile-fade", {
				y: 18,
				opacity: 0,
				stagger: 0.07,
				duration: 0.5,
				ease: "power3.out",
			});
		},
		{ scope: containerRef },
	);

	return (
		<div
			ref={containerRef}
			className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar pb-6 relative z-20 bg-black"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-2 flex items-center justify-between profile-fade">
				<button
					type="button"
					onClick={() => setScreen("hub")}
					aria-label={t("common.back")}
					className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					<ArrowLeft className="w-4 h-4" aria-hidden="true" />
				</button>
				<h1 className="text-base font-black italic tracking-tight text-white">
					{t("profile.title")}
				</h1>
				<div className="w-9 h-9" />
			</header>

			<section className="px-6 pt-6 profile-fade flex flex-col items-center text-center">
				<div
					className="w-24 h-24 rounded-full p-1 shadow-[0_0_40px_rgba(0,212,255,0.45)]"
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
								className="w-12 h-12"
								style={{ color: tierMeta.colorPrimary }}
								aria-hidden="true"
							/>
						)}
					</div>
				</div>
				<h2 className="mt-4 text-2xl font-black italic tracking-tight text-white">
					{displayName}
				</h2>
				<p className="text-zinc-400 text-sm flex items-center gap-1.5 mt-1">
					<Mail className="w-3.5 h-3.5" aria-hidden="true" />
					{authUser?.email ?? t("profile.noEmail", "—")}
				</p>
			</section>

			<section className="px-6 pt-6 profile-fade">
				<div
					className="rounded-2xl border p-5"
					style={{
						background: `linear-gradient(135deg, ${tierMeta.colorPrimary}1a, #040b16)`,
						borderColor: `${tierMeta.colorPrimary}55`,
						boxShadow: `0 10px 30px ${tierMeta.colorPrimary}33`,
					}}
				>
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center gap-2">
							<Sparkles
								className="w-4 h-4"
								style={{ color: tierMeta.colorPrimary }}
								aria-hidden="true"
							/>
							<span
								className="text-xs font-black uppercase tracking-widest"
								style={{ color: tierMeta.colorPrimary }}
							>
								{tierMeta.emoji} {t("profile.tierLevel", "Nivel {{tier}}", {
									tier: tierMeta.displayName,
								})}
							</span>
						</div>
						<span className="text-xs text-zinc-300 font-bold tabular-nums">
							{Math.round(progress * 100)}%
						</span>
					</div>
					<div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden">
						<div
							className="h-full rounded-full"
							style={{
								width: `${Math.round(progress * 100)}%`,
								background: `linear-gradient(90deg, ${tierMeta.colorPrimary}, ${tierMeta.colorAccent})`,
								boxShadow: `0 0 12px ${tierMeta.colorPrimary}99`,
							}}
						/>
					</div>
					<div className="mt-4 flex items-center gap-4">
						<div className="flex items-center gap-2 text-cyan-300">
							<Coins className="w-4 h-4" aria-hidden="true" />
							<span className="font-black text-lg tabular-nums">{tokens}</span>
							<span className="text-[10px] text-cyan-200/60 uppercase tracking-widest font-bold">
								{t("profile.balanceLabel")}
							</span>
						</div>
						<div className="flex items-center gap-2 text-zinc-400 ml-auto">
							<span className="font-black text-sm tabular-nums">{lifetime}</span>
							<span className="text-[10px] uppercase tracking-widest font-bold">
								{t("profile.lifetimeLabel", "histórico")}
							</span>
						</div>
					</div>
				</div>
			</section>

			<section className="px-6 pt-6 profile-fade">
				<h3 className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-bold mb-2 px-1">
					{t("profile.settings")}
				</h3>
				<div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl divide-y divide-zinc-800 overflow-hidden">
					<div className="px-4 py-3 flex items-center gap-3">
						<Languages
							className="w-5 h-5 text-zinc-400"
							aria-hidden="true"
						/>
						<span className="flex-1 text-sm font-bold text-white">
							{t("profile.language")}
						</span>
						<LanguageSwitch />
					</div>
					<SettingRow icon={<Bell className="w-5 h-5" />} label={t("profile.notifications")} />
					<SettingRow icon={<Shield className="w-5 h-5" />} label={t("profile.privacy")} />
				</div>
			</section>

			<section className="px-6 pt-4 profile-fade">
				<button
					type="button"
					onClick={() => void handleLogout()}
					className="w-full h-12 rounded-2xl bg-rose-500/10 border border-rose-500/40 text-rose-300 font-black tracking-tight flex items-center justify-center gap-2 active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-rose-400"
				>
					<LogOut className="w-4 h-4" aria-hidden="true" />
					{t("hub.logout")}
				</button>
			</section>
		</div>
	);
}

function SettingRow({
	icon,
	label,
}: {
	icon: React.ReactNode;
	label: string;
}) {
	return (
		<button
			type="button"
			className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-zinc-800/40 transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:rounded-2xl"
		>
			<span className="text-zinc-400" aria-hidden="true">
				{icon}
			</span>
			<span className="flex-1 text-sm font-bold text-white">{label}</span>
			<ChevronRight
				className="w-4 h-4 text-zinc-600"
				aria-hidden="true"
			/>
		</button>
	);
}
