import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { LanguageSwitch } from "../components/LanguageSwitch";

export function Onboarding() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);
	const containerRef = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			gsap.from(".onb-bg", {
				opacity: 0,
				scale: 1.1,
				duration: 1.4,
				ease: "power2.out",
			});
			gsap.to(".onb-bg", {
				scale: 1.04,
				rotation: 1.5,
				duration: 6,
				yoyo: true,
				repeat: -1,
				ease: "sine.inOut",
			});
			gsap.from(".onb-title", {
				y: 30,
				opacity: 0,
				duration: 0.7,
				delay: 0.25,
				ease: "power3.out",
			});
			gsap.from(".onb-sub", {
				y: 20,
				opacity: 0,
				duration: 0.6,
				delay: 0.45,
				ease: "power3.out",
			});
			gsap.from(".onb-btn", {
				y: 30,
				opacity: 0,
				duration: 0.55,
				stagger: 0.1,
				delay: 0.6,
				ease: "back.out(1.4)",
			});
		},
		{ scope: containerRef },
	);

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col justify-end p-6 pb-12 relative z-20 h-full overflow-hidden bg-black"
		>
			<div className="absolute inset-0 pointer-events-none z-0">
				<div
					className="onb-bg w-full h-[60%] mt-12 bg-center bg-cover bg-no-repeat opacity-80"
					style={{
						backgroundImage: `url('https://images.unsplash.com/photo-1518811554972-31f9ca219d5b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxnbG93aW5nJTIwbmVvbiUyMGJveHxlbnwxfHx8fDE3Nzc0MDU4NDd8MA&ixlib=rb-4.1.0&q=80&w=1080')`,
						maskImage:
							"linear-gradient(to bottom, black 0%, black 60%, transparent 100%)",
						WebkitMaskImage:
							"linear-gradient(to bottom, black 0%, black 60%, transparent 100%)",
					}}
				/>
				<div className="absolute inset-0 bg-linear-to-t from-[#050505] via-[#050505]/60 to-transparent" />
			</div>

			<div className="relative z-10 flex flex-col gap-6 w-full mt-auto">
				<div className="text-center mb-4">
					<h1 className="onb-title text-4xl font-black italic tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.4)] leading-[1.1]">
						{t("onboarding.youAreIn")}
						<br />
						<span className="text-transparent bg-clip-text bg-linear-to-r from-cyan-400 to-blue-600 drop-shadow-[0_0_20px_rgba(0,240,255,0.6)]">
							{t("onboarding.jefe")}
						</span>
					</h1>

					<p className="onb-sub text-zinc-400 mt-4 text-[15px] font-medium tracking-wide">
						{t("onboarding.subtitle")}
					</p>
				</div>

				<div className="flex flex-col gap-3 w-full">
					<button
						type="button"
						onClick={() => setScreen("hub")}
						className="onb-btn w-full h-[60px] rounded-2xl bg-white text-black font-bold flex items-center justify-center gap-3 active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400"
					>
						<svg
							viewBox="0 0 24 24"
							className="w-6 h-6 fill-current"
							aria-hidden="true"
						>
							<path d="M16.365 1.579c-.646 0-1.58.423-2.128.983-.497.5-.965 1.48-.965 2.193 0 .079.015.158.015.158.746.039 1.58-.382 2.13-1.002.51-.555.932-1.551.932-2.222 0-.053-.016-.092-.016-.092-.016-.013-.016-.013.032-.017zm.996 7.67c-1.353-.062-2.583.753-3.23.753-.647 0-1.745-.724-2.887-.704-1.503.02-2.895.875-3.666 2.221-1.565 2.716-.399 6.746 1.134 8.96.745 1.082 1.624 2.28 2.802 2.238 1.127-.042 1.566-.723 2.929-.723 1.354 0 1.761.723 2.946.702 1.21-.02 1.961-1.077 2.7-2.164.856-1.252 1.209-2.464 1.226-2.528-.026-.013-2.365-.908-2.387-3.623-.021-2.264 1.849-3.35 1.942-3.414-.105-1.516-1.157-2.613-3.51-2.718z" />
						</svg>
						<span className="text-[17px] tracking-tight">
							{t("onboarding.continueApple")}
						</span>
					</button>

					<button
						type="button"
						onClick={() => setScreen("hub")}
						className="onb-btn w-full h-[60px] rounded-2xl bg-zinc-900 border border-zinc-800 text-white font-bold flex items-center justify-center gap-3 active:scale-95 transition-transform hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-cyan-400"
					>
						<svg
							viewBox="0 0 24 24"
							className="w-5 h-5"
							aria-hidden="true"
						>
							<path
								d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
								fill="#4285F4"
							/>
							<path
								d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
								fill="#34A853"
							/>
							<path
								d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
								fill="#FBBC05"
							/>
							<path
								d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
								fill="#EA4335"
							/>
						</svg>
						<span className="text-[17px] tracking-tight">
							{t("onboarding.continueGoogle")}
						</span>
					</button>

					<div className="flex justify-center pt-2">
						<LanguageSwitch />
					</div>
				</div>

				<div className="w-[120px] h-1.5 bg-zinc-800 rounded-full mx-auto mt-4 mb-2" />
			</div>
		</div>
	);
}
