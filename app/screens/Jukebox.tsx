import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ArrowLeft,
	CheckCircle2,
	Disc3,
	Music2,
	Search,
	Zap,
} from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { useMusic, type MusicTrack } from "../lib/useMusic";
import { useClaim } from "../lib/useClaim";
import { TokenBadge } from "../components/TokenBadge";
import { Toast } from "../components/Toast";
import { cn } from "../lib/utils";

/**
 * Jukebox — REAL.
 *
 *   Mapeo a las RPC existentes:
 *     · "Pedir"  = vote_track free (1 voto)
 *     · "Boost"  = vote_track boost, -50 tokens (BOOST_COST)
 *
 *   `vote_track` es idempotente por `(track_id, user_id)`: si el
 *   usuario ya pidió esta canción esta noche, el server devuelve
 *   `already_voted` y mostramos un toast neutro (la canción ya está
 *   en su cola). No mantenemos estado local de "pedidas" porque la
 *   verdad vive en `track_votes` server-side.
 */

// Fallbacks: el coste/premio REAL los fija `tenant_token_rewards` (servido
// en rewardRules).  Estas constantes sólo cubren el arranque antes de que
// /api/session cargue las reglas.
const DEFAULT_BOOST_COST = 50;
const DEFAULT_REQUEST_REWARD = 20;

/**
 * Normaliza para buscar: sin acentos/diacríticos, minúsculas, sin puntuación.
 * Así "regueton" encuentra "Reguetón" y "cafune" encuentra "Cruz Cafuné".
 */
