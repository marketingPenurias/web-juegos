import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Sparkles } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { TokenBadge } from "../components/TokenBadge";
import { PlayersPanel } from "../components/ruleta/PlayersPanel";
import { WinnerModal } from "../components/ruleta/WinnerModal";
import { cn } from "../lib/utils";

const SECTOR_COLORS = [
	"#39FF14",
	"#7DF9FF",
	"#FFD700",
	"#FF3CAC",
	"#9D4EDD",
	"#FF7A00",
	"#00E0A4",
	"#FF6B6B",
];

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
// Keep landing well inside a sector — never on the seam between two.
const SAFE_JITTER = 0.32;

export function RuletaRondas() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);
	const friends = useGameState((s) => s.friends);
	const setFriends = useGameState((s) => s.setFriends);

	const containerRef = useRef<HTMLDivElement>(null);
	const wheelRef = useRef<SVGSVGElement>(null);
	const totalRotationRef = useRef(0);

	const [spinning, setSpinning] = useState(false);
	const [loserIndex, setLoserIndex] = useState<number | null>(null);

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

	const addPlayer = () => {
		if (friends.length >= MAX_PLAYERS) return;
		setFriends([...friends, ""]);
		setLoserIndex(null);
	};

	const removePlayer = () => {
		if (friends.length <= MIN_PLAYERS) return;
		setFriends(friends.slice(0, -1));
		setLoserIndex(null);
	};

	const handleSpin = () => {
		if (spinning || !wheelRef.current) return;
		const validFriends = friends.filter((f) => f.trim().length > 0);
		if (validFriends.length < MIN_PLAYERS) return;

		setSpinning(true);
		setLoserIndex(null);

		const sectorCount = friends.length;
		const sectorAngle = 360 / sectorCount;
		const targetIndex = Math.floor(Math.random() * sectorCount);
		const baseTurns = 6 + Math.floor(Math.random() * 3);

		const jitter = (Math.random() * 2 - 1) * SAFE_JITTER * sectorAngle;
		const sectorMid = targetIndex * sectorAngle + sectorAngle / 2 + jitter;

		const currentRot = totalRotationRef.current;
		const targetRot = baseTurns * 360 + (360 - sectorMid);
		const finalRotation = currentRot + targetRot;

		gsap.to(wheelRef.current, {
			rotation: finalRotation,
			duration: 5.5,
			ease: "power4.out",
			transformOrigin: "50% 50%",
			force3D: true,
			onComplete: () => {
				totalRotationRef.current = finalRotation;
				setLoserIndex(targetIndex);
				setSpinning(false);
			},
		});
	};

	const reset = () => {
		setLoserIndex(null);
	};

	const exit = () => {
		setLoserIndex(null);
		setScreen("hub");
	};

	const sectorAngle = 360 / friends.length;
	const radius = 130;
	const cx = 150;
	const cy = 150;

	const loserName =
		loserIndex !== null
			? friends[loserIndex] || t("ruleta.friend", { n: loserIndex + 1 })
			: "";

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col relative z-20 min-h-0 overflow-hidden bg-black"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-2 flex items-center justify-between rul-fade shrink-0">
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

			<PlayersPanel
				friends={friends}
				onChange={updateName}
				onAdd={addPlayer}
				onRemove={removePlayer}
				loserIndex={loserIndex}
				disabled={spinning}
			/>

			<main className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-2 relative overflow-y-auto no-scrollbar">
				<div className="relative w-[300px] h-[300px] flex items-center justify-center">
					<div className="absolute inset-0 rounded-full bg-lime-500/20 blur-3xl pointer-events-none" />
					<div className="absolute inset-0 rounded-full border border-lime-500/30 shadow-[0_0_45px_rgba(57,255,20,0.45)]" />
					<svg
						ref={wheelRef}
						viewBox="0 0 300 300"
						className="w-[280px] h-[280px] drop-shadow-[0_0_30px_rgba(125,249,255,0.45)] will-change-transform"
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
										fontSize={friends.length > 6 ? 11 : 13}
										fontWeight="900"
										fill={color}
										transform={`rotate(${labelAngle + 90} ${labelPoint.x} ${labelPoint.y})`}
										filter="url(#neonShadow)"
									>
										{(name || `?`).slice(0, friends.length > 6 ? 8 : 10)}
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
			</main>

			<footer className="px-6 pb-3 pt-2 rul-fade shrink-0">
				<button
					type="button"
					onClick={handleSpin}
					disabled={spinning}
					className={cn(
						"h-14 w-full rounded-2xl bg-linear-to-r from-lime-400 to-emerald-500 text-black font-black tracking-tight flex items-center justify-center gap-2 active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-lime-400",
						spinning
							? "opacity-50 cursor-not-allowed"
							: "shadow-[0_0_30px_rgba(57,255,20,0.55)]",
					)}
				>
					<Sparkles className="w-5 h-5 fill-black" aria-hidden="true" />
					{spinning ? t("ruleta.spinning") : t("ruleta.spin")}
				</button>
			</footer>

			{loserIndex !== null && (
				<WinnerModal
					loserName={loserName}
					onAnotherRound={reset}
					onExit={exit}
				/>
			)}
		</div>
	);
}

function polarPoint(cx: number, cy: number, r: number, angleDeg: number) {
	const rad = (angleDeg * Math.PI) / 180;
	return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
