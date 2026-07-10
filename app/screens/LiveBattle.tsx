import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Timer } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { getBrowserSupabase } from "../lib/supabase.client";
import { useInterval } from "../lib/useInterval";
import { useGameState } from "../store/useGameState";
import { useMusic } from "../lib/useMusic";
import { useClaim } from "../lib/useClaim";
import { Toast } from "../components/Toast";
import { LiveHeader } from "../components/live/LiveHeader";
import { SongRow } from "../components/live/SongRow";
import { BoostBurst } from "../components/live/BoostBurst";
import { VoteFooter, type VoteAction } from "../components/live/VoteFooter";

/**
 * LiveBattle — DUELO GLOBAL SINCRONIZADO.
 *
 *   Ya no es un top-2 que cada usuario calcula por su cuenta: la batalla
 *   es un evento server-managed (`live_battles`, lanzado por el DJ desde
 *   /admin).  TODOS los usuarios ven el MISMO duelo a la vez:
 *
 *     · Suscripción Realtime a `live_battles` (filtro event_id): cuando el
 *       DJ inicia una batalla `live`, cargamos las dos canciones; cuando se
 *       cierra (autocierre por timer o forzado), volvemos al empty-state.
 *     · Suscripción a `event_tracks` para que los porcentajes suban en vivo
 *       según votan los demás.
 *     · Voto/boost vía `vote_track` (coste server-authoritative).  Premio
 *       +10 (1/noche) vía claim, con Optimistic UI.
 *
 *   Asimetría respetada: el móvil sólo escucha `live_battles` + `event_tracks`.
 */

// Fallbacks: el coste/premio REAL los fija `tenant_token_rewards`.
const DEFAULT_BOOST_COST = 30;
const DEFAULT_VOTE_REWARD = 10;

// Short-polling de los porcentajes en vivo DURANTE la batalla (sustituye al
// UPDATE Realtime de event_tracks, que saturaba el WAL con 500 móviles).
// Sólo activo en la ventana corta del duelo (minutos).  Auditoría 360º · §2.
const VOTES_POLL_MS = 2500;

// Fallback de DESCUBRIMIENTO de batalla (V17 · red optimizada).
// El descubrimiento PRIMARIO es el canal Realtime `live_battles` (INSERT del
// duelo).  Este poll es la RED DE SEGURIDAD por si el WebSocket cae o pierde
// el evento.
//
// ⚠️ MODO PILOTO: 5s → la batalla aparece casi al instante aunque el realtime
// falle, y a escala de piloto (decenas de móviles) el coste es ridículo.
// ANTES DE ESCALAR A CIENTOS/500 CONCURRENTES: subir a 30_000 (a 500 móviles,
// 5s = 6k req/min sólo para "¿hay batalla ya?", inviable; 30s lo hace nulo).
const DISCOVERY_FALLBACK_MS = 5_000;

type BTrack = { id: string; title: string; artist: string; total_votes: number };
type Battle = { id: string; endsAt: string; a: BTrack; b: BTrack };

