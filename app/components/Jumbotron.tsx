import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Disc3, Flame, Music2, Radio, Sparkles, Swords, Timer, QrCode, Trophy, Crown } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { gsap, useGSAP } from "../lib/gsap";
import { getBrowserSupabase } from "../lib/supabase.client";
import { useInterval } from "../lib/useInterval";
import { useTenant } from "../lib/tenant";
import { useVenuePhotos } from "../lib/useVenuePhotos";
import { VenueBackdrop } from "./VenueBackdrop";
import { cn } from "../lib/utils";

/**
 * Jumbotron — vista de proyector del evento en directo.
 *
 *   - Leaderboard: suscripción `postgres_changes` a `event_tracks`
 *     filtrada por event_id.  Cada UPDATE/INSERT/DELETE se aplica a estado
 *     local y GSAP anima el diff (re-sort por slot, counter tween, pulso
 *     en el #1).  Cero polling.
 *   - Modo DUELO (opt-in `enableBattle`): suscripción a `live_battles`.  Si
 *     entra una batalla `live`, oculta el Top y muestra el enfrentamiento
 *     con cuenta atrás + barras GSAP.  Al cerrarse, vuelve al leaderboard.
 *   - QR gigante (opt-in `showQr`): bloque permanente "Escanea para pedir
 *     tu canción" → URL del tenant.
 */

type Track = {
	id: string;
	title: string;
	artist: string;
	cover_image_url: string | null;
	total_votes: number;
	is_played: boolean;
};

type Battle = { id: string; endsAt: string; a: Track; b: Track };

/** Preferencia de pantalla de la TV (control remoto del Staff).
 *   mode:  video    → sólo el vídeo del local
 *          photo    → una foto fija (`url`), vídeo pausado
 *          carousel → MIXTO: vídeo de base + fotos rotando encima
 *   showRanking → mostrar el Top de la noche (false = sólo fondo)
 *   showBattle  → mostrar la batalla de temas cuando haya una en vivo */
type TvBackdrop = {
	mode: "video" | "photo" | "carousel";
	url: string | null;
	showRanking: boolean;
	showBattle: boolean;
	// V17: partir la pantalla mostrando "Canción actual" en la mitad derecha.
	showNowPlaying: boolean;
};

type Props = {
	tenantId: string;
	eventId: string | null;
	initialTracks: Track[];
	initialNowPlaying?: Track | null;
	showQr?: boolean;
	enableBattle?: boolean;
	initialBattle?: Battle | null;
	initialBackdrop?: TvBackdrop | null;
};

const ROW_HEIGHT = 96; // px — must match the row's CSS height
const MAX_ROWS = 8;

// Ventana de ocultación V17: una canción sonada no vuelve al ranking hasta
// pasadas 2h (mientras, is_played la oculta; después, played_at).
const HIDE_MS = 2 * 60 * 60 * 1000;
// Short-polling de la TV (votos + canción actual + batalla).  El realtime de
// event_tracks no es fiable a escala, así que la fuente de verdad es un GET
// ligero cada 2.5s (1 pantalla por local → coste nulo).  Mismo patrón que el
// móvil (NowPlaying/LiveBattle).
const TV_POLL_MS = 2500;
// Sólo celebramos ganadores de batallas que cerraron hace poco (evita
// disparar la animación por una batalla vieja al arrancar la pantalla).
const WINNER_FRESH_MS = 45_000;
const WINNER_SHOW_MS = 8_000;

