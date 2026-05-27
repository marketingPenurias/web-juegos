import { useEffect, useMemo, useRef, useState } from "react";
import { Disc3, Flame, Music2, Radio, Sparkles } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { getBrowserSupabase } from "../lib/supabase.client";
import { useTenant } from "../lib/tenant";
import { cn } from "../lib/utils";

/**
 * Jumbotron — the projector view of the live event.
 *
 *   - Subscribes to `postgres_changes` on `event_tracks` filtered by
 *     event_id.  Realtime delivers UPDATE / INSERT / DELETE over the
 *     same WebSocket — we apply each event to local state and let
 *     GSAP animate the diff.
 *   - Zero `setInterval`.  Zero polling.  If the WS drops, supabase-js
 *     auto-reconnects (configurable backoff).
 *   - Heavy GSAP usage: re-sort animation (each card knows its target
 *     index and tweens its `y`), counter tween on `total_votes`, and
 *     a subtle ambient pulse on the #1 slot.
 */

type Track = {
	id: string;
	title: string;
	artist: string;
	cover_image_url: string | null;
	total_votes: number;
	is_played: boolean;
};

type Props = {
	tenantId: string;
	eventId: string | null;
	initialTracks: Track[];
};

const ROW_HEIGHT = 96; // px — must match the row's CSS height
const MAX_ROWS = 8;