function normalize(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // fuera tildes/diéresis
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ") // fuera puntuación (ñ ya normalizada a n)
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Búsqueda TOLERANTE (V18): ya no hace falta el nombre exacto.
 *   · Ignora tildes, mayúsculas y puntuación.
 *   · Multi-palabra en CUALQUIER orden y sobre título + artista:
 *     "quevedo graciosa" encuentra "LA GRACIOSA — Quevedo, Elvis Crespo".
 *   · Ordena por relevancia: primero lo que empieza por lo escrito.
 * Devuelve null si la canción no matchea; si matchea, su score (menor = mejor).
 */
function matchScore(song: { title: string; artist: string }, tokens: string[]): number | null {
	const title = normalize(song.title);
	const artist = normalize(song.artist);
	const hay = `${title} ${artist}`;
	let score = 0;
	for (const tk of tokens) {
		if (!hay.includes(tk)) return null; // todos los términos deben aparecer
		if (title.startsWith(tk)) score += 0;
		else if (title.includes(tk)) score += 1;
		else if (artist.startsWith(tk)) score += 2;
		else score += 3;
	}
	return score;
}

export function Jukebox() {
	const { t } = useTranslation();
	const tokens = useGameState((s) => s.tokens);
	const setBalance = useGameState((s) => s.setBalance);
	const setScreen = useGameState((s) => s.setScreen);
	const activeEventId = useGameState((s) => s.activeEventId);
	const rewardAmount = useGameState((s) => s.rewardAmount);

	// Economía centralizada (single source of truth = backend).  El boost se
	// guarda como amount negativo, por eso tomamos su valor absoluto.
	const BOOST_COST = Math.abs(rewardAmount("jukebox_boost", -DEFAULT_BOOST_COST));
	const REQUEST_REWARD = rewardAmount("jukebox_request", DEFAULT_REQUEST_REWARD);

	// CATÁLOGO COMPLETO (ligero) del evento — el Jukebox no usa el deck
	// "no-votado" de Tinder, sino todas las canciones disponibles para poder
	// buscar sobre el 100% y mostrar 50 aleatorias por defecto.
	const { deck: catalog, loading, error, castVote, reload } = useMusic(
		activeEventId,
		"catalog",
	);
	const addTokens = useGameState((s) => s.addTokens);
	const markDaily = useGameState((s) => s.markDaily);
	const { claim } = useClaim();

	// ── Snapshot estable del catálogo (mismo patrón anti-rebaraje que
	// Tinder).  `castVote` hace `setDeck(filter)` al votar; si renderizáramos
	// las 50 aleatorias directo desde `catalog`, cada voto rebarajaría la
	// vista.  Congelamos el catálogo una vez por evento.
	const [allSongs, setAllSongs] = useState<MusicTrack[]>([]);
	const catalogEventRef = useRef<string | null>(null);

	useEffect(() => {
		catalogEventRef.current = null;
		setAllSongs([]);
	}, [activeEventId]);

	useEffect(() => {
		if (
			activeEventId &&
			catalogEventRef.current !== activeEventId &&
			!loading &&
			catalog.length > 0
		) {
			catalogEventRef.current = activeEventId;
			setAllSongs(catalog);
		}
	}, [activeEventId, catalog, loading]);

	const [query, setQuery] = useState("");
	// Filtro por género (V18).  null = todos.
	const [genre, setGenre] = useState<string | null>(null);
	const [requested, setRequested] = useState<Set<string>>(new Set());
	const [boosted, setBoosted] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const [tone, setTone] = useState<"default" | "warning" | "success">(
		"default",
	);

	const containerRef = useRef<HTMLDivElement>(null);
	const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());

	useGSAP(
		() => {
			gsap.from(".jb-fade", {
				y: 18,
				opacity: 0,
				stagger: 0.07,
				duration: 0.5,
				ease: "power3.out",
			});
			gsap.from(".jb-row", {
				y: 24,
				opacity: 0,
				stagger: 0.06,
				duration: 0.45,
				ease: "power3.out",
				delay: 0.1,
			});
		},
		{ scope: containerRef, dependencies: [allSongs.length] },
	);

	// Géneros disponibles en el catálogo del evento (para los chips).
	const genres = useMemo(() => {
		const set = new Set<string>();
		for (const s of allSongs) if (s.genre) set.add(s.genre);
		return [...set].sort((a, b) => a.localeCompare(b));
	}, [allSongs]);

	// Catálogo tras aplicar el filtro de género (base de todo lo demás).
	const pool = useMemo(
		() => (genre ? allSongs.filter((s) => s.genre === genre) : allSongs),
		[allSongs, genre],
	);

	// 50 ALEATORIAS para la vista por defecto (Fisher-Yates parcial, sin sesgo).
	// Se recalcula al cambiar el catálogo o el género, no al votar (así el
	// Jukebox "parece nuevo" al abrirlo pero no se rebaraja bajo el dedo).
	const randomFifty = useMemo(() => {
		if (pool.length <= 50) return pool;
		const arr = pool.slice();
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr.slice(0, 50);
	}, [pool]);

	// Búsqueda TOLERANTE sobre el 100% del pool (no sólo las 50 visibles).
	// Cap a 50 resultados renderizados para no reventar el DOM.
	const filtered = useMemo(() => {
		const tokens = normalize(query).split(" ").filter(Boolean);
		if (tokens.length === 0) return randomFifty;
		return pool
			.map((s) => ({ s, score: matchScore(s, tokens) }))
			.filter((r): r is { s: MusicTrack; score: number } => r.score !== null)
			.sort((a, b) => a.score - b.score || a.s.title.localeCompare(b.s.title))
			.slice(0, 50)
			.map((r) => r.s);
	}, [pool, randomFifty, query]);

	const flashRow = (id: string, color: "amber" | "cyan") => {
		const row = rowRefs.current.get(id);
		if (!row) return;
		const shadow =
			color === "amber"
				? "0 0 35px rgba(245,158,11,0.85), 0 0 70px rgba(245,158,11,0.5)"
				: "0 0 25px rgba(0,240,255,0.6)";
		const border =
			color === "amber"
				? "rgba(245,158,11,0.95)"
				: "rgba(125,211,252,0.85)";
		const tl = gsap.timeline();
		tl.to(row, {
			boxShadow: shadow,
			borderColor: border,
			scale: 1.03,
			duration: 0.3,
			ease: "power2.out",
		})
			.to(row, { y: -12, duration: 0.25, ease: "power2.out" })
			.to(row, {
				y: 0,
				scale: 1,
				boxShadow: "0 0 0 rgba(0,0,0,0)",
				duration: 0.6,
				delay: 0.4,
				ease: "power2.inOut",
			});
	};

	const translateError = (code: string, detail?: string): string => {
		switch (code) {
			case "insufficient_funds":
				return t("jukebox.toastNoTokens");
			case "already_voted":
				return t("jukebox.toastAlreadyRequested", "Ya pediste esta canción");
			case "track_unavailable":
				return t("jukebox.toastUnavailable", "Canción no disponible");
			case "unauthorized":
				return t("menu.errUnauth");
			default:
				// Modo diagnóstico piloto: propaga `detail` raw del RPC
				// para cazar FK / unique / constraint violations sin
				// abrir wrangler tail.
				return detail
					? `${code}: ${detail}`
					: t("jukebox.toastError", "No se pudo procesar la petición");
		}
	};

	const handleRequest = async (id: string) => {
		if (busy) return;
		if (requested.has(id)) {
			// Sin endpoint de "cancelar voto" en el piloto — el server es
			// append-only.  Mostramos toast informativo en lugar de borrar.
			setTone("default");
			setToast(
				t(
					"jukebox.toastCannotCancel",
					"Los votos en directo no se pueden cancelar",
				),
			);
			return;
		}
		setBusy(id);
		const res = await castVote({
			track_id: id,
			vote_type: "free",
			tokens_spent: 0,
		});
		setBusy(null);
		if (!res.ok) {
			setTone("warning");
			setToast(translateError(res.error, res.detail));
			return;
		}
		setRequested((prev) => new Set(prev).add(id));
		setTone("success");
		setToast(t("jukebox.toastRequested"));
		flashRow(id, "cyan");
		// Premio por pedir (jukebox_request, 1/noche).  OPTIMISTIC: sumamos el
		// importe de las reglas ya; el claim reconcilia con el ledger.
		addTokens(REQUEST_REWARD, "history.tx_jukebox_request");
		void claim("jukebox_request", activeEventId);
	};

	const handleBoost = async (id: string) => {
		if (busy) return;
		if (boosted.has(id)) {
			setTone("default");
			setToast(t("jukebox.toastAlreadyBoosted", "Ya boosteaste esta canción"));
			return;
		}
		if (tokens < BOOST_COST) {
			setTone("warning");
			setToast(t("jukebox.toastNoTokens"));
			return;
		}
		setBusy(id);
		const res = await castVote({
			track_id: id,
			vote_type: "boost",
			tokens_spent: BOOST_COST, // ignorado server-side; coste real desde la BD
			boost_context: "jukebox",
		});
		setBusy(null);
		if (!res.ok) {
			setTone("warning");
			setToast(translateError(res.error, res.detail));
			return;
		}
		if (typeof res.balance === "number") setBalance(res.balance);
		markDaily("jukebox_boost"); // misión reactiva inmediata
		setBoosted((prev) => new Set(prev).add(id));
		setRequested((prev) => new Set(prev).add(id));
		setTone("success");
		setToast(t("jukebox.toastBoosted"));
		flashRow(id, "amber");
	};

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col relative z-20 h-full overflow-hidden bg-black"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-2 flex items-center justify-between jb-fade">
				<button
					type="button"
					onClick={() => setScreen("hub")}
					aria-label={t("common.back")}
					className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					<ArrowLeft className="w-4 h-4" aria-hidden="true" />
				</button>
				<div className="text-center">
					<p className="text-[10px] uppercase tracking-[0.3em] text-amber-300 font-bold flex items-center gap-1 justify-center">
						<Disc3 className="w-3 h-3" aria-hidden="true" />
						{t("jukebox.tag")}
					</p>
					<h1 className="text-base font-black italic tracking-tight text-white">
						{t("jukebox.title")}
					</h1>
				</div>
				<TokenBadge />
			</header>

			<section className="px-6 pt-3 jb-fade">
				<label className="relative block">
					<span className="sr-only">{t("jukebox.searchPlaceholder")}</span>
					<Search
						className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
						aria-hidden="true"
					/>
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("jukebox.searchPlaceholder")}
						className="w-full h-12 rounded-2xl bg-zinc-900/80 border border-zinc-800 pl-9 pr-3 text-sm font-bold text-white placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
					/>
				</label>
				{/* V18: filtro por GÉNERO musical.  Chips scrollables horizontales
				    (thumb-friendly); "Todos" resetea. */}
				{genres.length > 0 && (
					<div className="flex gap-2 overflow-x-auto no-scrollbar -mx-6 px-6 mt-3 pb-1">
						<GenreChip
							label={t("jukebox.genreAll", "Todos")}
							active={genre === null}
							onClick={() => setGenre(null)}
						/>
						{genres.map((g) => (
							<GenreChip
								key={g}
								label={g}
								active={genre === g}
								onClick={() => setGenre(genre === g ? null : g)}
							/>
						))}
					</div>
				)}
				<p className="text-[11px] text-zinc-500 mt-2 px-1">
					{t("jukebox.subtitle")}
				</p>
			</section>

			<main className="flex-1 px-6 pt-4 pb-6 overflow-y-auto no-scrollbar">
				{!activeEventId && (
					<EmptyJukebox label={t("live.noEventSub", "Sin evento activo")} />
				)}
				{activeEventId && loading && catalog.length === 0 && (
					<p className="text-center text-zinc-500 text-sm py-8">
						{t("menu.loading")}
					</p>
				)}
				{activeEventId && error && catalog.length === 0 && (
					<div className="text-center py-8 flex flex-col gap-3 items-center">
						<p className="text-rose-300 text-sm">{t("menu.errLoad")}</p>
						<button
							type="button"
							onClick={() => void reload()}
							className="h-10 px-4 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs font-black uppercase tracking-widest active:scale-95"
						>
							{t("menu.retry")}
						</button>
					</div>
				)}
				{activeEventId && !loading && filtered.length === 0 && !error && (
					<p className="text-center text-zinc-500 text-sm py-8">
						{t("jukebox.noResults")}
					</p>
				)}

				{filtered.length > 0 && (
					<ul className="flex flex-col gap-3">
						{filtered.map((song) => (
							<JukeboxRow
								key={song.id}
								song={song}
								boostCost={BOOST_COST}
								rowRefSetter={(el) => {
									if (el) rowRefs.current.set(song.id, el);
									else rowRefs.current.delete(song.id);
								}}
								isRequested={requested.has(song.id)}
								isBoosted={boosted.has(song.id)}
								busy={busy === song.id}
								onRequest={() => void handleRequest(song.id)}
								onBoost={() => void handleBoost(song.id)}
							/>
						))}
					</ul>
				)}
			</main>

			<Toast message={toast} onDone={() => setToast(null)} tone={tone} />
		</div>
	);
}