export function LiveBattle() {
	const { t } = useTranslation();
	const tokens = useGameState((s) => s.tokens);
	const setBalance = useGameState((s) => s.setBalance);
	const addTokens = useGameState((s) => s.addTokens);
	const markDaily = useGameState((s) => s.markDaily);
	const activeEventId = useGameState((s) => s.activeEventId);
	const rewardAmount = useGameState((s) => s.rewardAmount);
	const { castVote } = useMusic(activeEventId);
	const { claim } = useClaim();

	// Economía centralizada (single source of truth = backend).
	const BOOST_COST = Math.abs(rewardAmount("livebattle_boost", -DEFAULT_BOOST_COST));
	const VOTE_REWARD = rewardAmount("livebattle_vote", DEFAULT_VOTE_REWARD);

	const containerRef = useRef<HTMLDivElement>(null);
	const aBarRef = useRef<HTMLDivElement>(null);
	const bBarRef = useRef<HTMLDivElement>(null);
	const aPctRef = useRef<HTMLSpanElement>(null);
	const bPctRef = useRef<HTMLSpanElement>(null);
	const burstRef = useRef<HTMLDivElement>(null);

	const [battle, setBattle] = useState<Battle | null>(null);
	const [loading, setLoading] = useState(true);
	const [voted, setVoted] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [remaining, setRemaining] = useState(0);
	const [toast, setToast] = useState<string | null>(null);
	const [tone, setTone] = useState<"default" | "success" | "warning">("default");

	// ── Carga del duelo activo (las dos canciones enfrentadas) ──────────
	const loadBattle = useCallback(async () => {
		const supabase = getBrowserSupabase();
		if (!supabase || !activeEventId) {
			setBattle(null);
			setLoading(false);
			return;
		}
		const { data: b } = await supabase
			.from("live_battles")
			.select("id, track_a, track_b, status, ends_at")
			.eq("event_id", activeEventId)
			.eq("status", "live")
			.order("started_at", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (!b?.id) {
			setBattle(null);
			setLoading(false);
			return;
		}
		const { data: rows } = await supabase
			.from("event_tracks")
			.select("id, title, artist, total_votes")
			.in("id", [b.track_a as string, b.track_b as string]);
		const list = (rows ?? []) as BTrack[];
		const a = list.find((r) => r.id === b.track_a);
		const bb = list.find((r) => r.id === b.track_b);
		setBattle(a && bb ? { id: b.id as string, endsAt: b.ends_at as string, a, b: bb } : null);
		setLoading(false);
	}, [activeEventId]);

	// ── Realtime: live_battles (sincronización del duelo global) ────────
	useEffect(() => {
		const supabase = getBrowserSupabase();
		if (!supabase || !activeEventId) {
			setBattle(null);
			setLoading(false);
			return;
		}
		setLoading(true);
		void loadBattle();
		const channel = supabase
			.channel(`live:battle:${activeEventId}`)
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "live_battles", filter: `event_id=eq.${activeEventId}` },
				(payload) => {
					if (payload.eventType === "DELETE") { setBattle(null); return; }
					const row = payload.new as { status?: string };
					if (row.status === "live") void loadBattle();
					else setBattle(null); // closed → fin del duelo
				},
			)
			.subscribe();
		return () => { void supabase.removeChannel(channel); };
	}, [activeEventId, loadBattle]);

	// ── Red: Realtime primario + polling de apoyo ──────────────────────
	// · Descubrir/abrir/cerrar la batalla → canal Realtime `live_battles`
	//   (arriba).  Es la vía PRIMARIA y de bajo volumen (1 fila por duelo).
	// · Votos en vivo → el UPDATE de event_tracks NO se difunde (saturaría el
	//   WAL con 500 móviles), así que DURANTE la batalla refrescamos los dos
	//   temas cada 2.5s.
	// · Fuera de batalla → poll de SEGURIDAD a 30s por si el WebSocket perdió
	//   el INSERT del duelo (fallback, no mecanismo principal).
	useInterval(() => {
		void loadBattle();
	}, activeEventId ? (battle ? VOTES_POLL_MS : DISCOVERY_FALLBACK_MS) : null);

	// ── Cuenta atrás del duelo ──────────────────────────────────────────
	useEffect(() => {
		if (!battle) return;
		const tick = () => setRemaining(Math.max(0, Math.floor((new Date(battle.endsAt).getTime() - Date.now()) / 1000)));
		tick();
		const id = window.setInterval(tick, 250);
		return () => window.clearInterval(id);
	}, [battle]);

	// Reset selección/voto al cambiar de batalla.
	useEffect(() => { setVoted(null); setSelected(null); }, [battle?.id]);

	const a = battle?.a;
	const b = battle?.b;
	const totalVotes = (a?.total_votes ?? 0) + (b?.total_votes ?? 0);
	const aPct = totalVotes > 0 ? Math.round(((a?.total_votes ?? 0) / totalVotes) * 100) : 50;
	const bPct = 100 - aPct;
	const ended = remaining === 0 && !!battle;

	useGSAP(
		() => { gsap.from(".live-fade", { y: 16, opacity: 0, stagger: 0.07, duration: 0.5, ease: "power3.out" }); },
		{ scope: containerRef, dependencies: [battle?.id] },
	);

	useGSAP(
		() => {
			animateBar(aBarRef.current, aPct);
			animateBar(bBarRef.current, bPct);
			animateCount(aPctRef.current, aPct);
			animateCount(bPctRef.current, bPct);
		},
		{ dependencies: [aPct, bPct, battle?.id] },
	);

	const triggerBoostBurst = () => {
		if (!burstRef.current) return;
		gsap.set(burstRef.current, { display: "flex", opacity: 1 });
		const tl = gsap.timeline({ onComplete: () => { if (burstRef.current) gsap.set(burstRef.current, { display: "none" }); } });
		tl.fromTo(".burst-glow", { scale: 0.4, opacity: 0 }, { scale: 3, opacity: 0, duration: 1, ease: "power3.out", force3D: true })
			.fromTo(".burst-text", { y: 40, opacity: 0 }, { y: -30, opacity: 1, duration: 0.5, ease: "back.out(2)", force3D: true }, "<")
			.to(".burst-text", { opacity: 0, duration: 0.5, delay: 0.4, ease: "power2.in", force3D: true });
	};

	const handleConfirm = async (action: VoteAction) => {
		if (!selected || voted || ended) return;
		const cost = action === "boost" ? BOOST_COST : 0;
		if (action === "boost" && tokens < cost) {
			setTone("warning");
			setToast(t("live.toastNoTokens"));
			return;
		}
		const result = await castVote({
			track_id: selected,
			vote_type: action,
			tokens_spent: cost, // ignorado server-side; el coste real lo fija la BD
			boost_context: "livebattle",
		});
		if (!result.ok) {
			// `already_voted` NO es un error severo: es la BD recordándonos algo
			// que el estado local olvidó (recarga / cambio de pestaña).  Lo
			// tratamos como info y RECONCILIAMOS la UI bloqueando la botonera.
			if (result.error === "already_voted") {
				setTone("default");
				setToast(t("live.toastAlreadyVoted", "Ya has votado en este duelo"));
				setVoted(selected);
				return;
			}
			setTone("warning");
			setToast(
				result.error === "insufficient_funds"
					? t("live.toastNoTokens")
					: result.detail
						? `${result.error}: ${result.detail}`
						: t("live.toastError", "No se pudo registrar el voto"),
			);
			return;
		}
		if (typeof result.balance === "number") setBalance(result.balance);
		// Reflejo inmediato del voto en la barra (además del Realtime).
		if (typeof result.total_votes === "number") {
			setBattle((cur) => {
				if (!cur) return cur;
				if (selected === cur.a.id) return { ...cur, a: { ...cur.a, total_votes: result.total_votes as number } };
				if (selected === cur.b.id) return { ...cur, b: { ...cur.b, total_votes: result.total_votes as number } };
				return cur;
			});
		}
		setVoted(selected);
		// Premio por votar (livebattle_vote, 1/noche), Optimistic.
		addTokens(VOTE_REWARD, "history.tx_vote");
		markDaily("vote_track");
		void claim("livebattle_vote", activeEventId);
		if (action === "boost") {
			setTone("success");
			setToast(t("live.toastBoost"));
			triggerBoostBurst();
		} else {
			setTone("default");
			setToast(t("live.toastVote"));
		}
	};

	const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
	const ss = String(remaining % 60).padStart(2, "0");

	return (
		<div ref={containerRef} className="flex-1 flex flex-col relative z-20 min-h-0 overflow-hidden">
			<LiveHeader />

			<main className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 flex flex-col justify-center relative z-10 -mt-2 pb-2">
				<div className="live-fade flex flex-col items-center mb-6">
					<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/40 border border-red-500/30 backdrop-blur-sm transform-gpu translate-z-0 mb-4">
						<span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,1)] animate-pulse" />
						<span className="text-[10px] font-black tracking-[0.15em] text-red-400 uppercase">{t("live.liveBadge")}</span>
					</div>
					<h2 className="text-3xl font-black italic tracking-tighter text-transparent bg-clip-text bg-linear-to-r from-cyan-300 via-blue-500 to-cyan-400 drop-shadow-[0_0_20px_rgba(0,240,255,0.4)] leading-tight text-center">
						{t("live.battleTitle")}
					</h2>
					{battle && (
						<div className="mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-950/50 border border-rose-500/40">
							<Timer className="w-4 h-4 text-rose-300" aria-hidden="true" />
							<span className="text-xl font-black tabular-nums text-rose-200">{mm}:{ss}</span>
						</div>
					)}
				</div>

				{!activeEventId && (
					<div className="text-center text-zinc-500 text-sm py-8 max-w-xs mx-auto">
						{t("live.noEventSub", "Inicia sesión para entrar en la batalla.")}
					</div>
				)}

				{activeEventId && loading && (
					<p className="text-center text-zinc-500 text-sm py-8">{t("live.loading", "Cargando duelo…")}</p>
				)}

				{activeEventId && !loading && !battle && (
					<div className="text-center py-8 flex flex-col gap-3 items-center">
						<p className="text-zinc-400 text-sm max-w-xs">
							{t("live.noBattle", "El DJ aún no ha lanzado ninguna batalla. ¡Atento a la pantalla, empieza en breve!")}
						</p>
					</div>
				)}

				{activeEventId && battle && a && b && (
					<div className="space-y-6">
						<SongRow
							name={a.title}
							color="cyan"
							percent={aPct}
							barRef={aBarRef}
							pctRef={aPctRef}
							selected={selected === a.id}
							confirmed={voted === a.id}
							onSelect={() => setSelected(a.id)}
							disabled={voted !== null || ended}
						/>

						<div className="relative flex justify-center -my-3 z-10 pointer-events-none">
							<div className="w-8 h-8 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center shadow-lg">
								<span className="text-[10px] font-black italic text-zinc-500">{t("live.vs")}</span>
							</div>
						</div>

						<SongRow
							name={b.title}
							color="lime"
							percent={bPct}
							barRef={bBarRef}
							pctRef={bPctRef}
							selected={selected === b.id}
							confirmed={voted === b.id}
							onSelect={() => setSelected(b.id)}
							disabled={voted !== null || ended}
						/>

						{ended && (
							<p className="text-center text-amber-300 text-sm font-black uppercase tracking-widest">
								{t("live.battleEnded", "¡Duelo cerrado! Mira el ganador en pantalla")}
							</p>
						)}
					</div>
				)}
			</main>

			<VoteFooter
				disabled={voted !== null || ended || !battle}
				hasSelection={selected !== null}
				tokens={tokens}
				boostCost={BOOST_COST}
				onConfirm={(action) => void handleConfirm(action)}
			/>

			<BoostBurst ref={burstRef} />

			<Toast message={toast} onDone={() => setToast(null)} tone={tone} />
		</div>
	);
}

function animateBar(node: HTMLDivElement | null, target: number) {
	if (!node) return;
	gsap.to(node, { scaleX: target / 100, duration: 0.9, ease: "power3.out", force3D: true });
}

function animateCount(node: HTMLSpanElement | null, target: number) {
	if (!node) return;
	const obj = { val: parseInt(node.textContent ?? "0", 10) || 0 };
	gsap.to(obj, {
		val: target, duration: 0.9, snap: { val: 1 }, ease: "power2.out",
		onUpdate: () => { node.textContent = `${Math.round(obj.val)}%`; },
	});
}