export function Jumbotron({
	tenantId: _tenantId,
	eventId,
	initialTracks,
	initialNowPlaying = null,
	showQr = false,
	enableBattle = false,
	initialBattle = null,
	initialBackdrop = null,
}: Props) {
	const tenant = useTenant();
	// Fotos del local (bucket tenant-assets) para el fondo dinámico de la TV.
	const venuePhotos = useVenuePhotos(tenant.slug);
	// Preferencia de fondo controlada por el DJ desde /admin (realtime).
	const [backdrop, setBackdrop] = useState<TvBackdrop>(
		initialBackdrop ?? { mode: "carousel", url: null, showRanking: true, showBattle: true, showNowPlaying: false },
	);
	// Vídeo de fondo del local (siempre disponible si el tenant lo configuró).
	const bgVideoUrl = tenant.bgVideoUrl ?? null;
	const [tracks, setTracks] = useState<Track[]>(initialTracks);
	const [nowPlaying, setNowPlaying] = useState<Track | null>(initialNowPlaying);
	const [battle, setBattle] = useState<Battle | null>(initialBattle);
	// Ganador recién proclamado (overlay de celebración, ambas TVs).
	const [winner, setWinner] = useState<Track | null>(null);
	const [connected, setConnected] = useState(false);
	const [remaining, setRemaining] = useState(0);
	// Batallas ya celebradas (para no repetir la animación en cada poll).
	const celebratedRef = useRef<Set<string>>(new Set<string>());

	const containerRef = useRef<HTMLDivElement>(null);
	const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
	const voteRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
	const previousVotes = useRef<Map<string, number>>(new Map());
	const aBarRef = useRef<HTMLDivElement>(null);
	const bBarRef = useRef<HTMLDivElement>(null);
	// Espejo del estado para que `activate` lea los tracks ACTUALES sin
	// re-suscribir el canal ni cerrar sobre un valor obsoleto.
	const tracksRef = useRef<Track[]>(tracks);
	tracksRef.current = tracks;

	// Dominio real del local (.io).  El QR lleva `?ref=QR-TV` para atribuir
	// los escaneos que entran por la pantalla — el root loader captura `ref`
	// en cookie y lo consume el pipeline de atribución.
	const venueHost = `${tenant.slug}.nightgraph.io`;
	const venueUrl = `https://${venueHost}`;
	const qrTarget = `${venueUrl}/?ref=QR-TV`;

	// Ranking visible: fuera las que suenan ahora (is_played) — el poll ya las
	// excluye por played_at<2h, pero filtramos también en cliente para que los
	// UPDATE de realtime (que sí traen is_played) no las cuelen ni un frame.
	const sorted = useMemo(
		() =>
			[...tracks]
				.filter((t) => !t.is_played)
				.sort((a, b) => b.total_votes - a.total_votes)
				.slice(0, MAX_ROWS),
		[tracks],
	);

	// Prune refs de tracks que han salido de la ventana visible (la TV vive 8h+).
	useEffect(() => {
		const alive = new Set(sorted.map((t) => t.id));
		for (const id of rowRefs.current.keys()) if (!alive.has(id)) rowRefs.current.delete(id);
		for (const id of voteRefs.current.keys()) if (!alive.has(id)) voteRefs.current.delete(id);
		for (const id of previousVotes.current.keys()) if (!alive.has(id)) previousVotes.current.delete(id);
	}, [sorted]);

	// ── Realtime event_tracks (votos del leaderboard + del duelo) ───────
	useEffect(() => {
		const supabase = getBrowserSupabase();
		if (!supabase || !eventId) return;

		const channel = supabase
			.channel(`tv:event_tracks:${eventId}`)
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "event_tracks", filter: `event_id=eq.${eventId}` },
				(payload) => {
					setTracks((current) => {
						if (payload.eventType === "DELETE") {
							const oldId = (payload.old as { id?: string }).id;
							return oldId ? current.filter((t) => t.id !== oldId) : current;
						}
						const next = payload.new as Track;
						if (!next?.id) return current;
						const idx = current.findIndex((t) => t.id === next.id);
						if (idx === -1) return [...current, next];
						const clone = current.slice();
						clone[idx] = { ...current[idx], ...next };
						return clone;
					});
					// Mantener vivos los votos de las canciones EN DUELO aunque no
					// estén en el top-8 visible.
					if (payload.eventType !== "DELETE") {
						const next = payload.new as Track;
						setBattle((cur) => {
							if (!cur || !next?.id) return cur;
							if (next.id === cur.a.id) return { ...cur, a: { ...cur.a, ...next } };
							if (next.id === cur.b.id) return { ...cur, b: { ...cur.b, ...next } };
							return cur;
						});
					}
				},
			)
			.subscribe((status) => setConnected(status === "SUBSCRIBED"));

		return () => { void supabase.removeChannel(channel); };
	}, [eventId]);

	// ── Realtime tenant_events → control del FONDO de la TV ─────────────
	// El DJ fija/desfija una imagen desde /admin (op set_tv_backdrop, escribe
	// en tenant_events.metadata).  Aquí lo recibimos al instante y cambiamos
	// entre carrusel automático e imagen fija.  Bajo volumen (sólo cambia
	// cuando el DJ toca el panel) → sin coste de fan-out.
	useEffect(() => {
		const supabase = getBrowserSupabase();
		if (!supabase || !eventId) return;

		const channel = supabase
			.channel(`tv:backdrop:${eventId}`)
			.on(
				"postgres_changes",
				{ event: "UPDATE", schema: "public", table: "tenant_events", filter: `id=eq.${eventId}` },
				(payload) => {
					const meta = (payload.new as { metadata?: Record<string, unknown> })?.metadata ?? null;
					const raw = (meta?.tv_backdrop ?? null) as
						| { mode?: string; url?: string | null; showRanking?: boolean; showBattle?: boolean; showNowPlaying?: boolean }
						| null;
					const m = raw?.mode;
					setBackdrop({
						mode: m === "video" || m === "photo" ? m : "carousel",
						url: typeof raw?.url === "string" ? raw.url : null,
						showRanking: raw?.showRanking !== false, // default true
						showBattle: raw?.showBattle !== false, // default true
						showNowPlaying: raw?.showNowPlaying === true, // default false
					});
				},
			)
			.subscribe();

		return () => { void supabase.removeChannel(channel); };
	}, [eventId]);

	// ── Realtime live_battles (sincronización del DUELO) ────────────────
	useEffect(() => {
		if (!enableBattle) return;
		const supabase = getBrowserSupabase();
		if (!supabase || !eventId) return;

		const activate = async (id: string, aId: string, bId: string, endsAt: string) => {
			// LOCAL-FIRST: las dos canciones casi siempre ya están en el top-10
			// que cargó el loader → construimos el duelo SIN tocar la BD.  Sólo
			// si falta alguna (rarísimo) pedimos exactamente las que faltan.
			const local = tracksRef.current;
			const localA = local.find((t) => t.id === aId);
			const localB = local.find((t) => t.id === bId);
			if (localA && localB) {
				setBattle({ id, endsAt, a: localA, b: localB });
				return;
			}
			const missing = [aId, bId].filter((x) => !local.some((t) => t.id === x));
			const { data } = await supabase
				.from("event_tracks")
				.select("id, title, artist, cover_image_url, total_votes, is_played")
				.in("id", missing);
			const pool = [...local, ...((data ?? []) as Track[])];
			const a = pool.find((t) => t.id === aId);
			const b = pool.find((t) => t.id === bId);
			if (a && b) setBattle({ id, endsAt, a, b });
		};

		const channel = supabase
			.channel(`tv:live_battles:${eventId}`)
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "live_battles", filter: `event_id=eq.${eventId}` },
				(payload) => {
					if (payload.eventType === "DELETE") { setBattle(null); return; }
					const row = payload.new as {
						id?: string; track_a?: string; track_b?: string; status?: string; ends_at?: string;
					};
					if (row.status === "live" && row.id && row.track_a && row.track_b && row.ends_at) {
						void activate(row.id, row.track_a, row.track_b, row.ends_at);
					} else {
						setBattle(null); // closed → de vuelta al leaderboard
					}
				},
			)
			.subscribe();

		return () => { void supabase.removeChannel(channel); };
	}, [enableBattle, eventId]);

	// ── Cuenta atrás del duelo (sólo reloj de UI; sin polling de datos) ──
	useEffect(() => {
		if (!battle) return;
		const tick = () =>
			setRemaining(Math.max(0, Math.floor((new Date(battle.endsAt).getTime() - Date.now()) / 1000)));
		tick();
		const id = window.setInterval(tick, 250);
		return () => window.clearInterval(id);
	}, [battle]);

	// ── SHORT-POLLING de la TV: votos + canción actual + batalla + ganador ─
	// Fuente de verdad de los datos en vivo (el realtime queda como acelerador
	// opcional).  Reproduce en la pantalla el mismo patrón robusto del móvil.
	const pollTv = useCallback(async () => {
		const supabase = getBrowserSupabase();
		if (!supabase || !eventId) return;
		// El polling ES la fuente de verdad: si trae datos, estamos "en directo"
		// aunque el WebSocket de realtime no llegue a conectar.
		setConnected(true);
		const cutoff = new Date(Date.now() - HIDE_MS).toISOString();

		// 1) Ranking (excluye la que suena y las sonadas hace <2h).
		const { data: top } = await supabase
			.from("event_tracks")
			.select("id, title, artist, cover_image_url, total_votes, is_played")
			.eq("event_id", eventId)
			.eq("is_played", false)
			.or(`played_at.is.null,played_at.lt.${cutoff}`)
			.order("total_votes", { ascending: false })
			.order("title", { ascending: true })
			.limit(MAX_ROWS + 2);
		if (top) setTracks(top as Track[]);

		// 2) Canción actual (para el panel "Canción actual" del split view).
		const { data: np } = await supabase
			.from("event_tracks")
			.select("id, title, artist, cover_image_url, total_votes, is_played")
			.eq("event_id", eventId)
			.eq("is_played", true)
			.limit(1)
			.maybeSingle();
		setNowPlaying((np as Track) ?? null);

		// 3) Batalla más reciente → duelo en vivo (dashboard) o ganador (ambas).
		const { data: b } = await supabase
			.from("live_battles")
			.select("id, track_a, track_b, status, ends_at, winner_track")
			.eq("event_id", eventId)
			.order("started_at", { ascending: false })
			.limit(1)
			.maybeSingle();

		if (!b) {
			if (enableBattle) setBattle(null);
			return;
		}
		const row = b as {
			id: string; track_a: string; track_b: string;
			status: string; ends_at: string; winner_track: string | null;
		};

		if (row.status === "live") {
			if (enableBattle) {
				const { data: bt } = await supabase
					.from("event_tracks")
					.select("id, title, artist, cover_image_url, total_votes, is_played")
					.in("id", [row.track_a, row.track_b]);
				const rows = (bt ?? []) as Track[];
				const a = rows.find((t) => t.id === row.track_a);
				const bb = rows.find((t) => t.id === row.track_b);
				if (a && bb) setBattle({ id: row.id, endsAt: row.ends_at, a, b: bb });
			}
			return;
		}

		// Cerrada → salir del duelo y, si acaba de terminar, celebrar ganador.
		if (enableBattle) setBattle(null);
		if (row.winner_track && !celebratedRef.current.has(row.id)) {
			celebratedRef.current.add(row.id);
			const closedAgo = Date.now() - new Date(row.ends_at).getTime();
			if (closedAgo >= 0 && closedAgo < WINNER_FRESH_MS) {
				const { data: wt } = await supabase
					.from("event_tracks")
					.select("id, title, artist, cover_image_url, total_votes, is_played")
					.eq("id", row.winner_track)
					.maybeSingle();
				if (wt) setWinner(wt as Track);
			}
		}
	}, [eventId, enableBattle]);

	useInterval(() => {
		void pollTv();
	}, eventId ? TV_POLL_MS : null);

	// Auto-ocultar el overlay de ganador tras la celebración.
	useEffect(() => {
		if (!winner) return;
		const id = window.setTimeout(() => setWinner(null), WINNER_SHOW_MS);
		return () => window.clearTimeout(id);
	}, [winner]);

	// ── GSAP: re-sort del leaderboard ───────────────────────────────────
	useGSAP(
		() => {
			sorted.forEach((track, idx) => {
				const el = rowRefs.current.get(track.id);
				if (!el) return;
				gsap.to(el, { y: idx * ROW_HEIGHT, duration: 0.6, ease: "power3.out", force3D: true, overwrite: "auto" });
			});
		},
		{ scope: containerRef, dependencies: [sorted.map((t) => t.id).join(","), Boolean(battle)] },
	);

	// ── GSAP: counter tween de votos ────────────────────────────────────
	useGSAP(
		() => {
			for (const track of sorted) {
				const node = voteRefs.current.get(track.id);
				if (!node) continue;
				const previous = previousVotes.current.get(track.id) ?? track.total_votes;
				if (previous === track.total_votes) continue;
				const obj = { val: previous };
				gsap.to(obj, {
					val: track.total_votes, duration: 0.7, ease: "power2.out", snap: { val: 1 },
					onUpdate: () => { node.textContent = String(Math.round(obj.val)); },
				});
				previousVotes.current.set(track.id, track.total_votes);
			}
		},
		{ scope: containerRef, dependencies: [sorted] },
	);

	// ── GSAP: pulso del líder ───────────────────────────────────────────
	useGSAP(
		() => {
			gsap.killTweensOf(".jb-leader-glow");
			gsap.to(".jb-leader-glow", { opacity: 0.85, duration: 1.6, yoyo: true, repeat: -1, ease: "sine.inOut", force3D: true });
		},
		{ scope: containerRef, dependencies: [sorted[0]?.id, Boolean(battle)] },
	);

	// ── GSAP: barras del duelo ──────────────────────────────────────────
	const aVotes = battle?.a.total_votes ?? 0;
	const bVotes = battle?.b.total_votes ?? 0;
	useGSAP(
		() => {
			if (!battle) return;
			const total = aVotes + bVotes;
			const aPct = total > 0 ? aVotes / total : 0.5;
			gsap.fromTo(".jb-duel-enter", { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.5, stagger: 0.08, ease: "back.out(1.5)" });
			if (aBarRef.current) gsap.to(aBarRef.current, { scaleX: aPct, duration: 0.7, ease: "power3.out" });
			if (bBarRef.current) gsap.to(bBarRef.current, { scaleX: 1 - aPct, duration: 0.7, ease: "power3.out" });
		},
		{ scope: containerRef, dependencies: [battle?.id, aVotes, bVotes] },
	);

	const containerStyle = useMemo(
		() => ({
			"--jumbo-primary": tenant.theme.primary ?? "#7DF9FF",
			"--jumbo-accent": tenant.theme.accent ?? "#FFD700",
			"--jumbo-bg": tenant.theme.background ?? "#050505",
		}) as React.CSSProperties,
		[tenant.theme],
	);

	// Foto fijada por el DJ (sólo en modo "photo"; null en video/carousel).
	const pinnedBackdropUrl = backdrop.mode === "photo" ? backdrop.url : null;

	// Visibilidad de capas (toggles del DJ).  Si las oculta TODAS, la pantalla
	// queda LIMPIA con sólo el fondo (foto / vídeo / carrusel).
	const displayBattle = enableBattle && !!battle && backdrop.showBattle;
	const displayRanking = backdrop.showRanking;
	// V17: "Canción actual" (split).  Se muestra en ambas TVs cuando el DJ lo
	// activa; ocupa la mitad derecha junto al ranking.
	const displayNowPlaying = backdrop.showNowPlaying;
	const cleanMode = !displayBattle && !displayRanking && !displayNowPlaying;
	const inBattle = displayBattle;
	const total = aVotes + bVotes;
	const aPct = total > 0 ? Math.round((aVotes / total) * 100) : 50;
	const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
	const ss = String(remaining % 60).padStart(2, "0");

	return (
		<div ref={containerRef} style={containerStyle} className="min-h-dvh w-full bg-(--jumbo-bg) text-white relative overflow-hidden flex flex-col">
			{/* Fondo PREMIUM dinámico — VÍDEO del local + FOTOS, controlado por
			    el DJ desde /admin (3 modos, ver VenueBackdrop):
			      · video    → sólo el vídeo (identidad del local)
			      · photo    → una foto fija (flyer), vídeo pausado
			      · carousel → MIXTO: vídeo de base + fotos rotando encima
			    El vídeo vuelve a verse SIEMPRE salvo en "foto fija". */}
			{(bgVideoUrl || venuePhotos.length > 0) && (
				<VenueBackdrop
					videoUrl={bgVideoUrl}
					photos={venuePhotos}
					mode={backdrop.mode}
					pinnedUrl={pinnedBackdropUrl}
				/>
			)}
			<div className="absolute inset-0 pointer-events-none">
				<div className="absolute -top-32 -left-32 w-[40vw] h-[40vw] rounded-full bg-(--jumbo-primary)/20 blur-[120px]" />
				<div className="absolute -bottom-32 -right-32 w-[40vw] h-[40vw] rounded-full bg-(--jumbo-accent)/15 blur-[140px]" />
			</div>

			{!cleanMode && (
			<header className="relative z-10 px-12 pt-12 pb-6 flex items-center justify-between">
				<div className="flex items-center gap-4">
					<div className="w-16 h-16 rounded-2xl bg-linear-to-tr from-(--jumbo-primary) to-(--jumbo-accent) p-0.5">
						<div className="w-full h-full bg-black rounded-2xl flex items-center justify-center">
							<Disc3 className="w-8 h-8 text-(--jumbo-primary)" aria-hidden="true" />
						</div>
					</div>
					<div>
						<p className="text-xs uppercase tracking-[0.4em] text-(--jumbo-accent) font-black">{tenant.name}</p>
						<h1 className="text-5xl font-black italic tracking-tighter">
							{inBattle ? "BATALLA DE TEMAS" : "TOP DE LA NOCHE"}
						</h1>
					</div>
				</div>
				<div
					className={cn(
						"inline-flex items-center gap-2 px-4 py-2 rounded-full border backdrop-blur-md",
						connected ? "bg-lime-500/15 border-lime-400/60 text-lime-300" : "bg-zinc-900/60 border-zinc-700 text-zinc-400",
					)}
					aria-live="polite"
				>
					<Radio className="w-4 h-4" aria-hidden="true" />
					<span className="text-xs font-black uppercase tracking-widest">{connected ? "EN DIRECTO" : "Conectando…"}</span>
				</div>
			</header>
			)}

			{!cleanMode && (inBattle && battle ? (
				// ── MODO DUELO ───────────────────────────────────────────────
				<main className="relative z-10 flex-1 px-12 pb-12 flex flex-col">
					<div className="flex items-center justify-center gap-4 mb-6">
						<div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-rose-950/50 border border-rose-500/50">
							<Timer className="w-7 h-7 text-rose-300" aria-hidden="true" />
							<span className="text-5xl font-black tabular-nums text-rose-200">{mm}:{ss}</span>
						</div>
					</div>
					<div className="flex-1 grid grid-cols-[1fr_auto_1fr] gap-6 items-center">
						<DuelSide track={battle.a} pct={aPct} side="a" origin="left" barRef={aBarRef} leading={aVotes >= bVotes} />
						<div className="jb-duel-enter flex flex-col items-center gap-2">
							<div className="w-20 h-20 rounded-full bg-black border-2 border-(--jumbo-accent) flex items-center justify-center shadow-[0_0_40px_rgba(255,215,0,0.5)]">
								<Swords className="w-10 h-10 text-(--jumbo-accent)" aria-hidden="true" />
							</div>
							<span className="text-2xl font-black italic text-(--jumbo-accent)">VS</span>
						</div>
						<DuelSide track={battle.b} pct={100 - aPct} side="b" origin="right" barRef={bBarRef} leading={bVotes > aVotes} />
					</div>
					<p className="text-center text-lg uppercase tracking-[0.3em] text-zinc-400 font-bold mt-6">
						Vota tu favorita desde la app
					</p>
				</main>
			) : (
				// ── MODO LEADERBOARD (+ QR / + Canción actual) ───────────────
				<main className="relative z-10 flex-1 px-12 pb-12 flex gap-10">
					{displayRanking && (
					<div className="flex-1 min-w-0">
						{!eventId ? (
							<EmptyState reason="no_active_event" />
						) : sorted.length === 0 ? (
							<EmptyState reason="no_tracks" />
						) : (
							<ol className="relative" style={{ height: `${MAX_ROWS * ROW_HEIGHT}px` }}>
								{sorted.map((track, idx) => (
									<li
										key={track.id}
										ref={(el) => { if (el) rowRefs.current.set(track.id, el); else rowRefs.current.delete(track.id); }}
										className={cn(
											"absolute top-0 left-0 right-0 flex items-center gap-6 px-6 rounded-2xl border transform-gpu translate-z-0 will-change-transform",
											idx === 0 ? "border-(--jumbo-accent)/60 bg-(--jumbo-accent)/10 shadow-[0_0_60px_rgba(255,215,0,0.35)]" : "border-zinc-800 bg-zinc-900/40 backdrop-blur-md",
										)}
										style={{ height: `${ROW_HEIGHT - 8}px` }}
									>
										{idx === 0 && (
											<div className="jb-leader-glow absolute inset-0 rounded-2xl pointer-events-none opacity-0" style={{ background: "linear-gradient(120deg, transparent 0%, rgba(255,215,0,0.18) 50%, transparent 100%)" }} aria-hidden="true" />
										)}
										<span className={cn("text-5xl font-black italic tabular-nums w-16 text-center", idx === 0 ? "text-(--jumbo-accent)" : "text-zinc-500")}>{idx + 1}</span>
										<div className="w-16 h-16 rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0">
											{track.cover_image_url ? <img src={track.cover_image_url} alt="" className="w-full h-full object-cover" /> : <Music2 className="w-6 h-6 text-zinc-600" aria-hidden="true" />}
										</div>
										<div className="flex-1 min-w-0">
											<p className="text-3xl font-black italic tracking-tight truncate">{track.title}</p>
											<p className="text-base text-zinc-400 truncate">{track.artist}</p>
										</div>
										<div className="text-right shrink-0">
											<div className="flex items-center gap-2 justify-end">
												<Sparkles className="w-5 h-5 text-(--jumbo-accent)" aria-hidden="true" />
												<span ref={(el) => { if (el) voteRefs.current.set(track.id, el); else voteRefs.current.delete(track.id); }} className="text-4xl font-black tabular-nums text-(--jumbo-accent)">{track.total_votes}</span>
											</div>
											<p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">votos</p>
										</div>
										{idx === 0 && <Flame className="w-7 h-7 text-(--jumbo-accent) shrink-0" aria-hidden="true" />}
									</li>
								))}
							</ol>
						)}
					</div>
					)}

					{/* V17: mitad derecha con la CANCIÓN ACTUAL (split view). */}
					{displayNowPlaying && <NowPlayingPanel track={nowPlaying} />}

					{/* QR sólo si NO estamos en split (para no amontonar columnas). */}
					{!displayNowPlaying && showQr && (
						<QrBlock url={qrTarget} label={venueHost} fgColor={tenant.theme.primary ?? "#ffffff"} />
					)}
				</main>
			))}

			{/* ── OVERLAY GANADOR DE BATALLA (ambas TVs) ─────────────────── */}
			{winner && <WinnerOverlay track={winner} />}

			{!cleanMode && (
			<footer className="relative z-10 px-12 pb-8 text-center">
				<p className="text-xs uppercase tracking-[0.4em] text-zinc-600 font-bold">
					Vota desde tu móvil · {venueHost}
				</p>
			</footer>
			)}
		</div>
	);
}