function JukeboxRow({
	song,
	boostCost,
	rowRefSetter,
	isRequested,
	isBoosted,
	busy,
	onRequest,
	onBoost,
}: {
	song: MusicTrack;
	boostCost: number;
	rowRefSetter: (el: HTMLLIElement | null) => void;
	isRequested: boolean;
	isBoosted: boolean;
	busy: boolean;
	onRequest: () => void;
	onBoost: () => void;
}) {
	const { t } = useTranslation();

	return (
		<li
			ref={rowRefSetter}
			className={cn(
				"jb-row flex items-center gap-3 rounded-2xl p-3 border bg-zinc-900/40 backdrop-blur-md transform-gpu translate-z-0",
				isBoosted
					? "border-amber-400/60 shadow-[0_0_20px_rgba(245,158,11,0.35)]"
					: isRequested
						? "border-cyan-500/40"
						: "border-zinc-800",
			)}
		>
			<div
				className={cn(
					"w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border overflow-hidden",
					isBoosted
						? "bg-amber-500/10 border-amber-500/40"
						: "bg-zinc-950 border-zinc-800",
				)}
				aria-hidden="true"
			>
				{song.cover_image_url ? (
					<img
						src={song.cover_image_url}
						alt=""
						className="w-full h-full object-cover"
					/>
				) : (
					<Music2 className="w-5 h-5 text-zinc-500" aria-hidden="true" />
				)}
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<p className="text-sm font-bold text-white truncate">{song.title}</p>
					{isBoosted && (
						<span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-[9px] font-black text-amber-300 uppercase tracking-widest shrink-0">
							<Zap className="w-2.5 h-2.5" aria-hidden="true" />
							{t("jukebox.boostedTag")}
						</span>
					)}
				</div>
				<p className="text-[11px] text-zinc-500 truncate">{song.artist}</p>
			</div>
			<div className="flex flex-col gap-1.5 shrink-0">
				<button
					type="button"
					onClick={onRequest}
					disabled={busy}
					aria-pressed={isRequested}
					className={cn(
						"h-8 px-3 rounded-full text-[11px] font-black uppercase tracking-widest border transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400 inline-flex items-center gap-1 active:scale-95",
						isRequested
							? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300"
							: "bg-zinc-900 border-zinc-700 text-zinc-300",
						busy && "opacity-60 cursor-wait",
					)}
				>
					{isRequested ? (
						<>
							<CheckCircle2 className="w-3 h-3" aria-hidden="true" />
							{t("jukebox.requested", "Pedida")}
						</>
					) : (
						t("jukebox.request")
					)}
				</button>
				<button
					type="button"
					onClick={onBoost}
					disabled={isBoosted || busy}
					aria-label={t("jukebox.boostAria", { n: boostCost })}
					className={cn(
						"h-8 px-3 rounded-full text-[11px] font-black uppercase tracking-widest inline-flex items-center gap-1 transition-transform focus-visible:ring-2 focus-visible:ring-amber-300",
						isBoosted || busy
							? "bg-zinc-900 text-zinc-500 cursor-not-allowed"
							: "bg-linear-to-r from-amber-300 via-amber-500 to-amber-700 text-black active:scale-95 shadow-[0_0_15px_rgba(245,158,11,0.45)]",
					)}
				>
					<Zap className="w-3 h-3 fill-current" aria-hidden="true" />
					{t("jukebox.boost", { n: boostCost })}
				</button>
			</div>
		</li>
	);
}

// Chip de filtro por género (V18).
function GenreChip({ label, active, onClick }: {
	label: string; active: boolean; onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				"shrink-0 h-8 px-3 rounded-full text-[11px] font-black uppercase tracking-widest border whitespace-nowrap active:scale-95 transition-colors focus-visible:ring-2 focus-visible:ring-amber-400",
				active
					? "bg-amber-400 border-amber-300 text-black shadow-[0_0_15px_rgba(245,158,11,0.45)]"
					: "bg-zinc-900 border-zinc-700 text-zinc-300",
			)}
		>
			{label}
		</button>
	);
}

function EmptyJukebox({ label }: { label: string }) {
	return (
		<div className="text-center py-10 flex flex-col items-center gap-3">
			<Music2 className="w-10 h-10 text-zinc-700" aria-hidden="true" />
			<p className="text-zinc-400 text-sm font-bold">{label}</p>
		</div>
	);
}
