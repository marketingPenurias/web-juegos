import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { gsap, useGSAP } from "../lib/gsap";
import {
	Loader2, Lock, PartyPopper, Plus, Check, Radio, Trophy,
	Music2, Pencil, Trash2, Save, X, Flame, Users, Coins, BarChart3,
	Square, Search, CalendarClock, CalendarPlus, Play, ListMusic, Copy,
	Library, FolderPlus, Tv, Images, Eye, EyeOff,
} from "lucide-react";
import { getAccessToken, getBrowserSupabase } from "../lib/supabase.client";
import { useVenuePhotos } from "../lib/useVenuePhotos";
import { useTenant } from "../lib/tenant";
import { cn } from "../lib/utils";

/**
 * /admin — Consola del DJ / Staff (Bloque 4).
 *
 *   Gating: sólo `tenant_staff` (el endpoint /api/admin lo revalida).
 *   - "Abrir Fiesta de Hoy": crea/activa el tenant_event.
 *   - Editar evento (nombre, hora inicio/fin) sin fricción.
 *   - Carga masiva a global_tracks (textarea tolerante).
 *   - Biblioteca → Pista (botón + con dedupe "Añadida").
 *   - "Sonando Ahora" (exclusión mutua en BD → Now Playing en móviles).
 *   - Batalla: iniciar (semi-auto) + forzar cierre (plan B).
 *   - Métricas en vivo por polling silencioso (10s).
 */

type EventRow = { id: string; name: string; start_time: string; end_time: string | null; status: string };
type GlobalTrack = { id: string; spotify_id: string; title: string; artist: string; cover_image_url: string | null };
type EventTrack = GlobalTrack & { total_votes: number; is_played: boolean };
type Battle = { id: string; status: string; ends_at: string } | null;
type Metrics = { total_votes: number; tokens_spent_today: number; checkins_today: number; active_players: number };
type Template = { id: string; name: string; created_at: string; track_count: number };

// V1.7: navegación por pestañas estilo Rekordbox/Traktor.
type AdminTab = "live" | "templates" | "global";

type Boot =
	| { phase: "loading" }
	| { phase: "need_login" }
	| { phase: "restricted" }
	| {
			phase: "ready";
			tenantId: string;
			event: EventRow | null;
			eventsHistory: EventRow[];
			templates: Template[];
			globalTracks: GlobalTrack[];
			eventTracks: EventTrack[];
			battle: Battle;
	  };

function tenantSlugFromHost(): string {
	if (typeof window === "undefined") return "lapocha";
	const host = window.location.hostname;
	const sub = host.split(".")[0];
	if (!sub || sub === "localhost" || sub === "www" || host.includes("pages.dev")) return "lapocha";
	return sub;
}

// ── Timezone: SIEMPRE Europe/Madrid (no el reloj del dispositivo del DJ) ──
const VENUE_TZ = "Europe/Madrid";

/** Offset (ms) que Madrid lleva sobre UTC en el instante `utcMs` (maneja DST). */
function madridOffsetMs(utcMs: number): number {
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone: VENUE_TZ, year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
	});
	const p: Record<string, string> = {};
	for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
	const asUtcFromMadridWall = Date.UTC(
		Number(p.year), Number(p.month) - 1, Number(p.day),
		Number(p.hour === "24" ? "0" : p.hour), Number(p.minute), Number(p.second),
	);
	return asUtcFromMadridWall - utcMs;
}

/** ISO (UTC) almacenado → valor `datetime-local` mostrado en hora de Madrid. */
function toLocalInput(iso?: string | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	// sv-SE da formato ISO "YYYY-MM-DD HH:mm" ya en la TZ pedida.
	const s = new Intl.DateTimeFormat("sv-SE", {
		timeZone: VENUE_TZ, year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", hour12: false,
	}).format(d);
	return s.replace(" ", "T");
}

/** Valor `datetime-local` (hora-pared de Madrid) → ISO UTC correcto. */
function fromLocalInput(local: string): string | undefined {
	if (!local) return undefined;
	const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
	if (!m) return undefined;
	const [, y, mo, d, h, mi] = m.map(Number);
	// Interpretamos la hora-pared como UTC y restamos el offset de Madrid
	// para obtener el instante real (DST incluido).
	const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
	const offset = madridOffsetMs(wallAsUtc);
	return new Date(wallAsUtc - offset).toISOString();
}

