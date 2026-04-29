import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Beer, RotateCcw, Sparkles } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { TokenBadge } from "../components/TokenBadge";
import { cn } from "../lib/utils";

const SECTOR_COLORS = [
	"#39FF14",
	"#7DF9FF",
	"#FFD700",
	"#FF3CAC",
	"#9D4EDD",
	"#FF7A00",
];

export function RuletaRondas() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);
	const friends = useGameState((s) => s.friends);
	const setFriends = useGameState((s) => s.setFriends);

	const containerRef = useRef<HTMLDivElement>(null);
	const wheelRef = useRef<SVGSVGElement>(null);
	const loserRef = useRef<HTMLDivElement>(null);

	const [spinning, setSpinning] = useState(false);
	const [loserIndex, setLoserIndex] = useState<number | null>(null);
	const totalRotationRef = useRef(0);

	useGSAP(
		() => {
			gsap.from(".rul-fade", {
				y: 18,
				opacity: 0,
				stagger: 0.07,
				duration: 0.5,
				ease: "power3.out",
			});
		},
		{ scope: containerRef },
	);

	const updateName = (i: number, value: string) => {
		const next = [...friends];
		next[i] = value;
		setFriends(next);
	};

	const handleSpin = () => {
		if (spinning || !wheelRef.current) return;
		const validFriends = friends.filter((f) => f.trim().length > 0);
		if (validFriends.length < 2) return;

		setSpinning(true);
		setLoserIndex(null);

		const sectorCount = friends.length;
		const sectorAngle = 360 / sectorCount;
		const targetIndex = Math.floor(Math.random() * sectorCount);
		const baseTurns = 6 + Math.floor(Math.random() * 3);

		const currentRot = totalRotationRef.current;
		const sectorMid = targetIndex * sectorAngle + sectorAngle / 2;
		const targetRot = baseTurns * 360 + (360 - sectorMid);
		const finalRotation = currentRot + targetRot;

		gsap.to(wheelRef.current, {
			rotation: finalRotation,
			duration: 5.5,
			ease: "power4.out",
			transformOrigin: "50% 50%",
			onComplete: () => {
				totalRotationRef.current = finalRotation;
				setLoserIndex(targetIndex);
				setSpinning(false);
				if (loserRef.current) {
					gsap.fromTo(
						loserRef.current,
						{ scale: 0.6, opacity: 0 },
						{
							scale: 1,
							opacity: 1,
							duration: 0.5,
							ease: "back.out(1.8)",
						},
					);
					gsap.to(loserRef.current.querySelector(".loser-name"), {
						opacity: 0.3,
						duration: 0.5,
						yoyo: true,
						repeat: -1,
						ease: "sine.inOut",
					});
				}
			},
		});
	};

	const reset = () => {
		setLoserIndex(null);
		if (loserRef.current) gsap.killTweensOf(loserRef.current.querySelector(".loser-name"));
	};

	const sectorAngle = 360 / friends.length;
	const radius = 130;
	const cx = 150;
	const cy = 150;

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col relative z-20 h-full overflow-y-auto no-scrollbar bg-black"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-2 flex items-center justify-between rul-fade">
				<button
					type="button"
					onClick={() => setScreen("hub")}
					aria-label={t("common.back")}
					className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					<ArrowLeft className="w-4 h-4" aria-hidden="true" />
				</button>
				<div className="text-center">
					<p className="text-[10px] uppercase tracking-[0.3em] text-lime-400 font-bold">
						{t("ruleta.miniGame")}
					</p>
					<h1 className="text-base font-black italic tracking-tight text-white">
						{t("ruleta.title")}
					</h1>
				</div>
				<TokenBadge />
			</header>

			<section className="px-6 pt-3 pb-2 rul-fade">
				<p className="text-zinc-400 text-sm text-center">
					{t("ruleta.instructions")}
				</p>
			</section>

			<section className="px-6 pt-4 pb-2 grid grid-cols-2 gap-2 rul-fade">
				{friends.map((name, i) => (
					<input
						key={i}
						type="text"
						value={name}
						onChange={(e) => updateName(i, e.target.value)}
						maxLength={16}
						placeholder={t("ruleta.friend", { n: i + 1 })}
						aria-label={t("ruleta.friendName", { n: i + 1 })}
						className={cn(
							"h-11 rounded-xl bg-zinc-900/80 border px-3 text-sm font-bold text-white placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400",
							loserIndex === i
								? "border-red-500 text-red-400"
								: "border-zinc-800",
						)}
						disabled={spinning}
					/>
				))}
			</section>

			<main className="flex-1 flex flex-col items-center justify-center px-6 py-4 relative">
				<div className="relative w-[320px] h-[320px] flex items-center justify-center">
					<div className="absolute inset-0 rounded-full bg-lime-500/20 blur-3xl pointer-events-none" />
					<div className="absolute inset-0 rounded-full border border-lime-500/30 shadow-[0_0_45px_rgba(57,255,20,0.45)]" />
					<svg
						ref={wheelRef}
						viewBox="0 0 300 300"
						className="w-[300px] h-[300px] drop-shadow-[0_0_30px_rgba(125,249,255,0.45)]"
						style={{ transform: "rotate(0deg)" }}
						aria-label={t("ruleta.wheelLabel")}
					>
						<defs>
							<filter id="neonShadow" x="-50%" y="-50%" width="200%" height="200%">
								<feGaussianBlur stdDeviation="3" result="blur" />
								<feMerge>
									<feMergeNode in="blur" />
									<feMergeNode in="SourceGraphic" />
								</feMerge>
							</filter>
						</defs>
						{friends.map((name, i) => {
							const startAngle = i * sectorAngle - 90;
							const endAngle = (i + 1) * sectorAngle - 90;
							const start = polarPoint(cx, cy, radius, startAngle);
							const end = polarPoint(cx, cy, radius, endAngle);
							const largeArc = sectorAngle > 180 ? 1 : 0;
							const path = `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
							const labelAngle = startAngle + sectorAngle / 2;
							const labelPoint = polarPoint(cx, cy, radius * 0.65, labelAngle);
							const color = SECTOR_COLORS[i % SECTOR_COLORS.length];
							return (
								<g key={i}>
									<path
										d={path}
										fill={color}
										fillOpacity={0.18}
										stroke={color}
										strokeWidth={2}
									/>
									<text
										x={labelPoint.x}
										y={labelPoint.y}
										textAnchor="middle"
										dominantBaseline="middle"
										fontSize="14"
										fontWeight="900"
										fill={color}
										transform={`rotate(${labelAngle + 90} ${labelPoint.x} ${labelPoint.y})`}
										filter="url(#neonShadow)"
									>
										{(name || `?`).slice(0, 10)}
									</text>
								</g>
							);
						})}
						<circle
							cx={cx}
							cy={cy}
							r={28}
							fill="#0a0a0a"
							stroke="#39FF14"
							strokeWidth={2}
						/>
					</svg>

					<div
						className="absolute top-2 left-1/2 -translate-x-1/2 w-0 h-0 z-10"
						style={{
							borderLeft: "12px solid transparent",
							borderRight: "12px solid transparent",
							borderTop: "22px solid #39FF14",
							filter: "drop-shadow(0 0 8px #39FF14)",
						}}
						aria-hidden="true"
					/>
				</div>

				{loserIndex !== null && (
					<div
						ref={loserRef}
						className="mt-6 text-center"
						aria-live="polite"
					>
						<p className="text-[10px] uppercase tracking-[0.3em] text-red-400 font-bold">
							{t("ruleta.todayPays")}
						</p>
						<p
							className="loser-name text-3xl font-black italic tracking-tight text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,0.7)]"
						>
							{friends[loserIndex] || t("ruleta.friend", { n: loserIndex + 1 })}
						</p>
					</div>
				)}
			</main>

			<footer className="px-6 pb-8 pt-2 flex flex-col gap-3 rul-fade">
				{loserIndex !== null ? (
					<>
						<button
							type="button"
							className="h-14 rounded-2xl bg-linear-to-r from-red-500 to-rose-600 text-white font-black tracking-tight flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(239,68,68,0.5)] active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-red-400"
						>
							<Beer className="w-5 h-5" aria-hidden="true" />
							{t("ruleta.payRound")}
						</button>
						<button
							type="button"
							onClick={reset}
							className="h-12 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-300 font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400"
						>
							<RotateCcw className="w-4 h-4" aria-hidden="true" />
							{t("ruleta.anotherRound")}
						</button>
					</>
				) : (
					<button
						type="button"
						onClick={handleSpin}
						disabled={spinning}
						className={cn(
							"h-14 rounded-2xl bg-linear-to-r from-lime-400 to-emerald-500 text-black font-black tracking-tight flex items-center justify-center gap-2 active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-lime-400",
							spinning
								? "opacity-50 cursor-not-allowed"
								: "shadow-[0_0_30px_rgba(57,255,20,0.55)]",
						)}
					>
						<Sparkles className="w-5 h-5 fill-black" aria-hidden="true" />
						{spinning ? t("ruleta.spinning") : t("ruleta.spin")}
					</button>
				)}
			</footer>
		</div>
	);
}

function polarPoint(cx: number, cy: number, r: number, angleDeg: number) {
	const rad = (angleDeg * Math.PI) / 180;
	return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