function DuelSide({ track, pct, side, origin, barRef, leading }: {
	track: Track; pct: number; side: "a" | "b"; origin: "left" | "right"; barRef: React.RefObject<HTMLDivElement | null>; leading: boolean;
}) {
	const color = side === "a" ? "var(--jumbo-primary)" : "var(--jumbo-accent)";
	return (
		<div className={cn("jb-duel-enter rounded-3xl border p-6 flex flex-col items-center text-center gap-4", leading ? "border-(--jumbo-accent)/70 bg-(--jumbo-accent)/5" : "border-zinc-800 bg-zinc-900/40")}>
			<div className="w-40 h-40 rounded-3xl overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center" style={{ boxShadow: `0 0 50px ${color}55` }}>
				{track.cover_image_url ? <img src={track.cover_image_url} alt="" className="w-full h-full object-cover" /> : <Music2 className="w-16 h-16 text-zinc-700" aria-hidden="true" />}
			</div>
			<div className="min-w-0 w-full">
				<p className="text-3xl font-black italic tracking-tight truncate">{track.title}</p>
				<p className="text-base text-zinc-400 truncate">{track.artist}</p>
			</div>
			<div className="w-full">
				{/* La barra del bando B crece desde la DERECHA para que ambas
				    choquen en el centro (impacto visual de duelo). */}
				<div className="h-5 w-full rounded-full bg-zinc-800 overflow-hidden">
					<div
						ref={barRef}
						className={cn("h-full rounded-full", origin === "right" ? "origin-right" : "origin-left")}
						style={{ background: color, transform: "scaleX(0.5)" }}
					/>
				</div>
				<div className="flex items-center justify-between mt-2">
					<span className="text-5xl font-black tabular-nums" style={{ color }}>{pct}%</span>
					<span className="text-2xl font-black tabular-nums text-zinc-400">{track.total_votes} <span className="text-sm uppercase tracking-widest">votos</span></span>
				</div>
			</div>
		</div>
	);
}

