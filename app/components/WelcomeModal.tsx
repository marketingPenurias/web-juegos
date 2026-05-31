import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Coins } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";

/**
 * WelcomeModal — celebración ONE-SHOT del registro (+100 tokens del JIT).
 *
 *   Se muestra SOLO cuando `/api/session` marcó `is_new_user` (el perfil
 *   se acaba de crear en BD con su bonus de bienvenida) y aún no se ha
 *   visto (`welcomeSeen`, persistido).  Al cerrar, `dismissWelcome()`
 *   marca el flag para que no reaparezca en cada recarga.
 *
 *   El importe se lee de la economía (`rewardRules.signup_bonus`) con
 *   fallback a 100 — cero números hardcoded que diverjan de la BD.
 */

export function WelcomeModal() {
	const { t } = useTranslation();
	const isNewUser = useGameState((s) => s.isNewUser);
	const welcomeSeen = useGameState((s) => s.welcomeSeen);
	const dismissWelcome = useGameState((s) => s.dismissWelcome);
	const rewardAmount = useGameState((s) => s.rewardAmount);

	const open = isNewUser && !welcomeSeen;
	const bonus = rewardAmount("signup_bonus", 100);

	const cardRef = useRef<HTMLDivElement>(null);
	const coinRef = useRef<HTMLSpanElement>(null);

	useGSAP(
		() => {
			if (!open) return;
			gsap.fromTo(
				cardRef.current,
				{ scale: 0.6, opacity: 0, y: 30 },
				{ scale: 1, opacity: 1, y: 0, duration: 0.7, ease: "back.out(1.8)", force3D: true },
			);
			// Conteo animado de 0 → bonus para que se sienta "ganado".
			if (coinRef.current) {
				const obj = { val: 0 };
				gsap.to(obj, {
					val: bonus,
					duration: 1.1,
					delay: 0.25,
					ease: "power2.out",
					snap: { val: 1 },
					onUpdate: () => {
						if (coinRef.current) coinRef.current.textContent = String(Math.round(obj.val));
					},
				});
			}
		},
		{ dependencies: [open, bonus] },
	);

	if (!open) return null;

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={t("welcome.title", "¡Bienvenido!")}
			className="fixed inset-0 z-100 bg-black/85 backdrop-blur-md transform-gpu translate-z-0 flex items-center justify-center px-8"
		>
			<div
				ref={cardRef}
				className="w-full max-w-[340px] rounded-4xl bg-linear-to-br from-zinc-900 to-zinc-950 border border-lime-400/50 p-7 text-center shadow-[0_0_60px_rgba(57,255,20,0.4)]"
			>
				<div className="w-20 h-20 rounded-full bg-lime-500/15 border border-lime-400/50 mx-auto flex items-center justify-center mb-4">
					<Sparkles className="w-10 h-10 text-lime-300" aria-hidden="true" />
				</div>
				<p className="text-[10px] uppercase tracking-[0.3em] text-lime-400 font-bold mb-1">
					{t("welcome.tag", "Regalo de bienvenida")}
				</p>
				<h2 className="text-2xl font-black italic tracking-tight text-white mb-3">
					{t("welcome.title", "¡Bienvenido a La Pocha!")}
				</h2>
				<div className="flex items-center justify-center gap-2 my-5">
					<Coins className="w-8 h-8 text-amber-300" aria-hidden="true" />
					<span className="text-5xl font-black text-amber-300 tabular-nums drop-shadow-[0_0_20px_rgba(245,158,11,0.6)]">
						+<span ref={coinRef}>0</span>
					</span>
				</div>
				<p className="text-sm text-zinc-400 mb-6">
					{t("welcome.body", "Te hemos regalado {{n}} tokens para empezar a jugar y canjear premios en barra.", { n: bonus })}
				</p>
				<button
					type="button"
					onClick={dismissWelcome}
					className="w-full h-12 rounded-2xl bg-linear-to-r from-lime-400 to-emerald-500 text-black font-black tracking-tight active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-lime-400"
				>
					{t("welcome.cta", "¡Empezar!")}
				</button>
			</div>
		</div>
	);
}
