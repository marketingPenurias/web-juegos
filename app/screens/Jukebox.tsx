import { useMemo, useRef, useState } from "react";
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

const BOOST_COST = 50;

export function Jukebox() {
	const { t } = useTranslation();
	const tokens = useGameState((s) => s.tokens);
	const setBalance = useGameState((s) => s.setBalance);
	const setScreen = useGameState((s) => s.setScreen);
	const activeEventId = useGameState((s) => s.activeEventId);

	const { deck, loading, error, castVote, reload } = useMusic(activeEventId);

	const [query, setQuery] = useState("");
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
		{ scope: containerRef, dependencies: [deck.length] },
	);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return deck;
		return deck.filter(
			(s) =>
				s.title.toLowerCase().includes(q) ||
				s.artist.toLowerCase().includes(q),
		);
	}, [deck, query]);

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
			tokens_spent: BOOST_COST,
		});
		setBusy(null);
		if (!res.ok) {
			setTone("warning");
			setToast(translateError(res.error, res.detail));
			return;
		}
		if (typeof res.balance === "number") setBalance(res.balance);
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
				<p className="text-[11px] text-zinc-500 mt-2 px-1">
					{t("jukebox.subtitle")}
				</p>
			</section>

			<main className="flex-1 px-6 pt-4 pb-6 overflow-y-auto no-scrollbar">
				{!activeEventId && (
					<EmptyJukebox label={t("live.noEventSub", "Sin evento activo")} />
				)}
				{activeEventId && loading && deck.length === 0 && (
					<p className="text-center text-zinc-500 text-sm py-8">
						{t("menu.loading")}
					</p>
				)}
				{activeEventId && error && deck.length === 0 && (
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
	rowRefSetter,
	isRequested,
	isBoosted,
	busy,
	onRequest,
	onBoost,
}: {
	song: MusicTrack;
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
					aria-label={t("jukebox.boostAria", { n: BOOST_COST })}
					className={cn(
						"h-8 px-3 rounded-full text-[11px] font-black uppercase tracking-widest inline-flex items-center gap-1 transition-transform focus-visible:ring-2 focus-visible:ring-amber-300",
						isBoosted || busy
							? "bg-zinc-900 text-zinc-500 cursor-not-allowed"
							: "bg-linear-to-r from-amber-300 via-amber-500 to-amber-700 text-black active:scale-95 shadow-[0_0_15px_rgba(245,158,11,0.45)]",
					)}
				>
					<Zap className="w-3 h-3 fill-current" aria-hidden="true" />
					{t("jukebox.boost", { n: BOOST_COST })}
				</button>
			</div>
		</li>
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