function QrBlock({ url, label, fgColor }: { url: string; label: string; fgColor: string }) {
	// QR generado 100% en el CLIENTE (qrcode.react) → SVG vectorial, offline,
	// sin llamadas de red ni rate-limits.  Siempre escaneable.
	//
	// Branding (V1.6 Premium): los módulos se pintan con el color primario del
	// local (`fgColor`) y el fondo es TRANSPARENTE para fundirse con el panel.
	// Para mantener la legibilidad/escaneabilidad con colores claros, el panel
	// que lo contiene es oscuro translúcido (alto contraste vs. el fg claro)
	// en vez del antiguo recuadro blanco.
	return (
		<aside className="w-[26rem] shrink-0 flex flex-col items-center justify-center gap-6 rounded-3xl border border-(--jumbo-primary)/40 bg-zinc-900/50 backdrop-blur-md p-8 text-center">
			<div className="inline-flex items-center gap-2 text-(--jumbo-primary) font-black uppercase tracking-[0.3em] text-sm">
				<QrCode className="w-5 h-5" aria-hidden="true" /> Pide tu canción
			</div>
			<div className="w-72 h-72 rounded-2xl bg-black/40 border border-white/10 p-4 flex items-center justify-center">
				<QRCodeSVG
					value={url}
					level="M"
					marginSize={0}
					fgColor={fgColor || "#ffffff"}
					bgColor="transparent"
					className="w-full h-full"
					aria-label={`QR para ${url}`}
				/>
			</div>
			<div>
				<p className="text-2xl font-black italic tracking-tight text-white">Escanea para pedir tu canción</p>
				<p className="text-base text-(--jumbo-primary) font-bold mt-1 break-all">{label}</p>
			</div>
		</aside>
	);
}