export default function Admin() {
	const [boot, setBoot] = useState<Boot>({ phase: "loading" });
	const [metrics, setMetrics] = useState<Metrics | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// spotify_id de la última canción inyectada desde la Biblioteca → la fila
	// correspondiente del PlaylistPanel hace un "flash" GSAP de confirmación.
	const [flashSpotifyId, setFlashSpotifyId] = useState<string | null>(null);
	// V1.7 · navegación por pestañas + estado de modales.
	const [activeTab, setActiveTab] = useState<AdminTab>("live");
	const [loadOpen, setLoadOpen] = useState(false); // modal "Cargar canciones" (live)
	const [createTplOpen, setCreateTplOpen] = useState(false); // modal "Crear plantilla"
	const [saveSessionOpen, setSaveSessionOpen] = useState(false); // modal "Guardar sesión"
	// Señal de inyección masiva → PlaylistPanel hace pulse + auto-scroll.
	const [pulse, setPulse] = useState(0);
	const cheer = (n: number) => {
		flash(`✅ ${n} ${n === 1 ? "canción inyectada" : "canciones inyectadas"} en la pista`);
		setPulse((p) => p + 1);
	};

	const call = useCallback(async (op: string, payload: Record<string, unknown> = {}) => {
		// NUNCA cacheamos el JWT: supabase-js refresca el token por debajo.
		// Un token cacheado caducaría a la hora y bloquearía al DJ con 401s.
		const token = await getAccessToken();
		if (!token) return { ok: false, error: "unauthorized" } as Record<string, unknown>;
		const res = await fetch("/api/admin", {
			method: "POST",
			cache: "no-store",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"X-Tenant-Slug": tenantSlugFromHost(),
			},
			body: JSON.stringify({ op, tenant_slug: tenantSlugFromHost(), ...payload }),
		});
		return (await res.json().catch(() => ({ ok: false, error: "network_error" }))) as Record<string, unknown>;
	}, []);

	const refresh = useCallback(async () => {
		const token = await getAccessToken();
		if (!token) { setBoot({ phase: "need_login" }); return; }
		const data = await call("bootstrap");
		if (data.ok !== true) { setBoot({ phase: "need_login" }); return; }
		if (data.is_staff !== true) { setBoot({ phase: "restricted" }); return; }
		setBoot({
			phase: "ready",
			tenantId: String(data.tenant_id ?? ""),
			event: (data.event as EventRow) ?? null,
			eventsHistory: (data.events_history as EventRow[]) ?? [],
			templates: (data.templates as Template[]) ?? [],
			globalTracks: (data.global_tracks as GlobalTrack[]) ?? [],
			eventTracks: (data.event_tracks as EventTrack[]) ?? [],
			battle: (data.battle as Battle) ?? null,
		});
	}, [call]);

	useEffect(() => { void refresh(); }, [refresh]);

	// Valores estables para los efectos Realtime: sólo cambian al abrir/cambiar
	// de fiesta o de batalla — así el canal NO se re-suscribe en cada voto.
	const ready = boot.phase === "ready" ? boot : null;
	const eventId = ready?.event?.id ?? null;
	const tenantId = ready?.tenantId ?? null;
	const liveBattleId = ready?.battle?.status === "live" ? ready.battle.id : null;
	const liveBattleEndsAt = ready?.battle?.status === "live" ? ready.battle.ends_at : null;

	// Muta la playlist EN VIVO desde el payload de event_tracks (votos suben,
	// is_played cambia) sin recargar — el DJ ve la pista moverse al instante.
	const applyTrackChange = useCallback((payload: {
		eventType?: string;
		new?: Record<string, unknown>;
		old?: Record<string, unknown>;
	}) => {
		setBoot((prev) => {
			if (prev.phase !== "ready") return prev;
			if (payload.eventType === "DELETE") {
				const oldId = String(payload.old?.id ?? "");
				return oldId
					? { ...prev, eventTracks: prev.eventTracks.filter((t) => t.id !== oldId) }
					: prev;
			}
			const row = payload.new ?? {};
			const id = String(row.id ?? "");
			if (!id) return prev;
			let found = false;
			let next = prev.eventTracks.map((t) => {
				if (t.id !== id) return t;
				found = true;
				return {
					...t,
					total_votes: Number(row.total_votes ?? t.total_votes),
					is_played: typeof row.is_played === "boolean" ? row.is_played : t.is_played,
					title: String(row.title ?? t.title),
					artist: String(row.artist ?? t.artist),
					cover_image_url: (row.cover_image_url as string | null) ?? t.cover_image_url,
				};
			});
			if (!found) {
				next = [...next, {
					id,
					spotify_id: String(row.spotify_id ?? ""),
					title: String(row.title ?? ""),
					artist: String(row.artist ?? ""),
					cover_image_url: (row.cover_image_url as string | null) ?? null,
					total_votes: Number(row.total_votes ?? 0),
					is_played: row.is_played === true,
				}];
			}
			next = next.slice().sort((a, b) => b.total_votes - a.total_votes || a.title.localeCompare(b.title));
			return { ...prev, eventTracks: next };
		});
	}, []);

	// Métricas EN VIVO vía WebSockets (asimetría de conexión: sólo el panel
	// del staff se suscribe; los móviles siguen con HTTP).  Escuchamos los
	// INSERT en `behavior_events` (pulso de la sala) y los cambios en
	// `event_tracks` (votos) — ambos en la publicación supabase_realtime y
	// protegidos por RLS de tenant/staff.  Un micro-debounce coalesce las
	// ráfagas para no martillear el RPC de agregados.  Cero polling.
	useEffect(() => {
		if (!eventId || !tenantId) return;
		const tid = tenantId;
		let active = true;
		let debounce: number | null = null;

		const fetchMetrics = async () => {
			const m = await call("metrics", { event_id: eventId });
			if (active && m.ok === true) {
				setMetrics({
					total_votes: Number(m.total_votes ?? 0),
					tokens_spent_today: Number(m.tokens_spent_today ?? 0),
					checkins_today: Number(m.checkins_today ?? 0),
					active_players: Number(m.active_players ?? 0),
				});
			}
		};
		const onChange = () => {
			if (debounce) window.clearTimeout(debounce);
			debounce = window.setTimeout(() => void fetchMetrics(), 250);
		};

		void fetchMetrics(); // primer valor inmediato

		const supabase = getBrowserSupabase();
		if (!supabase) return () => { active = false; };
		// Escuchamos TODAS las tablas que alimentan get_admin_metrics, no sólo
		// el pulso de behavior_events: wallet_ledger (tokens gastados),
		// venue_visits (check-ins/entrada), track_votes (jugadores) y
		// event_tracks (votos totales).  Así el debounce salta cuando la
		// gente gasta en barra o entra por la puerta — métricas 100% vivas.
		// event_tracks: además de refrescar métricas, MUTAMOS la playlist en
		// vivo (votos / is_played) para que la lista del DJ no quede congelada.
		const onTrack = (payload: { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
			applyTrackChange(payload);
			onChange();
		};

		const channel = supabase
			.channel(`admin-metrics-${eventId}`)
			.on("postgres_changes", { event: "INSERT", schema: "public", table: "behavior_events", filter: `tenant_id=eq.${tid}` }, onChange)
			.on("postgres_changes", { event: "*", schema: "public", table: "event_tracks", filter: `tenant_id=eq.${tid}` }, onTrack)
			.on("postgres_changes", { event: "INSERT", schema: "public", table: "wallet_ledger", filter: `tenant_id=eq.${tid}` }, onChange)
			.on("postgres_changes", { event: "INSERT", schema: "public", table: "venue_visits", filter: `tenant_id=eq.${tid}` }, onChange)
			.on("postgres_changes", { event: "INSERT", schema: "public", table: "track_votes", filter: `tenant_id=eq.${tid}` }, onChange)
			.subscribe();

		return () => {
			active = false;
			if (debounce) window.clearTimeout(debounce);
			void supabase.removeChannel(channel);
		};
	}, [eventId, tenantId, call, applyTrackChange]);

	// Autocierre de la BATALLA (sustituye al viejo polling): timer hasta
	// `ends_at` (+500ms) que dispara el cierre quirúrgico en backend.  El
	// UPDATE de live_battles emite por Realtime el ganador a móviles y TV.
	useEffect(() => {
		if (!liveBattleId || !liveBattleEndsAt || !eventId) return;
		const ms = new Date(liveBattleEndsAt).getTime() - Date.now();
		const id = window.setTimeout(async () => {
			await call("resolve_battles", { event_id: eventId });
			await refresh();
		}, Math.max(0, ms) + 500);
		return () => window.clearTimeout(id);
	}, [liveBattleId, liveBattleEndsAt, eventId, call, refresh]);

	const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2600); };
	const run = async (op: string, payload: Record<string, unknown>, okMsg?: string) => {
		setBusy(true);
		const r = await call(op, payload);
		setBusy(false);
		if (r.ok === true) { if (okMsg) flash(okMsg); await refresh(); }
		else flash(`⚠️ ${String(r.error ?? "error")}`);
		return r;
	};

	// Borrado OPTIMISTA de una pista: la sacamos del estado local AL INSTANTE
	// (UI responde sin esperar a la red) y luego confirmamos contra el backend.
	// Si falla, revalidamos para "deshacer" el borrado optimista.
	const removeTrackOptimistic = async (trackId: string) => {
		setBoot((prev) =>
			prev.phase === "ready"
				? { ...prev, eventTracks: prev.eventTracks.filter((t) => t.id !== trackId) }
				: prev,
		);
		const r = await call("remove_track", { track_id: trackId });
		if (r.ok === true) {
			flash("Canción quitada");
		} else {
			flash(`⚠️ ${String(r.error ?? "error")}`);
			await refresh(); // re-sincroniza: la canción vuelve si no se borró
		}
	};

	// ── Render por fases ──────────────────────────────────────────────
	if (boot.phase === "loading") {
		return <Center><Loader2 className="w-10 h-10 animate-spin text-cyan-400" /><p className="text-zinc-300 font-bold mt-3">Cargando panel…</p></Center>;
	}
	if (boot.phase === "need_login") {
		return <Center><Lock className="w-12 h-12 text-zinc-600" /><h1 className="text-2xl font-black italic text-white mt-3">Inicia sesión</h1><p className="text-zinc-400 mt-1">Entra con tu cuenta de staff para acceder al panel del DJ.</p><Link to="/" className="mt-4 h-12 px-6 rounded-2xl bg-white text-black font-black flex items-center">Ir a la app</Link></Center>;
	}
	if (boot.phase === "restricted") {
		return <Center><Lock className="w-12 h-12 text-rose-500" /><h1 className="text-2xl font-black italic text-white mt-3">Acceso restringido</h1><p className="text-zinc-400 mt-1">Tu cuenta no tiene rol de staff en este local.</p></Center>;
	}

	const { event, eventsHistory, templates, globalTracks, eventTracks, battle } = boot;
	const eventSpotifyIds = new Set(eventTracks.map((t) => t.spotify_id));

	return (
		<div className="min-h-dvh w-full bg-zinc-950 text-white">
			<div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-5">
				<header className="flex items-center gap-3">
					<Radio className="w-7 h-7 text-cyan-400" />
					<div>
						<h1 className="text-2xl font-black italic tracking-tight">Panel DJ · La Pocha</h1>
						<p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Consola de Staff</p>
					</div>
				</header>

				{!event ? (
					// Sin fiesta activa: abrir la de hoy o programar/activar otra.
					<>
						<OpenPartyButton busy={busy} onOpen={() => run("open_party", {}, "¡Fiesta abierta!")} />
						<EventsManager
							events={eventsHistory}
							activeId={null}
							busy={busy}
							onCreate={(payload) => run("create_event", payload, "Evento programado")}
							onActivate={(id) => run("activate_event", { event_id: id }, "Evento activado")}
						/>
					</>
				) : (
					<>
						{/* Cabecera de sesión: evento activo + métricas (siempre visible) */}
						<EventCard event={event} busy={busy} onSave={(patch) => run("update_event", { event_id: event.id, ...patch }, "Evento actualizado")} />
						<MetricsRow metrics={metrics} />

						<TabBar active={activeTab} onChange={setActiveTab} templateCount={templates.length} />

						{/* ── PESTAÑA 1 · SESIÓN EN VIVO ─────────────────────── */}
						{activeTab === "live" && (
							<div className="flex flex-col gap-5">
								<BattlePanel
									battle={battle}
									tracks={eventTracks}
									busy={busy}
									onStart={(trackA, trackB, minutes) => run("start_battle", { event_id: event.id, track_a: trackA, track_b: trackB, minutes }, "¡Batalla iniciada!")}
									onForceClose={() => run("force_close_battle", { event_id: event.id }, "Batalla cerrada")}
								/>

								<TvControlPanel
									slug={tenantSlugFromHost()}
									busy={busy}
									onSet={(s) =>
										run(
											"set_tv_backdrop",
											{
												event_id: event.id,
												tv_mode: s.mode,
												tv_url: s.url,
												tv_show_ranking: s.showRanking,
												tv_show_battle: s.showBattle,
												tv_show_now_playing: s.showNowPlaying,
											},
											s.mode === "photo"
												? "📌 Foto fijada en la TV"
												: s.mode === "video"
													? "📺 Sólo vídeo en la TV"
													: "🔄 Carrusel mixto en la TV",
										)
									}
								/>

								{eventTracks.length === 0 ? (
									// Pista vacía → llamada a la acción gigante centrada.
									<button
										type="button"
										onClick={() => setLoadOpen(true)}
										className="rounded-3xl border-2 border-dashed border-cyan-500/40 bg-cyan-500/5 hover:bg-cyan-500/10 p-12 flex flex-col items-center justify-center gap-3 active:scale-[0.99] transition-all"
									>
										<div className="w-16 h-16 rounded-full bg-cyan-500/15 border border-cyan-400/50 flex items-center justify-center">
											<Plus className="w-9 h-9 text-cyan-300" strokeWidth={2.5} />
										</div>
										<span className="text-2xl font-black italic tracking-tight">Cargar Canciones</span>
										<span className="text-sm text-zinc-400 font-bold">Inyecta temas desde la biblioteca o una plantilla</span>
									</button>
								) : (
									<>
										{/* Botón ARRIBA de la lista (la pista ya tiene temas). */}
										<button
											type="button"
											onClick={() => setLoadOpen(true)}
											className="h-12 rounded-2xl bg-cyan-500 text-black font-black inline-flex items-center justify-center gap-2 active:scale-95 shadow-[0_0_20px_rgba(0,212,255,0.3)]"
										>
											<Plus className="w-5 h-5" strokeWidth={3} /> Cargar canciones
										</button>
										<PlaylistPanel
											tracks={eventTracks}
											busy={busy}
											pulse={pulse}
											flashSpotifyId={flashSpotifyId}
											onFlashDone={() => setFlashSpotifyId(null)}
											onNowPlaying={(id) => run("now_playing", { event_id: event.id, track_id: id }, "Sonando ahora ▶")}
											onStopAll={() => run("stop_now_playing", { event_id: event.id }, "⏹ Nada sonando")}
											onUpdate={(id, patch) => run("update_track", { track_id: id, ...patch }, "Canción actualizada")}
											onRemove={(id) => removeTrackOptimistic(id)}
										/>
										{/* Al final de la pista: guardar la sesión como plantilla. */}
										<button
											type="button"
											onClick={() => setSaveSessionOpen(true)}
											className="h-12 rounded-2xl bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/40 font-black inline-flex items-center justify-center gap-2 active:scale-95"
										>
											<Save className="w-4 h-4" /> Guardar esta sesión como Plantilla
										</button>
									</>
								)}

								{/* Programación de eventos (gestión de sesiones) */}
								<EventsManager
									events={eventsHistory}
									activeId={event.id}
									busy={busy}
									onCreate={(payload) => run("create_event", payload, "Evento programado")}
									onActivate={(id) => run("activate_event", { event_id: id }, "Evento activado")}
								/>
							</div>
						)}

						{/* ── PESTAÑA 2 · GESTIÓN DE PLANTILLAS ──────────────── */}
						{activeTab === "templates" && (
							<TemplatesPanel
								templates={templates}
								hasActiveEvent={true}
								busy={busy}
								onCreate={() => setCreateTplOpen(true)}
								onApply={(id) => run("apply_template", { event_id: event.id, template_id: id }, "Plantilla aplicada al evento")}
								onRename={(id, name) => run("rename_template", { template_id: id, name }, "Plantilla renombrada")}
								onDelete={(id) => run("delete_template", { template_id: id }, "Plantilla borrada")}
							/>
						)}

						{/* ── PESTAÑA 3 · ALMACÉN GLOBAL ─────────────────────── */}
						{activeTab === "global" && (
							<LibraryPanel
								tracks={globalTracks}
								busy={busy}
								onBulk={(raw) => run("bulk_global", { raw, event_id: event.id }, "Biblioteca + pista actualizadas")}
							/>
						)}
					</>
				)}
			</div>

			{/* ── Modales ────────────────────────────────────────────── */}
			{event && loadOpen && (
				<LoadIntoEventModal
					globalTracks={globalTracks}
					eventSpotifyIds={eventSpotifyIds}
					templates={templates}
					busy={busy}
					onClose={() => setLoadOpen(false)}
					onInject={async (ids) => {
						const r = await run("add_event_tracks", { event_id: event.id, global_ids: ids });
						if (r.ok === true) { setLoadOpen(false); cheer(Number(r.added ?? ids.length)); }
					}}
					onApplyTemplate={async (id) => {
						const r = await run("apply_template", { event_id: event.id, template_id: id });
						if (r.ok === true) { setLoadOpen(false); cheer(Number(r.added ?? 0)); }
					}}
				/>
			)}

			{event && saveSessionOpen && (
				<SaveTemplateModal
					busy={busy}
					onClose={() => setSaveSessionOpen(false)}
					onSave={async (name) => {
						const r = await run("save_template", { event_id: event.id, name }, "Sesión guardada como plantilla");
						if (r.ok === true) setSaveSessionOpen(false);
					}}
				/>
			)}

			{createTplOpen && (
				<CreateTemplateModal
					globalTracks={globalTracks}
					busy={busy}
					onClose={() => setCreateTplOpen(false)}
					onCreate={async (name, ids) => {
						const r = await run("create_template", { name, global_ids: ids }, "Plantilla creada");
						if (r.ok === true) setCreateTplOpen(false);
					}}
				/>
			)}

			{toast && (
				<div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[120] px-5 py-3 rounded-2xl bg-zinc-900 border border-zinc-700 text-sm font-bold shadow-xl">
					{toast}
				</div>
			)}
		</div>
	);
}

