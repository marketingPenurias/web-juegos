import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Heart, X, Music2, ArrowLeft, Sparkles } from "lucide-react";
import { Draggable, gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { TokenBadge } from "../components/TokenBadge";
import { cn } from "../lib/utils";

const SWIPE_THRESHOLD = 100;

type SongCard = {
	id: string;
	title: string;
	artist: string;
	cover: string;
	gradient: string;
};

const DECK: SongCard[] = [
	{
		id: "1",
		title: "Tu Cara Bonita",
		artist: "Estopa",
		cover:
			"https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=800&q=80",
		gradient: "from-pink-600 via-rose-500 to-orange-500",
	},
	{
		id: "2",
		title: "Zapatillas",
		artist: "El Canto del Loco",
		cover:
			"https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=80",
		gradient: "from-cyan-600 via-blue-500 to-indigo-600",
	},
	{
		id: "3",
		title: "Niño Soldado",
		artist: "Ska-P",
		cover:
			"https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=800&q=80",
		gradient: "from-lime-500 via-emerald-500 to-teal-600",
	},
	{
		id: "4",
		title: "Insurrección",
		artist: "El Último de la Fila",
		cover:
			"https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80",
		gradient: "from-amber-500 via-orange-500 to-red-600",
	},
	{
		id: "5",
		title: "Bombay",
		artist: "El Arrebato",
		cover:
			"https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=800&q=80",
		gradient: "from-purple-600 via-fuchsia-500 to-pink-500",
	},
];

const REWARD = 20;
const REQUIRED = 5;

export function TinderMusical() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);
	const addTokens = useGameState((s) => s.addTokens);

	const containerRef = useRef<HTMLDivElement>(null);
	const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
	const successRef = useRef<HTMLDivElement>(null);

	const [index, setIndex] = useState(0);
	const [stats, setStats] = useState({ likes: 0, dislikes: 0 });
	const [done, setDone] = useState(false);
	const animatingRef = useRef(false);

	useGSAP(
		() => {
			gsap.from(".tm-fade", {
				y: 18,
				opacity: 0,
				stagger: 0.07,
				duration: 0.5,
				ease: "power3.out",
			});
			gsap.set(".tm-card", {
				transformOrigin: "center bottom",
			});
			cardRefs.current.forEach((card, i) => {
				if (!card) return;
				const offset = i;
				gsap.set(card, {
					y: offset * 14,
					scale: 1 - offset * 0.05,
					opacity: i < 3 ? 1 : 0,
				});
			});
		},
		{ scope: containerRef, dependencies: [] },
	);

	const restackBelow = () => {
		cardRefs.current.forEach((card, i) => {
			if (!card) return;
			const offset = i - (index + 1);
			if (offset < 0) return;
			gsap.to(card, {
				y: offset * 14,
				scale: 1 - offset * 0.05,
				opacity: offset < 3 ? 1 : 0,
				duration: 0.4,
				ease: "power3.out",
			});
		});
	};

	const handleSwipe = (dir: "like" | "dislike") => {
		if (animatingRef.current || done) return;
		const card = cardRefs.current[index];
		if (!card) return;
		animatingRef.current = true;

		const sign = dir === "like" ? 1 : -1;
		gsap.to(card, {
			x: sign * 520,
			y: -40,
			rotation: sign * 22,
			opacity: 0,
			duration: 0.55,
			ease: "power3.in",
			force3D: true,
			onComplete: () => {
				const next = index + 1;
				const nextStats = {
					likes: stats.likes + (dir === "like" ? 1 : 0),
					dislikes: stats.dislikes + (dir === "dislike" ? 1 : 0),
				};
				setStats(nextStats);
				if (next >= REQUIRED) {
					setDone(true);
					addTokens(REWARD, "history.tx_tinder");
					gsap.fromTo(
						successRef.current,
						{ opacity: 0, scale: 0.6 },
						{
							opacity: 1,
							scale: 1,
							duration: 0.6,
							ease: "back.out(1.8)",
							force3D: true,
							onComplete: () => {
								animatingRef.current = false;
							},
						},
					);
				} else {
					setIndex(next);
					restackBelow();
					animatingRef.current = false;
				}
			},
		});
	};

	const swipeRef = useRef(handleSwipe);
	swipeRef.current = handleSwipe;

	useGSAP(
		() => {
			const card = cardRefs.current[index];
			if (!card || done) return;

			const draggable = Draggable.create(card, {
				type: "x",
				inertia: false,
				cursor: "grab",
				activeCursor: "grabbing",
				onDrag(this: Draggable) {
					gsap.set(card, { rotation: this.x * 0.06 });
				},
				onDragEnd(this: Draggable) {
					if (Math.abs(this.x) > SWIPE_THRESHOLD) {
						swipeRef.current(this.x > 0 ? "like" : "dislike");
					} else {
						gsap.to(card, {
							x: 0,
							rotation: 0,
							duration: 0.35,
							ease: "back.out(1.4)",
							force3D: true,
						});
					}
				},
			});

			return () => {
				draggable.forEach((d) => d.kill());
			};
		},
		{ dependencies: [index, done] },
	);

	const remaining = REQUIRED - index;
	const progressPct = (index / REQUIRED) * 100;

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col relative z-20 min-h-0 overflow-hidden bg-black"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-2 flex items-center justify-between tm-fade shrink-0">
				<button
					type="button"
					onClick={() => setScreen("hub")}
					aria-label={t("tinder.returnHub")}
					className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					<ArrowLeft className="w-4 h-4" aria-hidden="true" />
				</button>
				<div className="text-center">
					<p className="text-[10px] uppercase tracking-[0.3em] text-pink-400 font-bold">
						{t("tinder.mission")}
					</p>
					<h1 className="text-base font-black italic tracking-tight text-white">
						{t("tinder.title")}
					</h1>
				</div>
				<TokenBadge />
			</header>

			<div className="px-6 pt-2 pb-3 tm-fade shrink-0">
				<div className="flex justify-between text-[11px] text-zinc-500 font-bold uppercase tracking-widest mb-1">
					<span>{t("tinder.progress")}</span>
					<span className="text-pink-400">
						{Math.min(index, REQUIRED)}/{REQUIRED}
					</span>
				</div>
				<div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
					<div
						className="h-full bg-linear-to-r from-pink-500 to-rose-400 shadow-[0_0_10px_rgba(236,72,153,0.6)] rounded-full transition-all"
						style={{ width: `${progressPct}%` }}
					/>
				</div>
			</div>

			<main className="flex-1 min-h-0 px-6 flex flex-col items-center justify-center relative gap-4">
				<div
					className="relative mx-auto"
					style={{
						aspectRatio: "3/4",
						height: "min(58dvh, 420px)",
						maxWidth: "min(100%, 320px)",
					}}
				>
					{DECK.map((song, i) => (
						<div
							key={song.id}
							ref={(el) => {
								cardRefs.current[i] = el;
							}}
							className={cn(
								"tm-card absolute inset-0 rounded-[28px] overflow-hidden border border-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.6)] touch-none will-change-transform",
								i < index && "pointer-events-none",
							)}
							style={{ zIndex: DECK.length - i }}
						>
							<div
								className={cn(
									"absolute inset-0 bg-linear-to-br",
									song.gradient,
								)}
							/>
							<img
								src={song.cover}
								alt=""
								aria-hidden="true"
								className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-90"
							/>
							<div className="absolute inset-0 bg-linear-to-t from-black via-black/60 to-transparent" />
							<div className="absolute top-4 left-4 inline-flex items-center gap-1.5 bg-black/40 border border-white/20 rounded-full px-2.5 py-1 backdrop-blur-md transform-gpu translate-z-0">
								<Music2 className="w-3 h-3 text-white" aria-hidden="true" />
								<span className="text-[10px] font-bold text-white uppercase tracking-widest">
									{t("tinder.track", { n: i + 1 })}
								</span>
							</div>
							<div className="absolute bottom-0 left-0 right-0 p-5 text-white">
								<p className="text-[11px] uppercase tracking-[0.3em] text-white/70 font-bold">
									{song.artist}
								</p>
								<h2 className="text-2xl font-black italic tracking-tight leading-tight drop-shadow-[0_0_15px_rgba(0,0,0,0.7)]">
									{song.title}
								</h2>
							</div>
						</div>
					))}
				</div>

				{!done && (
					<p className="mt-6 text-center text-zinc-500 text-xs">
						{t("tinder.swipesLeft", { count: remaining })}{" "}
						<span className="text-amber-300 font-black">
							{t("tinder.reward", { n: REWARD })}
						</span>
					</p>
				)}
			</main>

			<footer className="px-6 pb-8 pt-2 grid grid-cols-2 gap-4 tm-fade shrink-0">
				<button
					type="button"
					onClick={() => handleSwipe("dislike")}
					disabled={done}
					aria-label={t("tinder.garbage")}
					className="h-16 rounded-2xl bg-zinc-900 border border-red-500/40 text-red-400 flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-[0_0_15px_rgba(239,68,68,0.25)] focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
				>
					<X className="w-6 h-6" aria-hidden="true" />
					<span className="font-black text-sm uppercase tracking-widest">
						{t("tinder.garbage")}
					</span>
				</button>
				<button
					type="button"
					onClick={() => handleSwipe("like")}
					disabled={done}
					aria-label={t("tinder.hit")}
					className="h-16 rounded-2xl bg-linear-to-br from-pink-500 to-rose-600 text-white flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-[0_0_25px_rgba(236,72,153,0.55)] focus-visible:ring-2 focus-visible:ring-pink-400 disabled:opacity-50"
				>
					<Heart className="w-6 h-6 fill-white" aria-hidden="true" />
					<span className="font-black text-sm uppercase tracking-widest">
						{t("tinder.hit")}
					</span>
				</button>
			</footer>

			{done && (
				<div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md transform-gpu translate-z-0 flex items-center justify-center px-8">
					<div
						ref={successRef}
						className="w-full max-w-[320px] rounded-[28px] bg-linear-to-br from-zinc-900 to-zinc-950 border border-amber-400/50 p-6 text-center shadow-[0_0_50px_rgba(245,158,11,0.4)]"
					>
						<div className="w-16 h-16 rounded-full bg-amber-500/20 border border-amber-400/50 mx-auto flex items-center justify-center mb-4">
							<Sparkles
								className="w-8 h-8 text-amber-300"
								aria-hidden="true"
							/>
						</div>
						<p className="text-[10px] uppercase tracking-[0.3em] text-amber-300 font-bold mb-1">
							{t("tinder.missionDone")}
						</p>
						<h2 className="text-2xl font-black italic tracking-tight text-white mb-2">
							{t("tinder.goodEar")}
						</h2>
						<p className="text-sm text-zinc-400 mb-1">
							{t("tinder.stats", {
								likes: stats.likes,
								dislikes: stats.dislikes,
							})}
						</p>
						<p className="text-3xl font-black text-amber-300 my-4 drop-shadow-[0_0_15px_rgba(245,158,11,0.6)]">
							{t("tinder.rewardLine", { n: REWARD })}
						</p>
						<button
							type="button"
							onClick={() => setScreen("hub")}
							className="w-full h-12 rounded-2xl bg-white text-black font-black tracking-tight active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400"
						>
							{t("tinder.returnHub")}
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