// ── Panel "Canción actual" (mitad derecha del split view · V17) ──────
function NowPlayingPanel({ track }: { track: Track | null }) {
	const ref = useRef<HTMLElement>(null);
	// Animación de entrada + latido sutil cada vez que cambia la canción.
	useGSAP(
		() => {
			if (!track) return;
			gsap.fromTo(
				".np-card",
				{ opacity: 0, scale: 0.94, y: 16 },
				{ opacity: 1, scale: 1, y: 0, duration: 0.6, ease: "back.out(1.4)" },
			);
		},
		{ scope: ref, dependencies: [track?.id] },
	);

	return (
		<aside
			ref={ref}
			className="flex-1 min-w-0 flex flex-col items-center justify-center gap-6 rounded-3xl border border-(--jumbo-primary)/40 bg-black/40 backdrop-blur-md p-8 text-center"
		>
			<div className="inline-flex items-center gap-2 text-(--jumbo-primary) font-black uppercase tracking-[0.35em] text-base">
				<span className="w-2.5 h-2.5 rounded-full bg-(--jumbo-primary) animate-pulse" />
				Sonando ahora
			</div>

			{track ? (
				<div className="np-card flex flex-col items-center gap-6 w-full">
					<div
						className="w-[22rem] h-[22rem] max-w-[38vw] max-h-[38vw] rounded-[2rem] overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center"
						style={{ boxShadow: "0 0 70px var(--jumbo-primary)55" }}
					>
						{track.cover_image_url ? (
							<img src={track.cover_image_url} alt="" className="w-full h-full object-cover" />
						) : (
							<Disc3 className="w-32 h-32 text-(--jumbo-primary) animate-spin [animation-duration:4s]" aria-hidden="true" />
						)}
					</div>
					<div className="min-w-0 w-full">
						<p className="text-5xl font-black italic tracking-tighter truncate">{track.title}</p>
						<p className="text-2xl text-zinc-400 truncate mt-1">{track.artist}</p>
					</div>
				</div>
			) : (
				<div className="np-card flex flex-col items-center gap-5 opacity-70">
					<div className="w-[18rem] h-[18rem] max-w-[32vw] max-h-[32vw] rounded-[2rem] bg-zinc-950/60 border border-zinc-800 flex items-center justify-center">
						<Disc3 className="w-24 h-24 text-zinc-700" aria-hidden="true" />
					</div>
					<p className="text-2xl font-black italic tracking-tight text-zinc-500">
						El DJ aún no ha puesto ninguna canción
					</p>
				</div>
			)}
		</aside>
	);
}

