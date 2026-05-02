import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Beer, RotateCcw, Skull, X } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";

type Props = {
	loserName: string;
	onAnotherRound: () => void;
	onExit: () => void;
};

export function WinnerModal({ loserName, onAnotherRound, onExit }: Props) {
	const { t } = useTranslation();
	const overlayRef = useRef<HTMLDivElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const nameRef = useRef<HTMLParagraphElement>(null);

	useGSAP(
		() => {
			gsap.fromTo(
				overlayRef.current,
				{ opacity: 0 },
				{ opacity: 1, duration: 0.25, ease: "power2.out" },
			);
			gsap.fromTo(
				cardRef.current,
				{ scale: 0.6, opacity: 0, y: 30 },
				{
					scale: 1,
					opacity: 1,
					y: 0,
					duration: 0.55,
					ease: "back.out(1.6)",
				},
			);
			if (nameRef.current) {
				gsap.to(nameRef.current, {
					opacity: 0.35,
					duration: 0.55,
					yoyo: true,
					repeat: -1,
					ease: "sine.inOut",
				});
			}
		},
		{ dependencies: [] },
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onExit();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onExit]);

	return (
		<div
			ref={overlayRef}
			role="dialog"
			aria-modal="true"
			aria-labelledby="winner-title"
			className="fixed inset-0 z-90 bg-black/75 backdrop-blur-md transform-gpu translate-z-0 flex items-center justify-center px-6"
			onClick={onExit}
		>
			<div
				ref={cardRef}
				className="relative w-full max-w-[340px] rounded-[28px] border border-red-500/60 bg-linear-to-br from-zinc-950 via-rose-950/40 to-zinc-950 p-6 text-center shadow-[0_0_60px_rgba(239,68,68,0.45)]"
				onClick={(e) => e.stopPropagation()}
			>
				<button
					type="button"
					onClick={onExit}
					aria-label={t("common.close")}
					className="absolute top-3 right-3 w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					<X className="w-4 h-4" aria-hidden="true" />
				</button>

				<div className="w-16 h-16 rounded-full bg-red-500/15 border border-red-500/50 mx-auto flex items-center justify-center mb-4 shadow-[0_0_25px_rgba(239,68,68,0.45)]">
					<Skull className="w-8 h-8 text-red-300" aria-hidden="true" />
				</div>

				<p
					id="winner-title"
					className="text-[10px] uppercase tracking-[0.3em] text-red-400 font-bold"
				>
					{t("ruleta.todayPays")}
				</p>
				<p
					ref={nameRef}
					className="mt-2 text-3xl font-black italic tracking-tight text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,0.7)]"
					aria-live="polite"
				>
					{loserName}
				</p>

				<div className="mt-6 flex flex-col gap-3">
					<button
						type="button"
						className="h-12 rounded-2xl bg-linear-to-r from-red-500 to-rose-600 text-white font-black tracking-tight flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(239,68,68,0.5)] active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-red-400"
					>
						<Beer className="w-5 h-5" aria-hidden="true" />
						{t("ruleta.payRound")}
					</button>
					<div className="grid grid-cols-2 gap-2">
						<button
							type="button"
							onClick={onAnotherRound}
							className="h-11 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-200 font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400"
						>
							<RotateCcw className="w-4 h-4" aria-hidden="true" />
							{t("ruleta.anotherRound")}
						</button>
						<button
							type="button"
							onClick={onExit}
							className="h-11 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-300 font-bold flex items-center justify-center focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-95 transition-transform"
						>
							{t("ruleta.exit")}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