// ── Subcomponentes ──────────────────────────────────────────────────

function Center({ children }: { children: React.ReactNode }) {
	return <div className="min-h-dvh w-full bg-zinc-950 flex flex-col items-center justify-center text-center px-6">{children}</div>;
}

function OpenPartyButton({ busy, onOpen }: { busy: boolean; onOpen: () => void }) {
	return (
		<button
			type="button"
			disabled={busy}
			onClick={onOpen}
			className="w-full rounded-3xl bg-linear-to-br from-lime-400 to-emerald-500 text-black p-10 flex flex-col items-center gap-3 active:scale-[0.98] transition-transform shadow-[0_0_50px_rgba(57,255,20,0.4)] disabled:opacity-60"
		>
			<PartyPopper className="w-16 h-16" />
			<span className="text-3xl font-black italic tracking-tight">Abrir Fiesta de Hoy</span>
			<span className="text-sm font-bold opacity-80">Crea y activa el evento para empezar a trabajar</span>
		</button>
	);
}

function EventCard({ event, busy, onSave }: { event: EventRow; busy: boolean; onSave: (p: Record<string, unknown>) => void }) {
	const [name, setName] = useState(event.name);
	const [start, setStart] = useState(toLocalInput(event.start_time));
	const [end, setEnd] = useState(toLocalInput(event.end_time));
	useEffect(() => { setName(event.name); setStart(toLocalInput(event.start_time)); setEnd(toLocalInput(event.end_time)); }, [event]);

	const dirty = name !== event.name || start !== toLocalInput(event.start_time) || end !== toLocalInput(event.end_time);

	return (
		<section className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5">
			<div className="flex items-center justify-between mb-3">
				<span className="inline-flex items-center gap-2 text-lime-300 font-black text-xs uppercase tracking-widest">
					<span className="w-2 h-2 rounded-full bg-lime-400 animate-pulse" /> Fiesta activa
				</span>
				<button
					type="button"
					disabled={!dirty || busy}
					onClick={() => onSave({ name, start_time: fromLocalInput(start), end_time: fromLocalInput(end) })}
					className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-cyan-500 text-black font-black text-sm active:scale-95 disabled:opacity-40"
				>
					<Save className="w-4 h-4" /> Guardar
				</button>
			</div>
			<label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Nombre del evento</label>
			<input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-11 rounded-xl bg-zinc-950 border border-zinc-800 px-3 font-bold text-white mb-3" />
			<div className="grid grid-cols-2 gap-3">
				<div>
					<label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Empieza</label>
					<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="w-full h-11 rounded-xl bg-zinc-950 border border-zinc-800 px-3 text-white text-sm" />
				</div>
				<div>
					<label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Termina</label>
					<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full h-11 rounded-xl bg-zinc-950 border border-zinc-800 px-3 text-white text-sm" />
				</div>
			</div>
		</section>
	);
}

function MetricsRow({ metrics }: { metrics: Metrics | null }) {
	const items = [
		{ icon: BarChart3, label: "Votos", value: metrics?.total_votes ?? "—", color: "text-cyan-300" },
		{ icon: Coins, label: "Tokens gastados", value: metrics?.tokens_spent_today ?? "—", color: "text-amber-300" },
		{ icon: Flame, label: "Check-ins hoy", value: metrics?.checkins_today ?? "—", color: "text-orange-300" },
		{ icon: Users, label: "Jugadores", value: metrics?.active_players ?? "—", color: "text-lime-300" },
	];
	return (
		<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
			{items.map(({ icon: Icon, label, value, color }) => (
				<div key={label} className="rounded-2xl bg-zinc-900/60 border border-zinc-800 p-4 flex flex-col gap-1">
					<Icon className={`w-5 h-5 ${color}`} />
					<span className="text-2xl font-black tabular-nums">{value}</span>
					<span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{label}</span>
				</div>
			))}
		</div>
	);
}

