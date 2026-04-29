import { useRef } from "react";
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
import { LanguageSwitch } from "../components/LanguageSwitch";

export function Profile() {
	const { t } = useTranslation();
	const profile = useGameState((s) => s.profile);
	const tokens = useGameState((s) => s.tokens);
	const setScreen = useGameState((s) => s.setScreen);
	const logout = useGameState((s) => s.logout);

	const containerRef = useRef<HTMLDivElement>(null);

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
				<div className="w-24 h-24 rounded-full bg-linear-to-tr from-cyan-600 to-blue-500 p-1 shadow-[0_0_40px_rgba(0,212,255,0.45)]">
					<div className="w-full h-full bg-zinc-950 rounded-full flex items-center justify-center">
						<User
							className="w-12 h-12 text-cyan-400"
							aria-hidden="true"
						/>
					</div>
				</div>
				<h2 className="mt-4 text-2xl font-black italic tracking-tight text-white">
					{profile.handle}
				</h2>
				<p className="text-zinc-400 text-sm flex items-center gap-1.5 mt-1">
					<Mail className="w-3.5 h-3.5" aria-hidden="true" />
					{profile.email}
				</p>
			</section>

			<section className="px-6 pt-6 profile-fade">
				<div className="bg-linear-to-br from-[#0a192f] to-[#040b16] rounded-2xl border border-cyan-500/30 p-5 shadow-[0_10px_30px_rgba(0,240,255,0.18)]">
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center gap-2">
							<Sparkles
								className="w-4 h-4 text-amber-300"
								aria-hidden="true"
							/>
							<span className="text-amber-300 text-xs font-black uppercase tracking-widest">
								{t("profile.levelHeader", { level: profile.level })}
							</span>
						</div>
						<span className="text-xs text-cyan-200/70 font-bold">
							{profile.levelProgress}% → Nivel {profile.level + 1}
						</span>
					</div>
					<div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden">
						<div
							className="h-full bg-linear-to-r from-cyan-500 to-blue-500 rounded-full shadow-[0_0_12px_rgba(0,240,255,0.6)]"
							style={{ width: `${profile.levelProgress}%` }}
						/>
					</div>
					<div className="mt-4 flex items-center gap-2 text-cyan-300">
						<Coins className="w-4 h-4" aria-hidden="true" />
						<span className="font-black text-lg tabular-nums">{tokens}</span>
						<span className="text-xs text-cyan-200/60 uppercase tracking-widest font-bold">
							{t("profile.balanceLabel")}
						</span>
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
					onClick={logout}
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
