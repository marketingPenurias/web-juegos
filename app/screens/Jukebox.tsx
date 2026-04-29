import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CheckCircle2, Disc3, Search, Zap } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { TokenBadge } from "../components/TokenBadge";
import { Toast } from "../components/Toast";
import { cn } from "../lib/utils";

const BOOST_COST = 50;

export function Jukebox() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);
	const songRequests = useGameState((s) => s.songRequests);
	const boostSongRequest = useGameState((s) => s.boostSongRequest);

	const [query, setQuery] = useState("");
	const [requested, setRequested] = useState<Set<string>>(new Set());
	const [toast, setToast] = useState<string | null>(null);
	const [tone, setTone] = useState<"default" | "warning" | "success">("default");

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
		{ scope: containerRef, dependencies: [] },
	);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return songRequests;
		return songRequests.filter(
			(s) =>
				s.title.toLowerCase().includes(q) ||
				s.artist.toLowerCase().includes(q),
		);
	}, [songRequests, query]);

	const handleRequest = (id: string) => {
		setRequested((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
				setTone("default");
				setToast(t("jukebox.toastCancelled"));
			} else {
				next.add(id);
				setTone("default");
				setToast(t("jukebox.toastRequested"));
			}
			return next;
		});
	};

	const handleBoost = (id: string) => {
		const row = rowRefs.current.get(id);
		const ok = boostSongRequest(id);
		if (!ok) {
			setTone("warning");
			setToast(t("jukebox.toastNoTokens"));
			return;
		}
		setTone("success");
		setToast(t("jukebox.toastBoosted"));

		if (row) {
			const tl = gsap.timeline();
			tl.to(row, {
				boxShadow:
					"0 0 35px rgba(245,158,11,0.85), 0 0 70px rgba(245,158,11,0.5)",
				borderColor: "rgba(245,158,11,0.95)",
				scale: 1.03,
				duration: 0.3,
				ease: "power2.out",
			})
				.to(row, {
					y: -12,
					duration: 0.25,
					ease: "power2.out",
				})
				.to(row, {
					y: 0,
					scale: 1,
					boxShadow: "0 0 0 rgba(0,0,0,0)",
					duration: 0.6,
					delay: 0.4,
					ease: "power2.inOut",
				});
		}
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
				{filtered.length === 0 ? (
					<p className="text-center text-zinc-500 text-sm py-8">
						{t("jukebox.noResults")}
					</p>
				) : (
					<ul className="flex flex-col gap-3">
						{filtered.map((song) => (
							<li
								key={song.id}
								ref={(el) => {
									if (el) rowRefs.current.set(song.id, el);
								}}
								className={cn(
									"jb-row flex items-center gap-3 rounded-2xl p-3 border bg-zinc-900/40 backdrop-blur-md",
									song.boosted
										? "border-amber-400/60 shadow-[0_0_20px_rgba(245,158,11,0.35)]"
										: "border-zinc-800",
								)}
							>
								<div
									className={cn(
										"w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 border",
										song.boosted
											? "bg-amber-500/10 border-amber-500/40"
											: "bg-zinc-950 border-zinc-800",
									)}
									aria-hidden="true"
								>
									{song.cover}
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<p className="text-sm font-bold text-white truncate">
											{song.title}
										</p>
										{song.boosted && (
											<span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-[9px] font-black text-amber-300 uppercase tracking-widest shrink-0">
												<Zap className="w-2.5 h-2.5" aria-hidden="true" />
												{t("jukebox.boostedTag")}
											</span>
										)}
									</div>
									<p className="text-[11px] text-zinc-500 truncate">
										{song.artist}
									</p>
								</div>
								<div className="flex flex-col gap-1.5 shrink-0">
									<button
										type="button"
										onClick={() => handleRequest(song.id)}
										aria-pressed={requested.has(song.id)}
										className={cn(
											"h-8 px-3 rounded-full text-[11px] font-black uppercase tracking-widest border transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400 inline-flex items-center gap-1 active:scale-95",
											requested.has(song.id)
												? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300 hover:bg-rose-500/15 hover:border-rose-500/40 hover:text-rose-300"
												: "bg-zinc-900 border-zinc-700 text-zinc-300",
										)}
									>
										{requested.has(song.id) ? (
											<>
												<CheckCircle2
													className="w-3 h-3"
													aria-hidden="true"
												/>
												{t("jukebox.cancelRequest")}
											</>
										) : (
											t("jukebox.request")
										)}
									</button>
									<button
										type="button"
										onClick={() => handleBoost(song.id)}
										disabled={song.boosted}
										aria-label={t("jukebox.boostAria", { n: BOOST_COST })}
										className={cn(
											"h-8 px-3 rounded-full text-[11px] font-black uppercase tracking-widest inline-flex items-center gap-1 transition-transform focus-visible:ring-2 focus-visible:ring-amber-300",
											song.boosted
												? "bg-zinc-900 text-zinc-500 cursor-not-allowed"
												: "bg-linear-to-r from-amber-300 via-amber-500 to-amber-700 text-black active:scale-95 shadow-[0_0_15px_rgba(245,158,11,0.45)]",
										)}
									>
										<Zap className="w-3 h-3 fill-current" aria-hidden="true" />
										{t("jukebox.boost", { n: BOOST_COST })}
									</button>
								</div>
							</li>
						))}
					</ul>
				)}
			</main>

			<Toast message={toast} onDone={() => setToast(null)} tone={tone} />
		</div>
	);
}