function BattlePanel({ battle, tracks, busy, onStart, onForceClose }: {
	battle: Battle; tracks: EventTrack[]; busy: boolean;
	onStart: (trackA: string, trackB: string, minutes: number) => void;
	onForceClose: () => void;
}) {
	const [minutes, setMinutes] = useState(3);
	const [trackA, setTrackA] = useState("");
	const [trackB, setTrackB] = useState("");
	const live = battle && battle.status === "live";

	// Sólo pistas elegibles: no sonadas (el RPC también lo valida server-side).
	const eligible = tracks.filter((t) => !t.is_played);
	const canStart = !!trackA && !!trackB && trackA !== trackB;

	return (
		<section className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col gap-4">
			<div className="flex items-center gap-2">
				<Trophy className="w-5 h-5 text-amber-400" />
				<span className="font-black">Batalla de Temas</span>
				{live && <span className="text-[10px] uppercase tracking-widest text-rose-300 font-black bg-rose-950/50 border border-rose-500/40 px-2 py-0.5 rounded-full">EN VIVO</span>}
			</div>

			{!live ? (
				<>
					<p className="text-xs text-zinc-500 font-bold">Elige las dos canciones que se enfrentan:</p>
					<div className="grid sm:grid-cols-2 gap-3">
						<BattleSelect label="Tema A" value={trackA} onChange={setTrackA} tracks={eligible} disabledId={trackB} accent="cyan" />
						<BattleSelect label="Tema B" value={trackB} onChange={setTrackB} tracks={eligible} disabledId={trackA} accent="amber" />
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<div className="flex items-center gap-2">
							<label className="text-xs text-zinc-400 font-bold">Minutos</label>
							<input type="number" min={1} max={15} value={minutes} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 3))} className="w-16 h-10 rounded-xl bg-zinc-950 border border-zinc-800 px-2 text-center font-bold" />
						</div>
						<button
							type="button"
							disabled={busy || !canStart}
							onClick={() => onStart(trackA, trackB, minutes)}
							className="ml-auto h-10 px-5 rounded-xl bg-amber-400 text-black font-black active:scale-95 disabled:opacity-40"
						>
							⚔ Iniciar Batalla
						</button>
					</div>
					{eligible.length < 2 && (
						<p className="text-[11px] text-zinc-500">Necesitas al menos 2 canciones sin sonar en la fiesta para montar una batalla.</p>
					)}
				</>
			) : (
				<button type="button" disabled={busy} onClick={onForceClose} className="h-10 px-5 rounded-xl bg-rose-500 text-black font-black active:scale-95 disabled:opacity-50 self-start">Forzar Cierre de Batalla</button>
			)}
		</section>
	);
}

function BattleSelect({ label, value, onChange, tracks, disabledId, accent }: {
	label: string; value: string; onChange: (v: string) => void;
	tracks: EventTrack[]; disabledId: string; accent: "cyan" | "amber";
}) {
	const ring = accent === "cyan" ? "border-cyan-500/40" : "border-amber-500/40";
	return (
		<div>
			<label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">{label}</label>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className={`w-full h-11 rounded-xl bg-zinc-950 border ${ring} px-3 font-bold text-sm text-white`}
			>
				<option value="">— Elegir canción —</option>
				{tracks.map((t) => (
					<option key={t.id} value={t.id} disabled={t.id === disabledId}>
						{t.title} · {t.artist} ({t.total_votes})
					</option>
				))}
			</select>
		</div>
	);
}

// ── Control de Pantallas (TV) — fijar imagen o carrusel (V1.7) ───────
// Mini-panel para que el DJ controle el FONDO de la pantalla del local en
// directo: clavar un flyer concreto o dejar el carrusel automático.  La
// preferencia se persiste (tenant_events.metadata) y la TV la escucha por
// Realtime → el cambio se ve al instante en la pantalla grande.
type TvState = {
	mode: "video" | "photo" | "carousel";
	url: string | null;
	showRanking: boolean;
	showBattle: boolean;
	// V17: partir la pantalla mostrando la canción que suena ahora.
	showNowPlaying: boolean;
};

function TvControlPanel({ slug, busy, onSet }: {
	slug: string; busy: boolean;
	onSet: (state: TvState) => void;
}) {
	const photos = useVenuePhotos(slug);
	const tenant = useTenant();
	const hasVideo = Boolean(tenant.bgVideoUrl);
	// Selección local (refleja el último clic del DJ).  La verdad vive en la
	// BD y la TV la recibe por Realtime.
	const [sel, setSel] = useState<TvState>({
		mode: "carousel",
		url: null,
		showRanking: true,
		showBattle: true,
		showNowPlaying: false,
	});

	// Aplica un cambio parcial: actualiza el estado local Y lo envía entero
	// al backend (la pantalla recibe el objeto completo por Realtime).
	const apply = (patch: Partial<TvState>) => {
		const next = { ...sel, ...patch };
		setSel(next);
		onSet(next);
	};

	return (
		<section className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<Tv className="w-5 h-5 text-cyan-400" />
				<span className="font-black">Control de Pantallas (TV)</span>
			</div>
			<p className="text-[11px] text-zinc-500">
				Elige qué se ve de fondo y qué capas mostrar en la pantalla del local. El cambio se aplica al instante.
			</p>

			{/* Selector de MODO de fondo: Carrusel mixto · Sólo vídeo */}
			<div className="grid grid-cols-2 gap-3">
				<button
					type="button"
					disabled={busy}
					onClick={() => apply({ mode: "carousel", url: null })}
					className={cn(
						"rounded-2xl border-2 p-3 flex flex-col items-center justify-center gap-1 active:scale-95 transition-all",
						sel.mode === "carousel"
							? "border-cyan-400 bg-cyan-500/15 text-cyan-200 shadow-[0_0_18px_rgba(0,212,255,0.3)]"
							: "border-zinc-700 bg-zinc-950/60 text-zinc-300",
					)}
				>
					<Images className="w-5 h-5" />
					<span className="text-[10px] font-black uppercase tracking-widest">Carrusel mixto</span>
					<span className="text-[9px] text-zinc-500">Vídeo + fotos</span>
				</button>
				<button
					type="button"
					disabled={busy || !hasVideo}
					onClick={() => apply({ mode: "video", url: null })}
					title={hasVideo ? "Mostrar sólo el vídeo del local" : "Este local no tiene vídeo configurado"}
					className={cn(
						"rounded-2xl border-2 p-3 flex flex-col items-center justify-center gap-1 active:scale-95 transition-all",
						sel.mode === "video"
							? "border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-200 shadow-[0_0_18px_rgba(232,121,249,0.3)]"
							: "border-zinc-700 bg-zinc-950/60 text-zinc-300",
						!hasVideo && "opacity-40 cursor-not-allowed",
					)}
				>
					<Tv className="w-5 h-5" />
					<span className="text-[10px] font-black uppercase tracking-widest">Sólo vídeo</span>
					<span className="text-[9px] text-zinc-500">{hasVideo ? "Identidad del local" : "Sin vídeo"}</span>
				</button>
			</div>

			{/* Toggles de CAPAS: ranking, batalla y canción actual */}
			<div className="grid grid-cols-3 gap-3">
				<LayerToggle
					label="Ranking"
					on={sel.showRanking}
					busy={busy}
					onToggle={() => apply({ showRanking: !sel.showRanking })}
				/>
				<LayerToggle
					label="Batalla"
					on={sel.showBattle}
					busy={busy}
					onToggle={() => apply({ showBattle: !sel.showBattle })}
				/>
				{/* V17: split view — media pantalla ranking, media canción actual. */}
				<LayerToggle
					label="Canción actual"
					on={sel.showNowPlaying}
					busy={busy}
					onToggle={() => apply({ showNowPlaying: !sel.showNowPlaying })}
				/>
			</div>
			<p className="text-[10px] text-zinc-600 px-1">
				Oculta el ranking y la batalla para dejar la pantalla sólo con el fondo. Activa <span className="text-cyan-300 font-bold">Canción actual</span> para partir la pantalla: ranking a la izquierda y la canción que suena a la derecha.
			</p>

			{/* Fijar una FOTO concreta (mode='photo') */}
			<div className="flex items-center justify-between px-1 pt-1">
				<span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Fijar una foto</span>
				<span className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold tabular-nums">{photos.length} fotos</span>
			</div>
			{photos.length === 0 ? (
				<p className="text-zinc-500 text-xs text-center py-3">No hay fotos subidas para este local todavía.</p>
			) : (
				<div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
					{photos.map((url) => {
						const active = sel.mode === "photo" && sel.url === url;
						return (
							<button
								key={url}
								type="button"
								disabled={busy}
								onClick={() => apply({ mode: "photo", url })}
								title="Fijar esta foto (el vídeo se pausa)"
								className={cn(
									"relative aspect-video rounded-xl overflow-hidden border-2 active:scale-95 transition-all",
									active ? "border-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.45)]" : "border-zinc-700 hover:border-zinc-500",
								)}
							>
								<img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" />
								{active && (
									<span className="absolute inset-0 bg-amber-500/25 flex items-center justify-center">
										<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400 text-black text-[9px] font-black uppercase tracking-widest">
											<Check className="w-3 h-3" /> Fijada
										</span>
									</span>
								)}
							</button>
						);
					})}
				</div>
			)}
		</section>
	);
}

