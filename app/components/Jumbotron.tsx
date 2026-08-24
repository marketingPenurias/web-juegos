import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Disc3, Flame, Music2, Radio, Sparkles, Swords, Timer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { gsap, useGSAP } from "../lib/gsap";
import { getBrowserSupabase } from "../lib/supabase.client";
import { useInterval } from "../lib/useInterval";
import { useTenant } from "../lib/tenant";
import { FlashDropBanner, type TvFlashDrop } from "./tv/FlashDropBanner";
import {
	RedemptionTicker,
	type RedemptionEvent,
} from "./tv/RedemptionTicker";
import { useVenuePhotos } from "../lib/useVenuePhotos";
import { VenueBackdrop } from "./VenueBackdrop";
import { cn } from "../lib/utils";
import type { Track } from "./tv/types";
import { DuelSide } from "./tv/DuelSide";
import { QrBlock } from "./tv/QrBlock";
import { NowPlayingPanel } from "./tv/NowPlayingPanel";
import { WinnerOverlay } from "./tv/WinnerOverlay";
import { EmptyState } from "./tv/EmptyState";

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
	/** Código del QR de entrada (qr_strategies). Si existe, el QR de la
	 *  pantalla registra CHECK-IN (visita + fidelidad) además de captar. */
	checkinCode?: string | null;
	showQr?: boolean;
	enableBattle?: boolean;
	initialBattle?: Battle | null;
	initialBackdrop?: TvBackdrop | null;
	initialFlashDrop?: TvFlashDrop | null;
};

const ROW_HEIGHT = 96; // px — must match the row's CSS height
const MAX_ROWS = 8;

// Ventana de ocultación V17: una canción sonada no vuelve al ranking hasta
// pasadas 2h (mientras, is_played la oculta; después, played_at).
const HIDE_MS = 2 * 60 * 60 * 1000;
// Red de la TV: Realtime PRIMARIO (event_tracks votos + is_played,
// live_battles ganador, tenant_events fondo) y este poll como FALLBACK de
// seguridad — con 1 pantalla por local el coste es despreciable.
//
// ⚠️ MODO PILOTO: 3s → la TV va instantánea aunque el realtime falle.  Como
// sólo hay 1 pantalla por local, incluso 3s es coste nulo (~80 queries/min).
// Tras el piloto, si se prioriza el realtime, se puede subir a 10-12s.
const TV_POLL_MS = 3_000;
// Respaldo del Flash Drop: Realtime es el primario, esto solo cubre la caída
// de wifi.  20s basta para que una promoción de 30 minutos no se pierda.
const FLASH_DROP_POLL_MS = 20_000;
// Sólo celebramos ganadores de batallas que cerraron hace poco (evita
// disparar la animación por una batalla vieja al arrancar la pantalla).
// 120s: el cron de cierre puede tardar hasta ~60s tras `ends_at`, así que la
// ventana debe cubrir ese retardo + el del poll (si fuera 45s, un cierre lento
// del cron dejaría al ganador sin animación).
const WINNER_FRESH_MS = 120_000;
const WINNER_SHOW_MS = 8_000;