export function Jumbotron({ tenantId, eventId, initialTracks }: Props) {
	const tenant = useTenant();
	const [tracks, setTracks] = useState<Track[]>(initialTracks);
	const [connected, setConnected] = useState(false);

	const containerRef = useRef<HTMLDivElement>(null);
	const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
	const voteRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
	const previousVotes = useRef<Map<string, number>>(new Map());

	// Sorted derived view — Realtime updates touch raw `tracks`, but the
	// render order always comes from this memo.
	const sorted = useMemo(
		() =>
			[...tracks]
				.sort((a, b) => b.total_votes - a.total_votes)
				.slice(0, MAX_ROWS),
		[tracks],
	);

	// ── Map sweep: prune refs for tracks that have left the visible
	// window.  The TV runs for 8h+, so without this, demoted tracks
	// would accumulate as detached DOM nodes inside the closure of the
	// `Map` (DOM references in long-lived Refs == GC pin).  The ref
	// callbacks already delete on unmount-of-element, but a sort drop
	// from the top-8 to position 9 KEEPS the DOM node mounted somewhere
	// off-screen until React reconciles, so we sweep explicitly.
	useEffect(() => {
		const alive = new Set(sorted.map((t) => t.id));
		for (const id of rowRefs.current.keys()) {
			if (!alive.has(id)) rowRefs.current.delete(id);
		}
		for (const id of voteRefs.current.keys()) {
			if (!alive.has(id)) voteRefs.current.delete(id);
		}
		for (const id of previousVotes.current.keys()) {
			if (!alive.has(id)) previousVotes.current.delete(id);
		}
	}, [sorted]);

	// ── Realtime subscription ───────────────────────────────────────────
	useEffect(() => {
		const supabase = getBrowserSupabase();
		if (!supabase || !eventId) return;

		const channel = supabase
			.channel(`tv:event_tracks:${eventId}`)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "event_tracks",
					filter: `event_id=eq.${eventId}`,
				},
				(payload) => {
					setTracks((current) => {
						if (payload.eventType === "DELETE") {
							const oldId = (payload.old as { id?: string }).id;
							return oldId ? current.filter((t) => t.id !== oldId) : current;
						}
						const next = payload.new as Track;
						if (!next?.id) return current;
						const idx = current.findIndex((t) => t.id === next.id);
						if (idx === -1) {
							return [...current, next];
						}
						const clone = current.slice();
						clone[idx] = { ...current[idx], ...next };
						return clone;
					});
				},
			)
			.subscribe((status) => {
				setConnected(status === "SUBSCRIBED");
			});

		return () => {
			void supabase.removeChannel(channel);
		};
	}, [eventId]);

	// ── Re-sort animation: each card tweens its y to its target slot ───
	useGSAP(
		() => {
			sorted.forEach((track, idx) => {
				const el = rowRefs.current.get(track.id);
				if (!el) return;
				gsap.to(el, {
					y: idx * ROW_HEIGHT,
					duration: 0.6,
					ease: "power3.out",
					force3D: true,
					overwrite: "auto",
				});
			});
		},
		{ scope: containerRef, dependencies: [sorted.map((t) => t.id).join(",")] },
	);

	// ── Counter tween whenever a track's total_votes changes ────────────
	useGSAP(
		() => {
			for (const track of sorted) {
				const node = voteRefs.current.get(track.id);
				if (!node) continue;
				const previous = previousVotes.current.get(track.id) ?? track.total_votes;
				if (previous === track.total_votes) continue;
				const obj = { val: previous };
				gsap.to(obj, {
					val: track.total_votes,
					duration: 0.7,
					ease: "power2.out",
					snap: { val: 1 },
					onUpdate: () => {
						node.textContent = String(Math.round(obj.val));
					},
				});
				previousVotes.current.set(track.id, track.total_votes);
			}
		},
		{ scope: containerRef, dependencies: [sorted] },
	);

	// ── Ambient pulse on the leader card ────────────────────────────────
	useGSAP(
		() => {
			gsap.killTweensOf(".jb-leader-glow");
			gsap.to(".jb-leader-glow", {
				opacity: 0.85,
				duration: 1.6,
				yoyo: true,
				repeat: -1,
				ease: "sine.inOut",
				force3D: true,
			});
		},
		{ scope: containerRef, dependencies: [sorted[0]?.id] },
	);

	const containerStyle = useMemo(
		() => ({
			"--jumbo-primary": tenant.theme.primary ?? "#7DF9FF",
			"--jumbo-accent": tenant.theme.accent ?? "#FFD700",
			"--jumbo-bg": tenant.theme.background ?? "#050505",
		}) as React.CSSProperties,
		[tenant.theme],
	);

	return (
		<div
			ref={containerRef}
			style={containerStyle}
			className="min-h-dvh w-full bg-(--jumbo-bg) text-white relative overflow-hidden flex flex-col"
		>
			{/* Ambient backdrop */}
			<div className="absolute inset-0 pointer-events-none">
				<div className="absolute -top-32 -left-32 w-[40vw] h-[40vw] rounded-full bg-(--jumbo-primary)/20 blur-[120px]" />
				<div className="absolute -bottom-32 -right-32 w-[40vw] h-[40vw] rounded-full bg-(--jumbo-accent)/15 blur-[140px]" />
			</div>

			{/* Header */}
			<header className="relative z-10 px-12 pt-12 pb-6 flex items-center justify-between">
				<div className="flex items-center gap-4">
					<div className="w-16 h-16 rounded-2xl bg-linear-to-tr from-(--jumbo-primary) to-(--jumbo-accent) p-0.5">
						<div className="w-full h-full bg-black rounded-2xl flex items-center justify-center">
							<Disc3 className="w-8 h-8 text-(--jumbo-primary)" aria-hidden="true" />
						</div>
					</div>
					<div>
						<p className="text-xs uppercase tracking-[0.4em] text-(--jumbo-accent) font-black">
							{tenant.name}
						</p>
						<h1 className="text-5xl font-black italic tracking-tighter">
							TOP DE LA NOCHE
						</h1>
					</div>
				</div>
				<div
					className={cn(
						"inline-flex items-center gap-2 px-4 py-2 rounded-full border backdrop-blur-md",
						connected
							? "bg-lime-500/15 border-lime-400/60 text-lime-300"
							: "bg-zinc-900/60 border-zinc-700 text-zinc-400",
					)}
					aria-live="polite"
				>
					<Radio className="w-4 h-4" aria-hidden="true" />
					<span className="text-xs font-black uppercase tracking-widest">
						{connected ? "EN DIRECTO" : "Conectando…"}
					</span>
				</div>
			</header>

			{/* Leaderboard */}
			<main className="relative z-10 flex-1 px-12 pb-12">
				{!eventId ? (
					<EmptyState reason="no_active_event" />
				) : sorted.length === 0 ? (
					<EmptyState reason="no_tracks" />
				) : (
					<ol
						className="relative"
						style={{ height: `${MAX_ROWS * ROW_HEIGHT}px` }}
					>
						{sorted.map((track, idx) => (
							<li
								key={track.id}
								ref={(el) => {
									if (el) rowRefs.current.set(track.id, el);
									else rowRefs.current.delete(track.id);
								}}
								className={cn(
									"absolute top-0 left-0 right-0 flex items-center gap-6 px-6 rounded-2xl border transform-gpu translate-z-0 will-change-transform",
									idx === 0
										? "border-(--jumbo-accent)/60 bg-(--jumbo-accent)/10 shadow-[0_0_60px_rgba(255,215,0,0.35)]"
										: "border-zinc-800 bg-zinc-900/40 backdrop-blur-md",
								)}
								style={{ height: `${ROW_HEIGHT - 8}px` }}
							>
								{idx === 0 && (
									<div
										className="jb-leader-glow absolute inset-0 rounded-2xl pointer-events-none opacity-0"
										style={{
											background:
												"linear-gradient(120deg, transparent 0%, rgba(255,215,0,0.18) 50%, transparent 100%)",
										}}
										aria-hidden="true"
									/>
								)}
								<span
									className={cn(
										"text-5xl font-black italic tabular-nums w-16 text-center",
										idx === 0 ? "text-(--jumbo-accent)" : "text-zinc-500",
									)}
								>
									{idx + 1}
								</span>
								<div className="w-16 h-16 rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0">
									{track.cover_image_url ? (
										<img
											src={track.cover_image_url}
											alt=""
											className="w-full h-full object-cover"
										/>
									) : (
										<Music2 className="w-6 h-6 text-zinc-600" aria-hidden="true" />
									)}
								</div>
								<div className="flex-1 min-w-0">
									<p className="text-3xl font-black italic tracking-tight truncate">
										{track.title}
									</p>
									<p className="text-base text-zinc-400 truncate">
										{track.artist}
									</p>
								</div>
								<div className="text-right shrink-0">
									<div className="flex items-center gap-2 justify-end">
										<Sparkles
											className="w-5 h-5 text-(--jumbo-accent)"
											aria-hidden="true"
										/>
										<span
											ref={(el) => {
												if (el) voteRefs.current.set(track.id, el);
												else voteRefs.current.delete(track.id);
											}}
											className="text-4xl font-black tabular-nums text-(--jumbo-accent)"
										>
											{track.total_votes}
										</span>
									</div>
									<p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
										votos
									</p>
								</div>
								{idx === 0 && (
									<Flame
										className="w-7 h-7 text-(--jumbo-accent) shrink-0"
										aria-hidden="true"
									/>
								)}
							</li>
						))}
					</ol>
				)}
			</main>

			<footer className="relative z-10 px-12 pb-8 text-center">
				<p className="text-xs uppercase tracking-[0.4em] text-zinc-600 font-bold">
					Vota desde tu móvil · {tenant.slug}.bildy.es
				</p>
			</footer>
		</div>
	);
}

function EmptyState({ reason }: { reason: "no_active_event" | "no_tracks" }) {
	return (
		<div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center gap-4">
			<Music2 className="w-16 h-16 text-zinc-700" aria-hidden="true" />
			<p className="text-2xl font-black italic tracking-tight text-zinc-400">
				{reason === "no_active_event"
					? "No hay evento activo esta noche"
					: "Aún no hay canciones en cola"}
			</p>
		</div>
	);
}
