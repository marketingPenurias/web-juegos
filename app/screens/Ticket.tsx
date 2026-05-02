import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Coins, Flame, ShieldCheck, Ticket as TicketIcon } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { cn } from "../lib/utils";

const HOLD_MS = 2000;

export function Ticket() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);
	const ticket = useGameState((s) => s.activeTicket);
	const redeemTicket = useGameState((s) => s.redeemTicket);
	const clearTicket = useGameState((s) => s.clearTicket);

	const containerRef = useRef<HTMLDivElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const waveRef = useRef<HTMLDivElement>(null);
	const codeRef = useRef<HTMLDivElement>(null);
	const burnFillRef = useRef<HTMLDivElement>(null);
	const burnTweenRef = useRef<gsap.core.Tween | null>(null);

	const [burning, setBurning] = useState(false);
	const status = ticket?.status ?? "active";

	useGSAP(
		() => {
			if (!ticket) return;
			gsap.from(".tk-fade", {
				y: 18,
				opacity: 0,
				stagger: 0.07,
				duration: 0.5,
				ease: "power3.out",
			});

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
					opacity: 0.55,
					duration: 0.8,
					yoyo: true,
					repeat: -1,
					ease: "sine.inOut",
				});
			}
			if (cardRef.current) {
				gsap.to(cardRef.current, {
					boxShadow:
						"0 0 80px rgba(57,255,20,0.55), 0 0 30px rgba(57,255,20,0.25)",
					duration: 1.6,
					yoyo: true,
					repeat: -1,
					ease: "sine.inOut",
				});
			}
		},
		{ scope: containerRef, dependencies: [ticket?.id, status] },
	);

	if (!ticket) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center px-6 text-center bg-black">
				<TicketIcon
					className="w-12 h-12 text-zinc-700 mb-4"
					aria-hidden="true"
				/>
				<h2 className="text-xl font-black text-white">{t("ticket.noTicket")}</h2>
				<p className="text-sm text-zinc-500 mt-1 max-w-xs">
					{t("ticket.noTicketSub")}
				</p>
				<button
					type="button"
					onClick={() => setScreen("menu")}
					className="mt-6 h-12 px-6 rounded-2xl bg-cyan-500 text-black font-black active:scale-95 transition-transform"
				>
					{t("ticket.goToMenu")}
				</button>
			</div>
		);
	}

	const startHold = () => {
		if (status === "redeemed" || burning) return;
		setBurning(true);
		if (burnFillRef.current) {
			gsap.set(burnFillRef.current, { scaleX: 0 });
			burnTweenRef.current = gsap.to(burnFillRef.current, {
				scaleX: 1,
				duration: HOLD_MS / 1000,
				ease: "none",
				force3D: true,
				onComplete: completeBurn,
			});
		}
	};

	const cancelHold = () => {
		if (status === "redeemed") return;
		setBurning(false);
		if (burnTweenRef.current) {
			burnTweenRef.current.kill();
			burnTweenRef.current = null;
		}
		if (burnFillRef.current) {
			gsap.to(burnFillRef.current, {
				scaleX: 0,
				duration: 0.3,
				ease: "power2.out",
				force3D: true,
			});
		}
	};

	const completeBurn = () => {
		setBurning(false);
		if (!cardRef.current) {
			redeemTicket();
			return;
		}
		gsap.killTweensOf(cardRef.current);
		const tl = gsap.timeline({
			onComplete: () => {
				redeemTicket();
			},
		});
		tl.to(cardRef.current, {
			scale: 1.04,
			duration: 0.15,
			ease: "power2.out",
		})
			.to(cardRef.current, {
				rotation: -3,
				yPercent: -2,
				duration: 0.15,
				ease: "power2.in",
			})
			.to(cardRef.current, {
				scaleY: 0.05,
				yPercent: 30,
				rotation: 0,
				opacity: 0,
				filter: "blur(8px)",
				duration: 0.7,
				ease: "power3.in",
			});
	};

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col relative z-20 min-h-0 overflow-hidden bg-black"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-2 flex items-center justify-between tk-fade shrink-0">
				<button
					type="button"
					onClick={() => setScreen("menu")}
					aria-label={t("ticket.backToMenu")}
					className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					<ArrowLeft className="w-4 h-4" aria-hidden="true" />
				</button>
				<div className="text-center">
					<p className="text-[10px] uppercase tracking-[0.3em] text-lime-400 font-bold">
						{t("ticket.active")}
					</p>
					<h1 className="text-base font-black italic tracking-tight text-white">
						{t("ticket.barPass")}
					</h1>
				</div>
				<div className="w-9 h-9" />
			</header>

			<main className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 py-4 flex flex-col items-center justify-center">
				<div
					ref={cardRef}
					className={cn(
						"tk-fade relative w-full max-w-[340px] rounded-[28px] overflow-hidden border bg-linear-to-br from-zinc-950 via-emerald-950/40 to-zinc-950 p-6 text-center",
						status === "redeemed"
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

					<div className="relative z-10">
						<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-lime-500/15 border border-lime-400/40 mb-4">
							<ShieldCheck
								className="w-3.5 h-3.5 text-lime-300"
								aria-hidden="true"
							/>
							<span className="text-[10px] font-black tracking-widest text-lime-300 uppercase">
								{status === "redeemed" ? t("ticket.redeemed") : t("ticket.verified")}
							</span>
						</div>

						<p className="text-[11px] uppercase tracking-[0.3em] text-zinc-500 font-bold">
							{t("ticket.order")}
						</p>
						<h2 className="text-2xl font-black italic tracking-tight text-white mt-1 mb-3 leading-tight">
							{ticket.itemName}
						</h2>

						<div className="flex items-center justify-center gap-2 text-amber-300 font-black text-sm mb-4">
							<Coins className="w-4 h-4" aria-hidden="true" />
							{t("ticket.priceLine", { n: ticket.priceTokens })}
						</div>

						<div
							ref={codeRef}
							className="font-mono text-2xl tracking-[0.4em] text-white py-3 border-y border-dashed border-zinc-700"
						>
							{ticket.id.toUpperCase().slice(-6)}
						</div>

						<p className="text-[10px] text-zinc-500 mt-3 leading-relaxed">
							{t("ticket.screenshotWarning")}
						</p>
					</div>
				</div>

				{status === "redeemed" && (
					<div className="mt-8 text-center">
						<div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900 border border-zinc-700">
							<Flame
								className="w-4 h-4 text-orange-400"
								aria-hidden="true"
							/>
							<span className="text-sm font-black tracking-widest text-zinc-300 uppercase">
								{t("ticket.redeemedBig")}
							</span>
						</div>
						<p className="text-xs text-zinc-500 mt-3">
							{t("ticket.enjoy")}
						</p>
					</div>
				)}
			</main>

			<footer className="px-6 pb-8 pt-2 tk-fade shrink-0">
				{status === "active" ? (
					<button
						type="button"
						onPointerDown={startHold}
						onPointerUp={cancelHold}
						onPointerLeave={cancelHold}
						onPointerCancel={cancelHold}
						aria-label={t("ticket.holdToBurn")}
						className="relative w-full h-16 rounded-2xl bg-zinc-900 border border-zinc-700 overflow-hidden flex items-center justify-center select-none active:scale-[0.99] transition-transform focus-visible:ring-2 focus-visible:ring-orange-400"
					>
						<div
							ref={burnFillRef}
							className="absolute top-0 left-0 h-full w-full bg-linear-to-r from-orange-600 via-red-500 to-amber-400 shadow-[0_0_25px_rgba(249,115,22,0.6)] will-change-transform"
							style={{ transformOrigin: "left center", transform: "scaleX(0)" }}
							aria-hidden="true"
						/>
						<span
							className={cn(
								"relative z-10 font-black tracking-tight flex items-center gap-2",
								burning ? "text-white" : "text-zinc-300",
							)}
						>
							<Flame className="w-5 h-5" aria-hidden="true" />
							{burning ? t("ticket.burning") : t("ticket.holdToBurn")}
						</span>
					</button>
				) : (
					<button
						type="button"
						onClick={() => {
							clearTicket();
							setScreen("hub");
						}}
						className="w-full h-14 rounded-2xl bg-white text-black font-black tracking-tight active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400"
					>
						{t("ticket.returnHub")}
					</button>
				)}
			</footer>
		</div>
	);
}