// ── Overlay de celebración del GANADOR de la batalla (ambas TVs · V17) ─
function WinnerOverlay({ track }: { track: Track }) {
	const ref = useRef<HTMLDivElement>(null);
	useGSAP(
		() => {
			const tl = gsap.timeline();
			tl.fromTo(".wo-bg", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" })
				.fromTo(".wo-crown", { scale: 0, rotate: -30, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.7, ease: "back.out(2.2)" }, "-=0.1")
				.fromTo(".wo-card", { scale: 0.7, opacity: 0, y: 40 }, { scale: 1, opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.6)" }, "-=0.4")
				.fromTo(".wo-label", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, "-=0.3");
			// Latido continuo de la corona mientras dura la celebración.
			gsap.to(".wo-crown", { scale: 1.12, duration: 0.9, yoyo: true, repeat: -1, ease: "sine.inOut", delay: 0.7 });
			// Destellos radiales.
			gsap.fromTo(".wo-ray", { scale: 0.4, opacity: 0.6 }, { scale: 2.4, opacity: 0, duration: 1.8, repeat: -1, ease: "power2.out", stagger: 0.3 });
		},
		{ scope: ref },
	);

	return (
		<div ref={ref} className="absolute inset-0 z-50 flex items-center justify-center">
			<div className="wo-bg absolute inset-0 bg-black/85 backdrop-blur-md" />
			<div className="absolute inset-0 pointer-events-none flex items-center justify-center">
				<div className="wo-ray absolute w-[60vw] h-[60vw] rounded-full bg-(--jumbo-accent)/20 blur-2xl" />
				<div className="wo-ray absolute w-[45vw] h-[45vw] rounded-full bg-(--jumbo-primary)/20 blur-2xl" />
			</div>

			<div className="relative z-10 flex flex-col items-center text-center gap-6 px-12">
				<Crown className="wo-crown w-28 h-28 text-(--jumbo-accent) drop-shadow-[0_0_40px_rgba(255,215,0,0.7)]" aria-hidden="true" />
				<p className="wo-label inline-flex items-center gap-3 text-(--jumbo-accent) font-black uppercase tracking-[0.4em] text-2xl">
					<Trophy className="w-8 h-8" aria-hidden="true" /> Ganadora de la batalla
				</p>
				<div className="wo-card flex flex-col items-center gap-5">
					<div
						className="w-72 h-72 rounded-[2rem] overflow-hidden bg-zinc-950 border-2 border-(--jumbo-accent)/70 flex items-center justify-center"
						style={{ boxShadow: "0 0 90px rgba(255,215,0,0.55)" }}
					>
						{track.cover_image_url ? (
							<img src={track.cover_image_url} alt="" className="w-full h-full object-cover" />
						) : (
							<Music2 className="w-28 h-28 text-(--jumbo-accent)" aria-hidden="true" />
						)}
					</div>
					<div className="min-w-0">
						<p className="text-6xl font-black italic tracking-tighter">{track.title}</p>
						<p className="text-3xl text-zinc-300 mt-2">{track.artist}</p>
					</div>
					<div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-(--jumbo-accent)/15 border border-(--jumbo-accent)/50">
						<Sparkles className="w-6 h-6 text-(--jumbo-accent)" aria-hidden="true" />
						<span className="text-2xl font-black tabular-nums text-(--jumbo-accent)">{track.total_votes}</span>
						<span className="text-sm uppercase tracking-widest text-(--jumbo-accent)/80 font-bold">votos</span>
					</div>
				</div>
			</div>
		</div>
	);
}

function EmptyState({ reason }: { reason: "no_active_event" | "no_tracks" }) {
	return (
		<div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center gap-4">
			<Music2 className="w-16 h-16 text-zinc-700" aria-hidden="true" />
			<p className="text-2xl font-black italic tracking-tight text-zinc-400">
				{reason === "no_active_event" ? "No hay evento activo esta noche" : "Aún no hay canciones en cola"}
			</p>
		</div>
	);
}
