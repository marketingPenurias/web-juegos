import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Heart, X, Music2, ArrowLeft, Sparkles } from "lucide-react";
import { Draggable, gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { useMusic, type MusicTrack } from "../lib/useMusic";
import { useClaim } from "../lib/useClaim";
import { TokenBadge } from "../components/TokenBadge";
import { Toast } from "../components/Toast";
import { trackEvent } from "../lib/analytics";
import { cn } from "../lib/utils";

/**
 * TinderMusical — REAL.
 *
 *   Pre-condición (gate):
 *     · Necesita `activeEventId` del store (poblado por /api/session).
 *       Sin él, mostramos empty-state y NO montamos el WebSocket — así
 *       evitamos el error "channel subscribed with null filter" que
 *       teníamos en local.
 *
 *   Flujo de swipe:
 *     · Carga deck vía `useMusic.reload()` (event_tracks no votados).
 *     · Swipe derecha → `castVote({ vote_type: 'free' })`.
 *     · Swipe izquierda → trackEvent analytics, NO vota (Tinder real
 *       no manda dislikes a la BD: ahorra escrituras y respeta el
 *       índice único `(track_id, user_id)`).
 *     · Al cubrir REQUIRED votos, otorga la recompensa local
 *       (+20 tokens) — el ledger real lo gestiona el server, esto es
 *       feedback inmediato hasta que /api/wallet earn endpoint cierre
 *       el círculo en Fase 2.
 */

const SWIPE_THRESHOLD = 100;
const REWARD = 25; // Tabla 5: tinder_completion. El importe real lo fija el RPC.
const REQUIRED = 5;

export function TinderMusical() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);
	const addTokens = useGameState((s) => s.addTokens);
	const markDaily = useGameState((s) => s.markDaily);
	const activeEventId = useGameState((s) => s.activeEventId);

	const { deck, loading, error, castVote, reload } = useMusic(activeEventId);
	const { claim } = useClaim();

	const containerRef = useRef<HTMLDivElement>(null);
	const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
	const successRef = useRef<HTMLDivElement>(null);

	const [index, setIndex] = useState(0);
	const [stats, setStats] = useState({ likes: 0, dislikes: 0 });
	const [done, setDone] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [tone, setTone] = useState<"default" | "warning" | "success">(
		"default",
	);
	const animatingRef = useRef(false);

	// Firma estable del deck: cambia cuando el server trae otras canciones
	// (otra noche, otro evento, o un reload).  La usamos para resetear el
	// índice Y limpiar el array de refs — evita que refs posicionales de un
	// deck anterior se filtren al nuevo (causa raíz de "cartas a ciegas").
	const deckKey = deck.map((d) => d.id).join(",");
	useEffect(() => {
		cardRefs.current = [];
		setIndex(0);
		setStats({ likes: 0, dislikes: 0 });
		setDone(false);
	}, [deckKey]);

	const ready = activeEventId !== null && deck.length > 0 && !done;

	useGSAP(
		() => {
			gsap.from(".tm-fade", {
				y: 18,
				opacity: 0,
				stagger: 0.07,
				duration: 0.5,
				ease: "power3.out",
			});
			gsap.set(".tm-card", { transformOrigin: "center bottom" });
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
		{ scope: containerRef, dependencies: [deck.length] },
	);

	const restackBelow = (from: number) => {
		cardRefs.current.forEach((card, i) => {
			if (!card) return;
			const offset = i - (from + 1);
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

	const handleSwipe = async (dir: "like" | "dislike") => {
		if (animatingRef.current || done) return;
		const card = cardRefs.current[index];
		const song = deck[index];
		if (!card || !song) return;
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
			onComplete: async () => {
				const next = index + 1;
				const nextStats = {
					likes: stats.likes + (dir === "like" ? 1 : 0),
					dislikes: stats.dislikes + (dir === "dislike" ? 1 : 0),
				};
				setStats(nextStats);

				// fire-and-forget telemetry (no bloquea el siguiente swipe)
				void trackEvent(
					"music_preference",
					dir === "like" ? "swipe_right" : "swipe_left",
					{
						song: song.title,
						artist: song.artist,
						track_id: song.id,
					},
				);

				// Likes persisten como `vote_track` con tipo 'free' — el server
				// es la fuente de verdad; los dislikes no escriben (ahorro de
				// índice + privacidad del usuario).
				if (dir === "like") {
					markDaily("tinder_swipe"); // misión reactiva inmediata
					const res = await castVote({
						track_id: song.id,
						vote_type: "free",
						tokens_spent: 0,
					});
					if (!res.ok) {
						setTone("warning");
						// Modo diagnóstico piloto: si el backend manda
						// `detail` (mensaje raw del RPC) lo mostramos
						// directamente — ayuda a cazar FK violations,
						// unique violations o RAISE en vivo sin
						// abrir wrangler tail.
						setToast(
							res.detail
								? `${res.error}: ${res.detail}`
								: t("tinder.errVote", "No se pudo registrar el voto"),
						);
					}
				}

				if (next >= REQUIRED) {
					setDone(true);
					// OPTIMISTIC: sumamos +25 y animamos el modal YA.  El claim
					// real corre en background; el RPC `tinder_completion`
					// valida 1/noche y el ledger reconcilia el balance (si ya
					// se completó hoy, useClaim corrige el saldo sin drama).
					addTokens(REWARD, "history.tx_tinder");
					markDaily("tinder_completion");
					void claim("tinder_completion", activeEventId);
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
					// Limpieza GSAP de la carta DESCARTADA: matamos sus tweens y
					// la sacamos del flujo (pointer-events off + oculta) para que
					// no capture el drag ni "congele" la siguiente carta.
					gsap.killTweensOf(card);
					gsap.set(card, { pointerEvents: "none", opacity: 0 });
					setIndex(next);
					restackBelow(next - 1);
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
			if (!card || done || !ready) return;

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
						void swipeRef.current(this.x > 0 ? "like" : "dislike");
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
		{ dependencies: [index, done, ready] },
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
				{!activeEventId && (
					<EmptyState
						title={t("tinder.noEventTitle")}
						subtitle={t("tinder.noEventSub")}
						onAction={() => setScreen("hub")}
						actionLabel={t("tinder.returnHub")}
					/>
				)}
				{activeEventId && loading && deck.length === 0 && (
					<p className="text-zinc-500 text-sm font-bold">
						{t("tinder.loading")}
					</p>
				)}
				{activeEventId && error && deck.length === 0 && !loading && (
					<EmptyState
						title={t("tinder.errTitle")}
						subtitle={t("tinder.errSub")}
						onAction={() => void reload()}
						actionLabel={t("tinder.retry")}
					/>
				)}
				{activeEventId && !loading && deck.length === 0 && !error && !done && (
					<EmptyState
						title={t("tinder.deckEmptyTitle")}
						subtitle={t("tinder.deckEmptySub")}
						onAction={() => setScreen("hub")}
						actionLabel={t("tinder.returnHub")}
					/>
				)}

				{ready && (
					<div
						className="relative mx-auto"
						style={{
							aspectRatio: "3/4",
							height: "min(58dvh, 420px)",
							maxWidth: "min(100%, 320px)",
						}}
					>
						{deck.map((song, i) => (
							<SongCard
								key={song.id}
								song={song}
								track={i + 1}
								innerRef={(el) => {
									cardRefs.current[i] = el;
								}}
								pointerOff={i < index}
								zIndex={deck.length - i}
							/>
						))}
					</div>
				)}

				{ready && (
					<p className="mt-6 text-center text-zinc-500 text-xs">
						{t("tinder.swipesLeft", { count: remaining })}{" "}
						<span className="text-amber-300 font-black">
							{t("tinder.reward", { n: REWARD })}
						</span>
					</p>
				)}
			</main>

			{ready && (
				<footer className="px-6 pb-8 pt-2 grid grid-cols-2 gap-4 tm-fade shrink-0">
					<button
						type="button"
						onClick={() => void handleSwipe("dislike")}
						aria-label={t("tinder.garbage")}
						className="h-16 rounded-2xl bg-zinc-900 border border-red-500/40 text-red-400 flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-[0_0_15px_rgba(239,68,68,0.25)] focus-visible:ring-2 focus-visible:ring-red-400"
					>
						<X className="w-6 h-6" aria-hidden="true" />
						<span className="font-black text-sm uppercase tracking-widest">
							{t("tinder.garbage")}
						</span>
					</button>
					<button
						type="button"
						onClick={() => void handleSwipe("like")}
						aria-label={t("tinder.hit")}
						className="h-16 rounded-2xl bg-linear-to-br from-pink-500 to-rose-600 text-white flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-[0_0_25px_rgba(236,72,153,0.55)] focus-visible:ring-2 focus-visible:ring-pink-400"
					>
						<Heart className="w-6 h-6 fill-white" aria-hidden="true" />
						<span className="font-black text-sm uppercase tracking-widest">
							{t("tinder.hit")}
						</span>
					</button>
				</footer>
			)}

			{done && (
				<div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md transform-gpu translate-z-0 flex items-center justify-center px-8">
					<div
						ref={successRef}
						className="w-full max-w-[320px] rounded-4xl bg-linear-to-br from-zinc-900 to-zinc-950 border border-amber-400/50 p-6 text-center shadow-[0_0_50px_rgba(245,158,11,0.4)]"
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

			<Toast message={toast} onDone={() => setToast(null)} tone={tone} />
		</div>
	);
}

function SongCard({
	song,
	track,
	innerRef,
	pointerOff,
	zIndex,
}: {
	song: MusicTrack;
	track: number;
	innerRef: (el: HTMLDivElement | null) => void;
	pointerOff: boolean;
	zIndex: number;
}) {
	const { t } = useTranslation();
	return (
		<div
			ref={innerRef}
			className={cn(
				"tm-card absolute inset-0 rounded-4xl overflow-hidden border border-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.6)] touch-none will-change-transform",
				pointerOff && "pointer-events-none",
			)}
			style={{ zIndex }}
		>
			<div className="absolute inset-0 bg-linear-to-br from-fuchsia-600 via-rose-500 to-amber-500" />
			{song.cover_image_url && (
				<img
					src={song.cover_image_url}
					alt=""
					aria-hidden="true"
					className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-90"
				/>
			)}
			<div className="absolute inset-0 bg-linear-to-t from-black via-black/60 to-transparent" />
			<div className="absolute top-4 left-4 inline-flex items-center gap-1.5 bg-black/40 border border-white/20 rounded-full px-2.5 py-1 backdrop-blur-md transform-gpu translate-z-0">
				<Music2 className="w-3 h-3 text-white" aria-hidden="true" />
				<span className="text-[10px] font-bold text-white uppercase tracking-widest">
					{t("tinder.track", { n: track })}
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
	);
}

function EmptyState({
	title,
	subtitle,
	onAction,
	actionLabel,
}: {
	title: string;
	subtitle: string;
	onAction: () => void;
	actionLabel: string;
}) {
	return (
		<div className="flex flex-col items-center justify-center gap-4 text-center px-6 py-12">
			<Music2 className="w-12 h-12 text-zinc-700" aria-hidden="true" />
			<h3 className="text-xl font-black italic text-white">{title}</h3>
			<p className="text-zinc-500 text-sm max-w-xs">{subtitle}</p>
			<button
				type="button"
				onClick={onAction}
				className="mt-2 h-11 px-5 rounded-2xl bg-zinc-900 border border-zinc-700 text-zinc-200 font-black text-xs uppercase tracking-widest active:scale-95"
			>
				{actionLabel}
			</button>
		</div>
	);
}
