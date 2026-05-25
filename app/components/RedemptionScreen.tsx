import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flame, ShieldCheck, Timer, X } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { cn } from "../lib/utils";

/**
 * RedemptionScreen — the "Self-Redemption Visual" anti-screenshot UI.
 *
 *  - Lives as a full-screen overlay on top of the running app.
 *  - Counts down from 5:00 (configurable via `expiresAt`) to 0:00.
 *  - A continuous, looping GSAP wave + a pulsating short-code field
 *    make any screenshot obviously stale (animations don't capture).
 *  - When the timer hits zero, the parent's `onExpire` fires and the
 *    overlay tears itself down.
 *
 *  The short code is generated client-side from `rewardId` so the
 *  bartender's eye can compare it against the staff panel without us
 *  needing a separate fetch.
 */

type Props = {
	rewardId: string;
	productName: string;
	expiresAt: string; // ISO-8601 timestamp returned by start_reward_redemption
	onExpire: () => void;
	onClose?: () => void;
};

const SHORT_CODE_RE = /[^A-Z0-9]/g;

function shortCodeFor(uuid: string): string {
	const cleaned = uuid.toUpperCase().replace(SHORT_CODE_RE, "");
	// 6 visible chars; the tail is the most "random" part of a UUID v4.
	return cleaned.slice(-6) || "------";
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

export function RedemptionScreen({
	rewardId,
	productName,
	expiresAt,
	onExpire,
	onClose,
}: Props) {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement>(null);
	const waveRef = useRef<HTMLDivElement>(null);
	const codeRef = useRef<HTMLDivElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const ringRef = useRef<HTMLDivElement>(null);

	const code = useMemo(() => shortCodeFor(rewardId), [rewardId]);
	const expiresAtMs = useMemo(
		() => new Date(expiresAt).getTime(),
		[expiresAt],
	);

	const [remaining, setRemaining] = useState(() =>
		Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)),
	);

	useEffect(() => {
		const tick = () => {
			const next = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
			setRemaining(next);
			if (next === 0) onExpire();
		};
		tick();
		const id = window.setInterval(tick, 250); // 4 Hz keeps the clock honest
		return () => window.clearInterval(id);
	}, [expiresAtMs, onExpire]);

	useGSAP(
		() => {
			gsap.fromTo(
				containerRef.current,
				{ opacity: 0 },
				{ opacity: 1, duration: 0.3, ease: "power2.out", force3D: true },
			);
			gsap.fromTo(
				cardRef.current,
				{ scale: 0.85, opacity: 0, y: 24 },
				{
					scale: 1,
					opacity: 1,
					y: 0,
					duration: 0.55,
					ease: "back.out(1.6)",
					force3D: true,
				},
			);
			// Continuous wave — exactly the same trick as the Ticket screen.
			if (waveRef.current) {
				gsap.to(waveRef.current, {
					backgroundPosition: "200% 0",
					duration: 2.4,
					repeat: -1,
					ease: "none",
				});
			}
			if (codeRef.current) {
				gsap.to(codeRef.current, {
					opacity: 0.45,
					duration: 0.8,
					yoyo: true,
					repeat: -1,
					ease: "sine.inOut",
				});
			}
			if (ringRef.current) {
				gsap.to(ringRef.current, {
					rotation: 360,
					duration: 18,
					repeat: -1,
					ease: "none",
					force3D: true,
				});
			}
		},
		{ scope: containerRef },
	);

	const minutes = Math.floor(remaining / 60);
	const seconds = remaining % 60;
	const expired = remaining === 0;

	return (
		<div
			ref={containerRef}
			role="dialog"
			aria-modal="true"
			aria-label={t("redemption.title")}
			className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md transform-gpu translate-z-0 flex items-center justify-center px-6"
		>
			{onClose && (
				<button
					type="button"
					onClick={onClose}
					aria-label={t("common.close")}
					className="absolute top-4 right-4 w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					<X className="w-4 h-4" aria-hidden="true" />
				</button>
			)}

			<div
				ref={cardRef}
				className={cn(
					"relative w-full max-w-[340px] rounded-[28px] overflow-hidden border bg-linear-to-br from-zinc-950 via-emerald-950/40 to-zinc-950 p-6 text-center will-change-transform",
					expired
						? "border-zinc-700 grayscale"
						: "border-lime-500/60 shadow-[0_0_60px_rgba(57,255,20,0.35)]",
				)}
			>
				<div
					ref={waveRef}
					className="absolute inset-0 pointer-events-none opacity-30"
					style={{
						background:
							"linear-gradient(120deg, transparent 0%, rgba(57,255,20,0.35) 40%, transparent 80%)",
						backgroundSize: "200% 100%",
					}}
					aria-hidden="true"
				/>
				<div
					ref={ringRef}
					className="absolute -inset-1 rounded-[32px] pointer-events-none will-change-transform"
					style={{
						background:
							"conic-gradient(from 0deg, transparent 0%, rgba(57,255,20,0.45) 30%, transparent 60%)",
						maskImage:
							"radial-gradient(circle, transparent 67%, black 70%)",
						WebkitMaskImage:
							"radial-gradient(circle, transparent 67%, black 70%)",
					}}
					aria-hidden="true"
				/>

				<div className="relative z-10">
					<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-lime-500/15 border border-lime-400/40 mb-4">
						<ShieldCheck
							className="w-3.5 h-3.5 text-lime-300"
							aria-hidden="true"
						/>
						<span className="text-[10px] font-black tracking-widest text-lime-300 uppercase">
							{expired ? t("redemption.expired") : t("redemption.verified")}
						</span>
					</div>

					<p className="text-[11px] uppercase tracking-[0.3em] text-zinc-500 font-bold">
						{t("redemption.redeeming")}
					</p>
					<h2 className="text-2xl font-black italic tracking-tight text-white mt-1 mb-4 leading-tight">
						{productName}
					</h2>

					<div className="flex items-center justify-center gap-2 text-amber-300 font-black mb-4">
						<Timer className="w-4 h-4" aria-hidden="true" />
						<span className="font-mono text-2xl tabular-nums">
							{pad(minutes)}:{pad(seconds)}
						</span>
					</div>

					<div
						ref={codeRef}
						className="font-mono text-2xl tracking-[0.4em] text-white py-3 border-y border-dashed border-zinc-700"
					>
						{code}
					</div>

					<p className="text-[10px] text-zinc-500 mt-3 leading-relaxed">
						{t("redemption.screenshotWarning")}
					</p>

					{expired && (
						<div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/40">
							<Flame
								className="w-3.5 h-3.5 text-rose-300"
								aria-hidden="true"
							/>
							<span className="text-[10px] font-black tracking-widest text-rose-200 uppercase">
								{t("redemption.expiredAction")}
							</span>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
