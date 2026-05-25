import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ArrowLeft,
	Disc3,
	Flame,
	Music2,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { useDJLeaderboard } from "../lib/useMusic";
import { useTenant } from "../lib/tenant";
import { cn } from "../lib/utils";

/**
 * DJDashboard — B2B leaderboard for the booth.
 *
 *   - Reads `?event=<uuid>` from the URL.  In demo mode (no real event
 *     id) shows an empty-state with a one-tap "use demo event" CTA.
 *   - Polls `/api/music?mode=leaderboard` every 5 s.  The Edge worker
 *     enforces the `dj` role via `tenant_staff`; a 403 surfaces in the
 *     hook's `error` field.
 *   - Realtime via Supabase channels would be the long-term path; for
 *     a CEO demo a 5-second poll is plenty smooth and avoids opening
 *     a WebSocket from the browser to the database.
 */

const DEMO_EVENT_ID_PARAM = "event";

export function DJDashboard() {
	const { t } = useTranslation();
	const tenant = useTenant();
	const setScreen = useGameState((s) => s.setScreen);

	const eventId = useMemo(() => {
		if (typeof window === "undefined") return null;
		const url = new URL(window.location.href);
		return url.searchParams.get(DEMO_EVENT_ID_PARAM);
	}, []);

	const [eventInput, setEventInput] = useState(eventId ?? "");

	const containerRef = useRef<HTMLDivElement>(null);
	const { tracks, loading, error, reload } = useDJLeaderboard(eventId, 5_000);

	useGSAP(
		() => {
			gsap.from(".dj-row", {
				y: 12,
				opacity: 0,
				stagger: 0.04,
				duration: 0.35,
				ease: "power3.out",
				force3D: true,
			});
		},
		{ scope: containerRef, dependencies: [tracks.length] },
	);

	const updateEventId = () => {
		if (typeof window === "undefined") return;
		const clean = eventInput.trim();
		const url = new URL(window.location.href);
		if (clean) url.searchParams.set(DEMO_EVENT_ID_PARAM, clean);
		else url.searchParams.delete(DEMO_EVENT_ID_PARAM);
		window.history.replaceState(null, "", url.toString());
		window.location.reload();
	};

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col relative z-20 min-h-0 overflow-hidden bg-black"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-2 flex items-center justify-between shrink-0">
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
						{tenant.name}
					</p>
					<h1 className="text-base font-black italic tracking-tight text-white">
						{t("dj.title")}
					</h1>
				</div>
				<button
					type="button"
					onClick={() => void reload()}
					aria-label={t("dj.refresh")}
					className={cn(
						"w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400",
						loading && "opacity-60",
					)}
				>
					<RefreshCw
						className={cn("w-4 h-4", loading && "animate-spin")}
						aria-hidden="true"
					/>
				</button>
			</header>

			<section className="px-6 pt-2 pb-3 shrink-0">
				<label className="block">
					<span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
						{t("dj.eventIdLabel")}
					</span>
					<div className="mt-1 flex items-center gap-2">
						<input
							type="text"
							value={eventInput}
							onChange={(e) => setEventInput(e.target.value)}
							placeholder="00000000-…"
							className="flex-1 h-10 rounded-xl bg-zinc-900/80 border border-zinc-800 px-3 text-sm font-mono text-white placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
						/>
						<button
							type="button"
							onClick={updateEventId}
							className="h-10 px-4 rounded-xl bg-amber-500 text-black font-black text-[12px] uppercase tracking-widest active:scale-95 focus-visible:ring-2 focus-visible:ring-amber-300"
						>
							{t("dj.refresh")}
						</button>
					</div>
				</label>
				<p className="text-[11px] text-zinc-500 mt-2">{t("dj.subtitle")}</p>
			</section>

			{error === "forbidden" && (
				<div className="mx-6 mb-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-rose-200 text-sm">
					{t("dj.roleRequired")}
				</div>
			)}

			<main className="flex-1 min-h-0 px-4 pb-4 overflow-y-auto no-scrollbar">
				{tracks.length === 0 && !loading && error !== "forbidden" ? (
					<p className="text-center text-zinc-500 text-sm py-12">
						{t("dj.empty")}
					</p>
				) : (
					<ol className="flex flex-col gap-2">
						{tracks.map((track, i) => (
							<li
								key={track.id}
								className={cn(
									"dj-row flex items-center gap-3 rounded-2xl p-3 border bg-zinc-900/40 backdrop-blur-md transform-gpu translate-z-0 will-change-transform",
									track.is_played
										? "border-zinc-800 opacity-60"
										: i === 0
											? "border-amber-400/60 shadow-[0_0_22px_rgba(245,158,11,0.35)]"
											: "border-zinc-800",
								)}
							>
								<div className="w-10 h-10 rounded-xl flex items-center justify-center text-[15px] font-black bg-zinc-950 border border-zinc-800 text-amber-300 shrink-0">
									{i + 1}
								</div>
								<div className="w-12 h-12 rounded-xl shrink-0 overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center">
									{track.cover_image_url ? (
										<img
											src={track.cover_image_url}
											alt=""
											className="w-full h-full object-cover"
										/>
									) : (
										<Music2
											className="w-5 h-5 text-zinc-600"
											aria-hidden="true"
										/>
									)}
								</div>
								<div className="flex-1 min-w-0">
									<p className="text-sm font-bold text-white truncate">
										{track.title}
									</p>
									<p className="text-[11px] text-zinc-500 truncate">
										{track.artist}
									</p>
								</div>
								<div className="text-right shrink-0">
									<p className="text-base font-black text-amber-300 tabular-nums leading-none flex items-center gap-1 justify-end">
										<Sparkles className="w-3 h-3" aria-hidden="true" />
										{track.total_votes}
									</p>
									<p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mt-0.5">
										{track.is_played ? t("dj.played") : t("dj.totalVotes", { n: track.total_votes })}
									</p>
								</div>
								{i === 0 && !track.is_played && (
									<Flame
										className="w-4 h-4 text-amber-300 shrink-0"
										aria-hidden="true"
									/>
								)}
							</li>
						))}
					</ol>
				)}
			</main>
		</div>
	);
}