// Toggle mostrar/ocultar una capa de la TV (ranking o batalla).
function LayerToggle({ label, on, busy, onToggle }: {
	label: string; on: boolean; busy: boolean; onToggle: () => void;
}) {
	return (
		<button
			type="button"
			disabled={busy}
			onClick={onToggle}
			aria-pressed={on}
			className={cn(
				"rounded-2xl border-2 p-3 flex items-center justify-center gap-2 active:scale-95 transition-all",
				on
					? "border-lime-400/70 bg-lime-500/10 text-lime-200"
					: "border-zinc-700 bg-zinc-950/60 text-zinc-500",
			)}
		>
			{on ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
			<span className="text-[11px] font-black uppercase tracking-widest">{label}</span>
			<span className="text-[9px] font-bold opacity-70">{on ? "Visible" : "Oculto"}</span>
		</button>
	);
}

// ── PESTAÑA 3 · Almacén Global (data-entry del manager) ──────────────
// Bulk add masivo + catálogo de sólo lectura.  Inyectar a la pista de hoy
// NO vive aquí: se hace desde el modal "Cargar canciones" de la pestaña Live.
function LibraryPanel({ tracks, busy, onBulk }: {
	tracks: GlobalTrack[]; busy: boolean;
	onBulk: (raw: string) => void;
}) {
	const [raw, setRaw] = useState("");
	const [query, setQuery] = useState("");
	const filtered = filterTracks(tracks, query);
	return (
		<section className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col gap-3 min-h-0">
			<div>
				<h2 className="font-black flex items-center gap-2"><Library className="w-5 h-5 text-cyan-400" /> Almacén Global</h2>
				<p className="text-[11px] text-zinc-500 mt-1">El catálogo permanente del local. Pega canciones nuevas aquí (el manager actualiza el catálogo). Para meterlas en la fiesta de hoy, usa <span className="text-cyan-300 font-bold">Cargar canciones</span> en la pestaña Sesión.</p>
			</div>
			<textarea
				value={raw}
				onChange={(e) => setRaw(e.target.value)}
				placeholder={"Pega las canciones en este formato (admite varias):\n('0TJYJrUDKQ1btt4g0Xwklw', 'LA GRACIOSA', 'Quevedo, Elvis Crespo', 'https://i.scdn.co/image/...')"}
				className="w-full h-32 rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-xs font-mono text-zinc-200 resize-none"
			/>
			<button type="button" disabled={busy || !raw.trim()} onClick={() => { onBulk(raw); setRaw(""); }} className="h-11 rounded-xl bg-cyan-500 text-black font-black active:scale-95 disabled:opacity-40 inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4" strokeWidth={3} /> Cargar al almacén</button>

			<SearchInput value={query} onChange={setQuery} placeholder="Buscar en el almacén…" />

			<div className="flex items-center justify-between px-1">
				<span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Catálogo</span>
				<span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold tabular-nums">{tracks.length} temas</span>
			</div>

			<div className="flex flex-col gap-2 overflow-y-auto max-h-[480px] no-scrollbar">
				{tracks.length === 0 && <p className="text-zinc-500 text-sm text-center py-4">Almacén vacío. Pega canciones arriba.</p>}
				{tracks.length > 0 && filtered.length === 0 && <p className="text-zinc-500 text-sm text-center py-4">Sin resultados para “{query}”.</p>}
				{filtered.map((tk) => (
					<div key={tk.id} className="flex items-center gap-3 rounded-xl bg-zinc-950/60 border border-zinc-800 p-2.5">
						<div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0">
							{tk.cover_image_url ? <img src={tk.cover_image_url} alt="" className="w-full h-full object-cover" /> : <Music2 className="w-4 h-4 text-zinc-600" />}
						</div>
						<div className="flex-1 min-w-0">
							<p className="text-sm font-bold truncate">{tk.title}</p>
							<p className="text-[11px] text-zinc-500 truncate">{tk.artist}</p>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

function PlaylistPanel({ tracks, busy, flashSpotifyId, onFlashDone, pulse = 0, onNowPlaying, onStopAll, onUpdate, onRemove }: {
	tracks: EventTrack[]; busy: boolean;
	flashSpotifyId: string | null;
	onFlashDone: () => void;
	pulse?: number; // se incrementa tras una inyección masiva → feedback visual
	onNowPlaying: (id: string) => void;
	onStopAll: () => void;
	onUpdate: (id: string, patch: Record<string, unknown>) => void;
	onRemove: (id: string) => void;
}) {
	const [editing, setEditing] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const filtered = filterTracks(tracks, query);
	const somethingPlaying = tracks.some((t) => t.is_played);
	const sectionRef = useRef<HTMLElement>(null);
	const headerRef = useRef<HTMLDivElement>(null);

	// Inyección masiva: en vez de animar 50 filas (mata el FPS), pulsamos el
	// HEADER y auto-scrolleamos la pista a la vista → el cerebro del DJ valida
	// que "algo entró" sin coste de rendimiento.
	useGSAP(
		() => {
			if (pulse <= 0) return;
			sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
			if (headerRef.current) {
				gsap.fromTo(
					headerRef.current,
					{ scale: 1 },
					{ scale: 1.06, duration: 0.22, ease: "power2.out", yoyo: true, repeat: 1, transformOrigin: "left center" },
				);
				gsap.fromTo(
					headerRef.current,
					{ color: "#39FF14" },
					{ color: "#ffffff", duration: 1.1, ease: "power2.inOut" },
				);
			}
		},
		{ dependencies: [pulse] },
	);

	return (
		<section ref={sectionRef} className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col gap-3 min-h-0 scroll-mt-20">
			<div className="flex items-center justify-between gap-2">
				<h2 ref={headerRef} className="font-black flex items-center gap-2"><Radio className="w-5 h-5 text-lime-400" /> Control de Pista (esta noche)</h2>
				<button
					type="button"
					disabled={busy || !somethingPlaying}
					onClick={onStopAll}
					title="Dejar de marcar cualquier canción como sonando"
					className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-rose-500/15 text-rose-300 border border-rose-500/40 font-black text-xs active:scale-95 disabled:opacity-40"
				>
					<Square className="w-3.5 h-3.5 fill-current" /> Parar todo
				</button>
			</div>

			<SearchInput value={query} onChange={setQuery} placeholder="Buscar canción en la fiesta…" />

			<div className="flex flex-col gap-2 overflow-y-auto max-h-[520px] no-scrollbar">
				{tracks.length === 0 && <p className="text-zinc-500 text-sm text-center py-4">Aún no hay canciones en la fiesta. Añádelas desde la biblioteca.</p>}
				{tracks.length > 0 && filtered.length === 0 && <p className="text-zinc-500 text-sm text-center py-4">Sin resultados para “{query}”.</p>}
				{filtered.map((tk) => (
					<PlaylistRow
						key={tk.id}
						track={tk}
						busy={busy}
						editing={editing === tk.id}
						flash={!!flashSpotifyId && tk.spotify_id === flashSpotifyId}
						onFlashDone={onFlashDone}
						onEdit={() => setEditing(tk.id)}
						onCancel={() => setEditing(null)}
						onNowPlaying={() => onNowPlaying(tk.id)}
						onSave={(patch) => { onUpdate(tk.id, patch); setEditing(null); }}
						onRemove={() => onRemove(tk.id)}
					/>
				))}
			</div>
		</section>
	);
}

function PlaylistRow({ track, busy, editing, flash, onFlashDone, onEdit, onCancel, onNowPlaying, onSave, onRemove }: {
	track: EventTrack; busy: boolean; editing: boolean;
	flash: boolean; onFlashDone: () => void;
	onEdit: () => void; onCancel: () => void; onNowPlaying: () => void;
	onSave: (patch: Record<string, unknown>) => void; onRemove: () => void;
}) {
	const [title, setTitle] = useState(track.title);
	const [artist, setArtist] = useState(track.artist);
	const [cover, setCover] = useState(track.cover_image_url ?? "");
	const rowRef = useRef<HTMLDivElement>(null);
	// Guard anti-estroboscópico: garantiza que el flash se ejecuta UNA sola vez
	// por activación.  Sin esto, un re-render de la tabla (p.ej. un voto entrante)
	// mientras `flash` sigue true podría re-disparar el destello.
	const flashedRef = useRef(false);
	useEffect(() => { setTitle(track.title); setArtist(track.artist); setCover(track.cover_image_url ?? ""); }, [track, editing]);

	// Flash de confirmación cuando esta canción acaba de entrar desde la
	// Biblioteca (el DJ ve "entrar" la pista sin buscarla a ojo).  Al terminar,
	// `onFlashDone` resetea el flashId en el padre → la prop vuelve a false y el
	// guard se rearma para el próximo añadido.  Nunca se repite por sí solo.
	useGSAP(
		() => {
			if (!flash) { flashedRef.current = false; return; }
			if (flashedRef.current || !rowRef.current) return;
			flashedRef.current = true;
			const el = rowRef.current;
			const tl = gsap.timeline({ onComplete: onFlashDone });
			tl.fromTo(
				el,
				{ boxShadow: "0 0 0 rgba(57,255,20,0)", borderColor: "rgba(57,255,20,0.9)", backgroundColor: "rgba(57,255,20,0.18)" },
				{ boxShadow: "0 0 30px rgba(57,255,20,0.7)", scale: 1.02, duration: 0.3, ease: "power2.out" },
			).to(el, { boxShadow: "0 0 0 rgba(57,255,20,0)", backgroundColor: "rgba(0,0,0,0)", scale: 1, duration: 0.9, ease: "power2.inOut" });
		},
		{ dependencies: [flash] },
	);

	if (editing) {
		return (
			<div className="rounded-xl bg-zinc-950/80 border border-cyan-500/40 p-3 flex flex-col gap-2">
				<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" className="h-10 rounded-lg bg-zinc-900 border border-zinc-800 px-3 font-bold text-sm" />
				<input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artista" className="h-10 rounded-lg bg-zinc-900 border border-zinc-800 px-3 text-sm" />
				<input value={cover} onChange={(e) => setCover(e.target.value)} placeholder="URL portada" className="h-10 rounded-lg bg-zinc-900 border border-zinc-800 px-3 text-xs font-mono" />
				<div className="flex gap-2">
					<button type="button" disabled={busy} onClick={() => onSave({ title, artist, cover_image_url: cover })} className="flex-1 h-9 rounded-lg bg-cyan-500 text-black font-black text-sm inline-flex items-center justify-center gap-1"><Save className="w-4 h-4" /> Guardar</button>
					<button type="button" onClick={onCancel} className="h-9 px-3 rounded-lg bg-zinc-800 text-zinc-300 font-bold text-sm inline-flex items-center gap-1"><X className="w-4 h-4" /></button>
				</div>
			</div>
		);
	}

	return (
		<div ref={rowRef} className={`flex items-center gap-3 rounded-xl border p-2.5 ${track.is_played ? "bg-lime-500/10 border-2 border-lime-400 shadow-[0_0_18px_rgba(57,255,20,0.35)]" : "bg-zinc-950/60 border-zinc-800"}`}>
			<div className="w-9 text-center shrink-0">
				<span className="text-sm font-black tabular-nums text-zinc-400">{track.total_votes}</span>
			</div>
			<div className="flex-1 min-w-0">
				<p className="text-sm font-bold truncate">{track.title}</p>
				<p className="text-[11px] text-zinc-500 truncate">{track.artist}</p>
			</div>
			{/* Semántica visual (V1.6 B5): la pista activa NO tiene botón de
			    acción — se DESTACA con borde verde + estado.  El resto muestran
			    la ACCIÓN "▶ Poner" en gris/azul (no verde) para no confundir
			    estado con acción. */}
			{track.is_played ? (
				<span className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-lime-500/20 text-lime-300 border border-lime-500/50 font-black text-xs uppercase tracking-wide">
					🎧 Sonando ahora
				</span>
			) : (
				<button
					type="button"
					disabled={busy}
					onClick={onNowPlaying}
					title="Poner esta canción ahora"
					className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-sky-900/70 text-sky-200 border border-sky-700/60 hover:bg-sky-800/70 font-black text-xs active:scale-95 disabled:opacity-50"
				>
					▶ Poner
				</button>
			)}
			<button type="button" onClick={onEdit} title="Editar canción" className="shrink-0 w-9 h-9 rounded-lg bg-zinc-800 text-zinc-300 flex items-center justify-center active:scale-95"><Pencil className="w-4 h-4" /></button>
			<button
				type="button"
				disabled={busy}
				onClick={onRemove}
				title="Quitar de la pista de esta noche"
				aria-label={`Quitar ${track.title}`}
				className="shrink-0 inline-flex items-center gap-1 h-9 px-2.5 rounded-lg bg-rose-600 text-white border border-rose-400 font-black text-xs active:scale-95 disabled:opacity-50 shadow-[0_0_12px_rgba(244,63,94,0.4)]"
			>
				<Trash2 className="w-4 h-4" /> Quitar
			</button>
		</div>
	);
}

// ── Helpers compartidos ──────────────────────────────────────────────

/**
 * Normaliza acentos/tildes para búsqueda en español: "Despechá" ≈ "despecha".
 * NFD descompone la letra acentuada en base + diacrítico y borramos el rango
 * de combining marks (U+0300–U+036F).
 */
const removeAccents = (str: string) =>
	str.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Filtro client-side instantáneo por título o artista (búsqueda B3/B4),
 *  insensible a tildes en ambos lados (query y datos). */
function filterTracks<T extends { title: string; artist: string }>(tracks: T[], query: string): T[] {
	const q = removeAccents(query.trim());
	if (!q) return tracks;
	return tracks.filter(
		(t) => removeAccents(t.title).includes(q) || removeAccents(t.artist).includes(q),
	);
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
	return (
		<div className="relative">
			<Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
			<input
				type="search"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="w-full h-10 rounded-xl bg-zinc-950 border border-zinc-800 pl-9 pr-3 text-sm text-white"
			/>
		</div>
	);
}

/** Fecha/hora amigable en hora de Madrid. */
function fmtMadrid(iso?: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "—";
	return new Intl.DateTimeFormat("es-ES", {
		timeZone: VENUE_TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
	}).format(d);
}

const EVENT_STATUS_META: Record<string, { label: string; cls: string }> = {
	active: { label: "Activo", cls: "text-lime-300 bg-lime-500/15 border-lime-500/40" },
	scheduled: { label: "Programado", cls: "text-cyan-300 bg-cyan-500/15 border-cyan-500/40" },
	draft: { label: "Borrador", cls: "text-amber-300 bg-amber-500/15 border-amber-500/40" },
	closed: { label: "Cerrado", cls: "text-zinc-400 bg-zinc-800/60 border-zinc-700" },
	ended: { label: "Cerrado", cls: "text-zinc-400 bg-zinc-800/60 border-zinc-700" },
};

// ── Histórico + programación de eventos (V1.6 B1/B2) ─────────────────
function EventsManager({ events, activeId, busy, onCreate, onActivate }: {
	events: EventRow[]; activeId: string | null; busy: boolean;
	onCreate: (payload: Record<string, unknown>) => void;
	onActivate: (id: string) => void;
}) {
	const [name, setName] = useState("");
	const [start, setStart] = useState("");
	const [end, setEnd] = useState("");
	const canCreate = !!name.trim() && !!start && !busy;

	const submit = () => {
		if (!canCreate) return;
		onCreate({ name: name.trim(), start_time: fromLocalInput(start), end_time: fromLocalInput(end) });
		setName(""); setStart(""); setEnd("");
	};

	return (
		<section className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col gap-4">
			<h2 className="font-black flex items-center gap-2"><CalendarClock className="w-5 h-5 text-cyan-400" /> Eventos</h2>

			{/* Programar evento futuro */}
			<div className="rounded-2xl bg-zinc-950/60 border border-zinc-800 p-4 flex flex-col gap-3">
				<p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold flex items-center gap-1.5"><CalendarPlus className="w-3.5 h-3.5" /> Programar nuevo evento</p>
				<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la fiesta" className="w-full h-11 rounded-xl bg-zinc-950 border border-zinc-800 px-3 font-bold text-white text-sm" />
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Empieza</label>
						<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="w-full h-11 rounded-xl bg-zinc-950 border border-zinc-800 px-3 text-white text-sm" />
					</div>
					<div>
						<label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Termina (opcional)</label>
						<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full h-11 rounded-xl bg-zinc-950 border border-zinc-800 px-3 text-white text-sm" />
					</div>
				</div>
				<button type="button" disabled={!canCreate} onClick={submit} className="h-10 rounded-xl bg-cyan-500 text-black font-black active:scale-95 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
					<CalendarPlus className="w-4 h-4" /> Programar evento
				</button>
			</div>

			{/* Histórico */}
			<div className="flex flex-col gap-2">
				{events.length === 0 && <p className="text-zinc-500 text-sm text-center py-4">Sin eventos todavía.</p>}
				{events.map((ev) => {
					const meta = EVENT_STATUS_META[ev.status] ?? { label: ev.status, cls: "text-zinc-400 bg-zinc-800/60 border-zinc-700" };
					const isActive = ev.id === activeId || ev.status === "active";
					const canActivate = !isActive && (ev.status === "scheduled" || ev.status === "draft" || ev.status === "closed" || ev.status === "ended");
					return (
						<div key={ev.id} className="flex items-center gap-3 rounded-xl bg-zinc-950/60 border border-zinc-800 p-3">
							<div className="flex-1 min-w-0">
								<p className="text-sm font-bold truncate flex items-center gap-2">
									{ev.name}
									<span className={`text-[9px] uppercase tracking-widest font-black px-1.5 py-0.5 rounded-full border ${meta.cls}`}>{meta.label}</span>
								</p>
								<p className="text-[11px] text-zinc-500 truncate">{fmtMadrid(ev.start_time)}{ev.end_time ? ` → ${fmtMadrid(ev.end_time)}` : ""}</p>
							</div>
							{canActivate && (
								<button
									type="button"
									disabled={busy}
									onClick={() => onActivate(ev.id)}
									title="Activar este evento ahora"
									className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-lime-400 text-black font-black text-xs active:scale-95 disabled:opacity-50"
								>
									<Play className="w-3.5 h-3.5 fill-current" /> Activar
								</button>
							)}
						</div>
					);
				})}
			</div>
		</section>
	);
}

// ── Plantillas de setlist (V1.6.1) ───────────────────────────────────
// ── PESTAÑA 2 · Gestión de Plantillas (trabajo de oficina) ───────────
function TemplatesPanel({ templates, hasActiveEvent, busy, onCreate, onApply, onRename, onDelete }: {
	templates: Template[]; hasActiveEvent: boolean; busy: boolean;
	onCreate: () => void;
	onApply: (id: string) => Promise<unknown> | void;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<section className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col gap-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h2 className="font-black flex items-center gap-2"><ListMusic className="w-5 h-5 text-fuchsia-400" /> Gestión de Plantillas</h2>
					<p className="text-[11px] text-zinc-500 mt-1">Crea setlists reutilizables desde el catálogo, sin necesidad de una fiesta activa. Aplícalos a cualquier evento con un clic.</p>
				</div>
				<button
					type="button"
					onClick={onCreate}
					className="shrink-0 inline-flex items-center gap-1.5 h-11 px-4 rounded-xl bg-fuchsia-500 text-white font-black text-sm active:scale-95 shadow-[0_0_20px_rgba(217,70,239,0.35)]"
				>
					<FolderPlus className="w-4 h-4" /> Crear plantilla
				</button>
			</div>

			<div className="flex flex-col gap-2">
				{templates.length === 0 && <div className="text-zinc-500 italic py-6 text-center">No hay plantillas guardadas.</div>}
				{templates.map((tpl) => (
					<TemplateRow
						key={tpl.id}
						tpl={tpl}
						busy={busy}
						hasActiveEvent={hasActiveEvent}
						onApply={onApply}
						onRename={onRename}
						onDelete={onDelete}
					/>
				))}
			</div>
		</section>
	);
}

function TemplateRow({ tpl, busy, hasActiveEvent, onApply, onRename, onDelete }: {
	tpl: Template; busy: boolean; hasActiveEvent: boolean;
	onApply: (id: string) => Promise<unknown> | void;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(tpl.name);
	const [applying, setApplying] = useState(false);
	useEffect(() => { setName(tpl.name); }, [tpl.name]);

	const handleApply = async () => {
		if (applying) return;
		setApplying(true);
		try { await onApply(tpl.id); } finally { setApplying(false); }
	};

	if (editing) {
		return (
			<div className="flex items-center gap-2 rounded-xl bg-zinc-950/80 border border-fuchsia-500/40 p-3">
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="flex-1 h-10 rounded-lg bg-zinc-900 border border-zinc-800 px-3 font-bold text-sm text-white"
					autoFocus
				/>
				<button type="button" disabled={busy || !name.trim()} onClick={() => { onRename(tpl.id, name.trim()); setEditing(false); }} className="h-10 px-3 rounded-lg bg-fuchsia-500 text-white font-black text-sm inline-flex items-center gap-1 disabled:opacity-40"><Save className="w-4 h-4" /></button>
				<button type="button" onClick={() => { setName(tpl.name); setEditing(false); }} className="h-10 px-3 rounded-lg bg-zinc-800 text-zinc-300 font-bold text-sm inline-flex items-center gap-1"><X className="w-4 h-4" /></button>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-3 rounded-xl bg-zinc-950/60 border border-zinc-800 p-3">
			<div className="w-10 h-10 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30 flex items-center justify-center shrink-0">
				<ListMusic className="w-4 h-4 text-fuchsia-300" />
			</div>
			<div className="flex-1 min-w-0">
				<p className="text-sm font-bold truncate">{tpl.name}</p>
				<p className="text-[11px] text-zinc-500">{tpl.track_count} {tpl.track_count === 1 ? "canción" : "canciones"} · {fmtMadrid(tpl.created_at)}</p>
			</div>
			{hasActiveEvent && (
				<button
					type="button"
					disabled={busy || applying}
					onClick={() => void handleApply()}
					title="Inyectar esta plantilla en el evento activo"
					className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/40 font-black text-xs active:scale-95 disabled:opacity-50"
				>
					{applying ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Aplicando…</> : <><Copy className="w-3.5 h-3.5" /> Aplicar</>}
				</button>
			)}
			<button type="button" disabled={busy} onClick={() => setEditing(true)} title="Renombrar" className="shrink-0 w-9 h-9 rounded-lg bg-zinc-800 text-zinc-300 flex items-center justify-center active:scale-95 disabled:opacity-50"><Pencil className="w-4 h-4" /></button>
			<button type="button" disabled={busy} onClick={() => onDelete(tpl.id)} title="Borrar plantilla" className="shrink-0 w-9 h-9 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center justify-center active:scale-95 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
		</div>
	);
}

// ── Navegación por pestañas (Rekordbox/Traktor style) ────────────────
function TabBar({ active, onChange, templateCount }: {
	active: AdminTab; onChange: (t: AdminTab) => void; templateCount: number;
}) {
	const tabs: { id: AdminTab; label: string; Icon: typeof Radio }[] = [
		{ id: "live", label: "Sesión en vivo", Icon: Radio },
		{ id: "templates", label: "Plantillas", Icon: ListMusic },
		{ id: "global", label: "Almacén global", Icon: Library },
	];
	return (
		<div className="flex gap-1 p-1 rounded-2xl bg-zinc-900/70 border border-zinc-800 sticky top-2 z-20 backdrop-blur-md">
			{tabs.map(({ id, label, Icon }) => {
				const on = active === id;
				return (
					<button
						key={id}
						type="button"
						onClick={() => onChange(id)}
						className={cn(
							"flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-xl font-black text-[11px] sm:text-xs uppercase tracking-wide transition-colors",
							on ? "bg-cyan-500 text-black shadow-[0_0_18px_rgba(0,212,255,0.4)]" : "text-zinc-400 hover:text-zinc-200",
						)}
					>
						<Icon className="w-4 h-4" />
						<span className="hidden xs:inline sm:inline">{label}</span>
						{id === "templates" && templateCount > 0 && (
							<span className={cn("text-[10px] rounded-full px-1.5 tabular-nums", on ? "bg-black/20" : "bg-zinc-800")}>{templateCount}</span>
						)}
					</button>
				);
			})}
		</div>
	);
}

// ── Modal genérico (overlay oscuro + entrada GSAP suave) ─────────────
function Modal({ title, subtitle, onClose, children, footer }: {
	title: string; subtitle?: string; onClose: () => void;
	children: React.ReactNode; footer?: React.ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useGSAP(() => {
		if (ref.current) {
			gsap.fromTo(ref.current, { opacity: 0, y: 24, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(1.4)" });
		}
	});
	return (
		<div
			className="fixed inset-0 z-[150] bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-6"
			onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
		>
			<div ref={ref} className="w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[85dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden">
				<header className="flex items-center justify-between gap-3 p-5 border-b border-zinc-800 shrink-0">
					<div>
						<h3 className="text-lg font-black italic tracking-tight">{title}</h3>
						{subtitle && <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>}
					</div>
					<button type="button" onClick={onClose} aria-label="Cerrar" className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95"><X className="w-4 h-4" /></button>
				</header>
				<div className="flex-1 min-h-0 overflow-y-auto no-scrollbar p-5">{children}</div>
				{footer && <footer className="p-4 border-t border-zinc-800 shrink-0 bg-zinc-950">{footer}</footer>}
			</div>
		</div>
	);
}

// ── Selector multi-canción con checkboxes (reusado por modales) ──────
function GlobalPicker({ tracks, selected, onToggle, setSelected }: {
	tracks: GlobalTrack[]; selected: Set<string>; onToggle: (id: string) => void;
	setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
	const [query, setQuery] = useState("");
	const filtered = filterTracks(tracks, query);
	const allFilteredSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));

	// Operan sobre lo ACTUALMENTE filtrado (la búsqueda acota el "todas").
	const selectAllFiltered = () =>
		setSelected((prev) => {
			const n = new Set(prev);
			filtered.forEach((t) => n.add(t.id));
			return n;
		});
	const clearAllFiltered = () =>
		setSelected((prev) => {
			const n = new Set(prev);
			filtered.forEach((t) => n.delete(t.id));
			return n;
		});

	return (
		<div className="flex flex-col gap-3">
			<SearchInput value={query} onChange={setQuery} placeholder="Buscar en el almacén…" />

			{/* Herramientas de selección masiva */}
			<div className="flex items-center justify-between gap-2">
				<span className="text-[11px] text-zinc-500 font-bold tabular-nums">
					{selected.size} sel. · {filtered.length} visibles
				</span>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={selectAllFiltered}
						disabled={filtered.length === 0 || allFilteredSelected}
						className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 font-black text-[11px] active:scale-95 disabled:opacity-40"
					>
						<Check className="w-3.5 h-3.5" strokeWidth={3} /> Todas
					</button>
					<button
						type="button"
						onClick={clearAllFiltered}
						disabled={selected.size === 0}
						className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 font-black text-[11px] active:scale-95 disabled:opacity-40"
					>
						<X className="w-3.5 h-3.5" strokeWidth={3} /> Ninguna
					</button>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				{tracks.length === 0 && <p className="text-zinc-500 text-sm text-center py-6">El almacén está vacío. Añade canciones en la pestaña «Almacén global».</p>}
				{tracks.length > 0 && filtered.length === 0 && <p className="text-zinc-500 text-sm text-center py-6">Sin resultados.</p>}
				{filtered.map((tk) => {
					const on = selected.has(tk.id);
					return (
						<button
							key={tk.id}
							type="button"
							onClick={() => onToggle(tk.id)}
							className={cn(
								"flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors",
								on ? "bg-cyan-500/10 border-cyan-500/50" : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700",
							)}
						>
							<span className={cn("w-6 h-6 rounded-md border flex items-center justify-center shrink-0", on ? "bg-cyan-500 border-cyan-400 text-black" : "border-zinc-600")}>
								{on && <Check className="w-4 h-4" strokeWidth={3} />}
							</span>
							<div className="w-9 h-9 rounded-lg overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0">
								{tk.cover_image_url ? <img src={tk.cover_image_url} alt="" className="w-full h-full object-cover" /> : <Music2 className="w-4 h-4 text-zinc-600" />}
							</div>
							<div className="flex-1 min-w-0">
								<p className="text-sm font-bold truncate">{tk.title}</p>
								<p className="text-[11px] text-zinc-500 truncate">{tk.artist}</p>
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}

// ── Modal "Cargar canciones" (Live): Biblioteca (multi) + Plantilla ──
function LoadIntoEventModal({ globalTracks, eventSpotifyIds, templates, busy, onClose, onInject, onApplyTemplate }: {
	globalTracks: GlobalTrack[]; eventSpotifyIds: Set<string>; templates: Template[]; busy: boolean;
	onClose: () => void;
	onInject: (ids: string[]) => void;
	onApplyTemplate: (id: string) => void;
}) {
	const [sub, setSub] = useState<"library" | "template">("library");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	// Sólo mostramos lo que AÚN no está en la pista (lo ya presente no se re-inyecta).
	const addable = globalTracks.filter((t) => !eventSpotifyIds.has(t.spotify_id));
	const toggle = (id: string) =>
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(id)) n.delete(id); else n.add(id);
			return n;
		});

	return (
		<Modal
			title="Cargar canciones"
			subtitle="Inyecta temas en la pista de esta noche"
			onClose={onClose}
			footer={
				sub === "library" ? (
					<button
						type="button"
						disabled={busy || selected.size === 0}
						onClick={() => onInject([...selected])}
						className="w-full h-12 rounded-2xl bg-cyan-500 text-black font-black inline-flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40"
					>
						<Plus className="w-5 h-5" strokeWidth={3} /> Inyectar seleccionadas ({selected.size})
					</button>
				) : null
			}
		>
			{/* Sub-pestañas */}
			<div className="flex gap-1 p-1 rounded-xl bg-zinc-900 border border-zinc-800 mb-4">
				<button type="button" onClick={() => setSub("library")} className={cn("flex-1 h-9 rounded-lg font-black text-xs uppercase tracking-wide", sub === "library" ? "bg-cyan-500 text-black" : "text-zinc-400")}>Desde Biblioteca</button>
				<button type="button" onClick={() => setSub("template")} className={cn("flex-1 h-9 rounded-lg font-black text-xs uppercase tracking-wide", sub === "template" ? "bg-fuchsia-500 text-white" : "text-zinc-400")}>Desde Plantilla</button>
			</div>

			{sub === "library" ? (
				<GlobalPicker tracks={addable} selected={selected} onToggle={toggle} setSelected={setSelected} />
			) : (
				<div className="flex flex-col gap-2">
					{templates.length === 0 && <p className="text-zinc-500 italic text-center py-6">No hay plantillas. Crea una en la pestaña «Plantillas».</p>}
					{templates.map((tpl) => (
						<div key={tpl.id} className="flex items-center gap-3 rounded-xl bg-zinc-900/60 border border-zinc-800 p-3">
							<div className="w-10 h-10 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30 flex items-center justify-center shrink-0"><ListMusic className="w-4 h-4 text-fuchsia-300" /></div>
							<div className="flex-1 min-w-0">
								<p className="text-sm font-bold truncate">{tpl.name}</p>
								<p className="text-[11px] text-zinc-500">{tpl.track_count} {tpl.track_count === 1 ? "canción" : "canciones"}</p>
							</div>
							<button type="button" disabled={busy} onClick={() => onApplyTemplate(tpl.id)} className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-fuchsia-500 text-white font-black text-xs active:scale-95 disabled:opacity-50">
								<Plus className="w-3.5 h-3.5" strokeWidth={3} /> Inyectar
							</button>
						</div>
					))}
				</div>
			)}
		</Modal>
	);
}

// ── Modal "Crear plantilla" (Templates): multi-select + nombre ───────
function CreateTemplateModal({ globalTracks, busy, onClose, onCreate }: {
	globalTracks: GlobalTrack[]; busy: boolean;
	onClose: () => void;
	onCreate: (name: string, ids: string[]) => void;
}) {
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [name, setName] = useState("");
	const toggle = (id: string) =>
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(id)) n.delete(id); else n.add(id);
			return n;
		});
	const canSave = !!name.trim() && selected.size > 0 && !busy;

	return (
		<Modal
			title="Crear nueva plantilla"
			subtitle="Selecciona temas del almacén — no necesitas una fiesta activa"
			onClose={onClose}
			footer={
				<div className="flex flex-col sm:flex-row gap-3 sm:items-center">
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Nombre de la plantilla (ej. Reggaetón Viernes)"
						className="flex-1 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 px-3 font-bold text-white text-sm"
					/>
					<button
						type="button"
						disabled={!canSave}
						onClick={() => onCreate(name.trim(), [...selected])}
						className="shrink-0 h-12 px-5 rounded-2xl bg-fuchsia-500 text-white font-black inline-flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40"
					>
						<Save className="w-4 h-4" /> Guardar plantilla ({selected.size})
					</button>
				</div>
			}
		>
			<GlobalPicker tracks={globalTracks} selected={selected} onToggle={toggle} setSelected={setSelected} />
		</Modal>
	);
}

// ── Modal "Guardar sesión como plantilla" (Live) ─────────────────────
// (Sustituye cualquier prompt() nativo — modal Tailwind con backdrop.)
function SaveTemplateModal({ busy, onClose, onSave }: {
	busy: boolean; onClose: () => void; onSave: (name: string) => void;
}) {
	const [name, setName] = useState("");
	return (
		<Modal
			title="Guardar sesión como plantilla"
			subtitle="Guarda el setlist actual para repetirlo otra noche"
			onClose={onClose}
			footer={
				<button
					type="button"
					disabled={busy || !name.trim()}
					onClick={() => onSave(name.trim())}
					className="w-full h-12 rounded-2xl bg-fuchsia-500 text-white font-black inline-flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40"
				>
					<Save className="w-4 h-4" /> Guardar plantilla
				</button>
			}
		>
			<label className="block text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Nombre de la plantilla</label>
			<input
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder="Ej. Sábado Techno"
				autoFocus
				className="w-full h-12 rounded-2xl bg-zinc-900 border border-zinc-800 px-3 font-bold text-white text-sm"
			/>
		</Modal>
	);
}