export function Jumbotron({
	tenantId: _tenantId,
	eventId,
	initialTracks,
	initialNowPlaying = null,
	checkinCode = null,
	showQr = false,
	enableBattle = false,
	initialBattle = null,
	initialBackdrop = null,
	initialFlashDrop = null,
}: Props) {
	const tenant = useTenant();
	// Fotos del local (bucket tenant-assets) para el fondo dinámico de la TV.
	const venuePhotos = useVenuePhotos(tenant.slug);
	// Preferencia de fondo controlada por el DJ desde /admin (realtime).
	const [flashDrop, setFlashDrop] = useState<TvFlashDrop | null>(initialFlashDrop);
	// Último canje anunciado. Solo el último y un contador: la pantalla está
	// encendida toda la noche y una lista acumulada crecería sin techo.
	const [lastRedemption, setLastRedemption] = useState<RedemptionEvent | null>(null);
	const redemptionSeq = useRef(0);
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

	// Celebra al ganador de una batalla recién cerrada (overlay).  Lo llaman
	// TANTO el Realtime de `live_battles` (dashboard, instantáneo) COMO el poll
	// de fallback (ambas TVs).  Idempotente: cada batalla se celebra una vez, y
	// sólo si cerró hace poco (evita disparar por una batalla vieja al bootear).
	const maybeCelebrateWinner = useCallback(
		async (battleId: string, winnerTrack: string | null, endsAt: string) => {
			if (!winnerTrack || celebratedRef.current.has(battleId)) return;
			celebratedRef.current.add(battleId);
			const closedAgo = Date.now() - new Date(endsAt).getTime();
			if (closedAgo < 0 || closedAgo >= WINNER_FRESH_MS) return; // vieja → sólo marcar
			const supabase = getBrowserSupabase();
			if (!supabase) return;
			// La ganadora puede estar en memoria (era una de las del duelo).
			const local = tracksRef.current.find((t) => t.id === winnerTrack);
			if (local) { setWinner(local); return; }
			const { data: wt } = await supabase
				.from("event_tracks")
				.select("id, title, artist, cover_image_url, total_votes, is_played")
				.eq("id", winnerTrack)
				.maybeSingle();
			if (wt) setWinner(wt as Track);
		},
		[],
	);

	// Dominio real del local (.io).  El QR lleva `?ref=QR-TV` para atribuir
	// los escaneos que entran por la pantalla — el root loader captura `ref`
	// en cookie y lo consume el pipeline de atribución.
	const venueHost = `${tenant.slug}.nightgraph.io`;
	const venueUrl = `https://${venueHost}`;
	// V18: si el local tiene QR de entrada, la pantalla enseña el QR de
	// CHECK-IN → escanearlo registra la visita (venue_visits), da los tokens
	// del check-in y sube la racha de fidelidad semanal.  `ref=QR-TV` se
	// mantiene para no perder la atribución de captación.
	//
	// V20: durante un DUELO el QR además lleva `next=live`, así el que escanea
	// hace check-in Y aterriza directamente en la batalla (un solo escaneo sirve
	// para fidelidad + conversión).  `ref` distingue ambos orígenes en analítica.
	const buildQrTarget = (next?: "live"): string => {
		const ref = next ? "QR-TV-BATALLA" : "QR-TV";
		if (checkinCode) {
			const p = new URLSearchParams({ code: checkinCode, ref });
			if (next) p.set("next", next);
			return `${venueUrl}/checkin?${p.toString()}`;
		}
		// Sin QR de entrada configurado: sólo captación (+ deep-link si procede).
		const p = new URLSearchParams({ ref });
		if (next) p.set("screen", next);
		return `${venueUrl}/?${p.toString()}`;
	};
	const qrTarget = buildQrTarget();

	// Ranking visible (V20).  MISMA regla que el RPC `tv_ranking` de la BD —
	// aquí se replica porque el Realtime entrega filas sueltas y no queremos que
	// se cuelen ni un frame antes del siguiente poll:
	//   · sólo temas CON votos (fuera el relleno sin votar);
	//   · fuera el que suena ahora;
	//   · un tema ya sonado vuelve SÓLO si lo re-votan (last_vote_at > played_at)
	//     o si han pasado 2h desde que sonó.
	// Nada de esto borra datos: total_votes y track_votes quedan intactos, así
	// que al reaparecer conserva TODOS sus votos.
	const sorted = useMemo(() => {
		const cutoff = Date.now() - HIDE_MS;
		return [...tracks]
			.filter((t) => {
				if (t.total_votes <= 0) return false;
				if (t.is_played) return false;
				if (!t.played_at) return true;
				const playedAt = Date.parse(t.played_at);
				const reVoted = t.last_vote_at && Date.parse(t.last_vote_at) > playedAt;
				return Boolean(reVoted) || playedAt < cutoff;
			})
			.sort((a, b) => {
				if (b.total_votes !== a.total_votes) return b.total_votes - a.total_votes;
				// Desempate V18: a igualdad de votos, primero la que llegó ANTES a
				// ese número (last_vote_at más antiguo).  Sin sello (nunca votada)
				// = 0 → arriba en los empates a cero, y luego alfabético.
				const av = a.last_vote_at ? Date.parse(a.last_vote_at) : 0;
				const bv = b.last_vote_at ? Date.parse(b.last_vote_at) : 0;
				if (av !== bv) return av - bv;
				return a.title.localeCompare(b.title);
			})
			.slice(0, MAX_ROWS);
	}, [tracks]);

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
						// "Canción actual" en vivo: si el DJ marca/quita is_played,
						// el split view reacciona al instante (sin esperar al poll).
						if (next?.id) {
							if (next.is_played === true) setNowPlaying(next);
							else setNowPlaying((cur) => (cur && cur.id === next.id ? null : cur));
						}
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

	// ── Realtime del Flash Drop ─────────────────────────────────────────
	// Un drop dura 15-30 minutos: enterarse en el siguiente sondeo se comería
	// un trozo grande de la promoción.  Se escucha por sala (no por evento)
	// porque una campaña no cuelga de la fiesta, y los UPDATE traen `stock_used`
	// para que la cuenta de unidades baje en vivo — que es la parte que
	// engancha a quien está mirando la pantalla.
	useEffect(() => {
		const supabase = getBrowserSupabase();
		if (!supabase || !_tenantId) return;

		const apply = (row: Record<string, unknown> | null) => {
			if (!row || row.kind !== "flash_drop") return;
			const active =
				row.is_active === true &&
				typeof row.valid_to === "string" &&
				new Date(row.valid_to).getTime() > Date.now();
			if (!active) {
				// Cortado o caducado: la banda se retira sola.
				setFlashDrop((cur) => (cur && cur.id === row.id ? null : cur));
				return;
			}
			setFlashDrop((cur) => {
				// Un INSERT trae la campaña nueva; un UPDATE solo actualiza la que
				// ya se está anunciando.  El nombre del producto no viaja en el
				// payload de Realtime, así que se conserva el que ya teníamos.
				if (cur && cur.id !== row.id) return cur;
				return {
					id: String(row.id),
					label: (row.label as string | null) ?? cur?.label ?? null,
					product_name: cur?.product_name ?? "",
					promo_price_eur:
						row.promo_price_eur === null || row.promo_price_eur === undefined
							? (cur?.promo_price_eur ?? null)
							: Number(row.promo_price_eur),
					list_price_eur: cur?.list_price_eur ?? null,
					valid_to: (row.valid_to as string | null) ?? null,
					stock_total:
						row.stock_total === null || row.stock_total === undefined
							? null
							: Number(row.stock_total),
					stock_used: Number(row.stock_used ?? 0),
				};
			});
		};

		const channel = supabase
			.channel(`tv:flashdrop:${_tenantId}`)
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "product_availability", filter: `tenant_id=eq.${_tenantId}` },
				(payload) => apply((payload.new ?? null) as Record<string, unknown> | null),
			)
			.subscribe();

		return () => { void supabase.removeChannel(channel); };
	}, [_tenantId]);

	// ── Realtime de canjes (prueba social) ──────────────────────────────
	// Se escucha `wallet_ledger` y no `user_rewards` por dos motivos: ya está
	// en la publicación de Realtime, y su fila trae el nombre del producto
	// congelado en el momento de la compra (`product_name_at_time`), así que no
	// hace falta ir a buscarlo.
	//
	// La TV entra con cuenta de staff, y `wallet_ledger_staff_read` le deja ver
	// el ledger de toda la sala; con una cuenta normal la RLS solo dejaría
	// pasar los canjes propios y esto no anunciaría nada.
	useEffect(() => {
		const supabase = getBrowserSupabase();
		if (!supabase || !_tenantId) return;

		const channel = supabase
			.channel(`tv:redemptions:${_tenantId}`)
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "wallet_ledger", filter: `tenant_id=eq.${_tenantId}` },
				(payload) => {
					const row = payload.new as {
						reason?: string;
						product_name_at_time?: string | null;
					};
					// El ledger recoge TODO el movimiento de tokens (premios, boosts,
					// ajustes); aquí solo interesan las compras del menú.
					if (row?.reason !== "reward_purchase") return;
					const name = row.product_name_at_time?.trim();
					if (!name) return;
					redemptionSeq.current += 1;
					setLastRedemption({ seq: redemptionSeq.current, name });
				},
			)
			.subscribe();

		return () => { void supabase.removeChannel(channel); };
	}, [_tenantId]);

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
						id?: string; track_a?: string; track_b?: string; status?: string; ends_at?: string; winner_track?: string | null;
					};
					if (row.status === "live" && row.id && row.track_a && row.track_b && row.ends_at) {
						void activate(row.id, row.track_a, row.track_b, row.ends_at);
					} else {
						// closed → salir del duelo y, si acaba de terminar, celebrar
						// al ganador al INSTANTE (sin esperar al poll de fallback).
						setBattle(null);
						if (row.id && row.ends_at) {
							void maybeCelebrateWinner(row.id, row.winner_track ?? null, row.ends_at);
						}
					}
				},
			)
			.subscribe();

		return () => { void supabase.removeChannel(channel); };
	}, [enableBattle, eventId, maybeCelebrateWinner]);

	// ── Cuenta atrás del duelo (sólo reloj de UI; sin polling de datos) ──
	useEffect(() => {
		if (!battle) return;
		const endsAt = battle.endsAt;
		const tick = () =>
			setRemaining(Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000)));
		tick();
		// 1s basta para el mm:ss; evita re-renders innecesarios de la TV.
		const id = window.setInterval(tick, 1000);
		return () => window.clearInterval(id);
	}, [battle?.id, battle?.endsAt]);

	// ── FALLBACK de red (12s): reconciliación completa por si el WS cae ─────
	// El Realtime es la vía primaria (votos, is_played, batalla, fondo).  Este
	// poll es la RED DE SEGURIDAD: cada 12s reconcilia ranking + canción actual
	// + batalla + ganador contra la BD, para que la pantalla nunca se congele.
	const pollTv = useCallback(async () => {
		const supabase = getBrowserSupabase();
		if (!supabase || !eventId) return;
		// Si el poll trae datos, estamos "en directo" aunque el WS no conecte.
		setConnected(true);

		// 1) Ranking — RPC `tv_ranking`: la regla de visibilidad vive UNA sola vez
		//    (en SQL) y la comparte servidor y TV.  Hace falta porque compara dos
		//    columnas (last_vote_at > played_at) y PostgREST no puede expresarlo.
		const { data: top } = await supabase.rpc("tv_ranking", {
			p_event_id: eventId,
			p_limit: MAX_ROWS + 2,
		});
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

		// Cerrada → salir del duelo y, si acaba de terminar, celebrar ganador
		// (idempotente vía `maybeCelebrateWinner`; el Realtime pudo hacerlo ya).
		if (enableBattle) setBattle(null);
		void maybeCelebrateWinner(row.id, row.winner_track, row.ends_at);
	}, [eventId, enableBattle, maybeCelebrateWinner]);

	useInterval(() => {
		void pollTv();
	}, eventId ? TV_POLL_MS : null);

	// ── Red de seguridad del Flash Drop ─────────────────────────────────
	// El drop llegaba SOLO por Realtime, y en un local la wifi se cae.  Cuando
	// el websocket muere, la pantalla no se entera: no aparece el drop, no baja
	// el stock, y nadie lo nota hasta que alguien mira el móvil — con la
	// promoción entera perdida, que dura media hora.
	//
	// Los eventos perdidos durante una caída NO se recuperan al reconectar, así
	// que hace falta releer el estado, no esperar al siguiente.  Va atado a la
	// SALA y no al evento: una campaña no cuelga de la fiesta, y así sigue
	// funcionando aunque el evento aún no esté abierto.
	//
	// Cada 20 s: con una pantalla por local el coste es irrelevante frente a
	// que la promoción no se vea.
	const pollFlashDrop = useCallback(async () => {
		const supabase = getBrowserSupabase();
		if (!supabase || !_tenantId) return;
		const { data, error } = await supabase
			.from("product_availability")
			.select(
				"id, label, promo_price_eur, valid_to, stock_total, stock_used, " +
					"product:tenant_products(name, list_price_eur, promo_price_eur)",
			)
			.eq("tenant_id", _tenantId)
			.eq("kind", "flash_drop")
			.eq("is_active", true)
			.gt("valid_to", new Date().toISOString())
			.order("valid_from", { ascending: false })
			.limit(1)
			.maybeSingle();
		// Un error de red no debe borrar de la pantalla un drop que sigue vivo.
		if (error) return;
		if (!data) {
			setFlashDrop(null);
			return;
		}
		const row = data as unknown as {
			id: string; label: string | null; promo_price_eur: number | null;
			valid_to: string | null; stock_total: number | null; stock_used: number | null;
			product:
				| { name: string; list_price_eur: number | null; promo_price_eur: number | null }
				| { name: string; list_price_eur: number | null; promo_price_eur: number | null }[]
				| null;
		};
		const prod = Array.isArray(row.product) ? row.product[0] : row.product;
		setFlashDrop({
			id: row.id,
			label: row.label ?? null,
			product_name: prod?.name ?? "",
			promo_price_eur:
				row.promo_price_eur !== null && row.promo_price_eur !== undefined
					? Number(row.promo_price_eur)
					: (prod?.promo_price_eur ?? null),
			// El poll SÍ trae el precio de barra, que el payload de Realtime no
			// incluye: así el "9€ → 4€" acaba apareciendo aunque el primer aviso
			// llegara por el websocket.
			list_price_eur:
				prod?.list_price_eur !== null && prod?.list_price_eur !== undefined
					? Number(prod.list_price_eur)
					: null,
			valid_to: row.valid_to ?? null,
			stock_total: row.stock_total ?? null,
			stock_used: Number(row.stock_used ?? 0),
		});
	}, [_tenantId]);

	useInterval(() => {
		void pollFlashDrop();
	}, _tenantId ? FLASH_DROP_POLL_MS : null);

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

	// Entrada del duelo: UNA vez por batalla (dep = battle?.id).  Antes estaba
	// junto a la animación de barras con dep [aVotes,bVotes], así que se
	// re-disparaba en CADA voto → las tarjetas parpadeaban (fade desde 0) en la
	// TV mientras la gente votaba.  Separado, la entrada ya no se repite.
	useGSAP(
		() => {
			if (!battle) return;
			gsap.fromTo(".jb-duel-enter", { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.5, stagger: 0.08, ease: "back.out(1.5)" });
		},
		{ scope: containerRef, dependencies: [battle?.id] },
	);

	// Barras: se re-calculan en cada voto (transform scaleX, sin tocar opacidad).
	useGSAP(
		() => {
			if (!battle) return;
			const total = aVotes + bVotes;
			const aPct = total > 0 ? aVotes / total : 0.5;
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
						<div className="jb-duel-enter flex flex-col items-center gap-3">
							<div className="w-20 h-20 rounded-full bg-black border-2 border-(--jumbo-accent) flex items-center justify-center shadow-[0_0_40px_rgba(255,215,0,0.5)]">
								<Swords className="w-10 h-10 text-(--jumbo-accent)" aria-hidden="true" />
							</div>
							<span className="text-2xl font-black italic text-(--jumbo-accent)">VS</span>
							{/* V20: QR del DUELO — escanear = check-in + entrar directo a
							    la batalla (`next=live`).  Antes el duelo no tenía QR y se
							    perdía el momento de máxima atención de la sala. */}
							{showQr && (
								<div className="mt-2 flex flex-col items-center gap-2 rounded-2xl border border-(--jumbo-primary)/40 bg-black/50 backdrop-blur-md p-4">
									<div className="w-36 h-36 rounded-xl bg-black/40 border border-white/10 p-2 flex items-center justify-center">
										<QRCodeSVG
											value={buildQrTarget("live")}
											level="M"
											marginSize={0}
											fgColor={tenant.theme.primary ?? "#ffffff"}
											bgColor="transparent"
											className="w-full h-full"
											aria-label="QR para votar en la batalla"
										/>
									</div>
									<p className="text-sm font-black italic tracking-tight text-white text-center leading-tight">
										Escanea y vota
									</p>
								</div>
							)}
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

					{/* Columna derecha: CANCIÓN ACTUAL (split) y/o QR.  V18: el QR
					    ya NO desaparece al activar "Canción actual" — comparten
					    columna (canción arriba, QR compacto abajo). */}
					{(displayNowPlaying || showQr) && (
						<aside
							className={cn(
								"flex flex-col gap-6 min-w-0",
								displayNowPlaying ? "flex-1" : "w-[26rem] shrink-0",
							)}
						>
							{displayNowPlaying && <NowPlayingPanel track={nowPlaying} />}
							{showQr && (
								<QrBlock
									url={qrTarget}
									label={venueHost}
									fgColor={tenant.theme.primary ?? "#ffffff"}
									compact={displayNowPlaying}
								/>
							)}
						</aside>
					)}
				</main>
			))}

			{/* ── OVERLAY GANADOR DE BATALLA (ambas TVs) ─────────────────── */}
			{/* Debajo del overlay del ganador: la celebración manda durante sus
			    segundos, la promoción sigue ahí después. */}
			<FlashDropBanner drop={flashDrop} />
			<RedemptionTicker latest={lastRedemption} />

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
