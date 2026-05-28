import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { useMusic } from "../lib/useMusic";
import { Toast } from "../components/Toast";
import { LiveHeader } from "../components/live/LiveHeader";
import { SongRow } from "../components/live/SongRow";
import { BoostBurst } from "../components/live/BoostBurst";
import { VoteFooter, type VoteAction } from "../components/live/VoteFooter";

/**
 * LiveBattle — REAL.
 *
 *   Toma las dos canciones más votadas del evento activo y monta el
 *   "duelo" en directo.  Cada acción persiste via `vote_track`:
 *
 *     · "free"  → +1 voto, 0 tokens
 *     · "boost" → +5 votos, -30 tokens (BOOST_COST)
 *
 *   Si el evento aún no tiene 2 tracks, mostramos empty-state.  Si el
 *   usuario ya votó las dos top, también — la unicidad
 *   `(track_id, user_id)` la fuerza el server.
 *
 *   Sin polling — para el piloto refrescamos al confirmar voto.  La
 *   suscripción Realtime queda para el Jumbotron.
 */

const BOOST_COST = 30;

export function LiveBattle() {
	const { t } = useTranslation();
	const tokens = useGameState((s) => s.tokens);
	const setBalance = useGameState((s) => s.setBalance);
	const activeEventId = useGameState((s) => s.activeEventId);
	const { deck, loading, error, castVote, reload } = useMusic(activeEventId);

	const containerRef = useRef<HTMLDivElement>(null);
	const aBarRef = useRef<HTMLDivElement>(null);
	const bBarRef = useRef<HTMLDivElement>(null);
	const aPctRef = useRef<HTMLSpanElement>(null);
	const bPctRef = useRef<HTMLSpanElement>(null);
	const burstRef = useRef<HTMLDivElement>(null);

	const [voted, setVoted] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const [tone, setTone] = useState<"default" | "success" | "warning">(
		"default",
	);

	const [a, b] = useMemo(() => deck.slice(0, 2), [deck]);

	const totalVotes = (a?.total_votes ?? 0) + (b?.total_votes ?? 0);
	const aPct =
		totalVotes > 0
			? Math.round(((a?.total_votes ?? 0) / totalVotes) * 100)
			: 50;
	const bPct = 100 - aPct;

	useGSAP(
		() => {
			gsap.from(".live-fade", {
				y: 16,
				opacity: 0,
				stagger: 0.07,
				duration: 0.5,
				ease: "power3.out",
			});
		},
		{ scope: containerRef },
	);

	useGSAP(
		() => {
			animateBar(aBarRef.current, aPct);
			animateBar(bBarRef.current, bPct);
			animateCount(aPctRef.current, aPct);
			animateCount(bPctRef.current, bPct);
		},
		{ dependencies: [aPct, bPct] },
	);

	const triggerBoostBurst = () => {
		if (!burstRef.current) return;
		gsap.set(burstRef.current, { display: "flex", opacity: 1 });
		const tl = gsap.timeline({
			onComplete: () => {
				if (burstRef.current) gsap.set(burstRef.current, { display: "none" });
			},
		});
		tl.fromTo(
			".burst-glow",
			{ scale: 0.4, opacity: 0 },
			{ scale: 3, opacity: 0, duration: 1, ease: "power3.out", force3D: true },
		)
			.fromTo(
				".burst-text",
				{ y: 40, opacity: 0 },
				{
					y: -30,
					opacity: 1,
					duration: 0.5,
					ease: "back.out(2)",
					force3D: true,
				},
				"<",
			)
			.to(".burst-text", {
				opacity: 0,
				duration: 0.5,
				delay: 0.4,
				ease: "power2.in",
				force3D: true,
			});
	};

	const handleConfirm = async (action: VoteAction) => {
		if (!selected || voted) return;
		const cost = action === "boost" ? BOOST_COST : 0;
		if (action === "boost" && tokens < cost) {
			setTone("warning");
			setToast(t("live.toastNoTokens"));
			return;
		}

		const result = await castVote({
			track_id: selected,
			vote_type: action,
			tokens_spent: cost,
		});
		if (!result.ok) {
			setTone("warning");
			setToast(
				result.error === "insufficient_funds"
					? t("live.toastNoTokens")
					: result.error === "already_voted"
						? t("live.toastAlreadyVoted", "Ya votaste esta noche")
						: t("live.toastError", "No se pudo registrar el voto"),
			);
			return;
		}

		if (typeof result.balance === "number") {
			setBalance(result.balance);
		}
		setVoted(selected);
		if (action === "boost") {
			setTone("success");
			setToast(t("live.toastBoost"));
			triggerBoostBurst();
		} else {
			setTone("default");
			setToast(t("live.toastVote"));
		}
	};

	useEffect(() => {
		setVoted(null);
		setSelected(null);
	}, [activeEventId]);

	const empty = !loading && (!a || !b);

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col relative z-20 min-h-0 overflow-hidden"
		>
			<LiveHeader />

			<main className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 flex flex-col justify-center relative z-10 -mt-2 pb-2">
				<div className="live-fade flex flex-col items-center mb-6">
					<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/40 border border-red-500/30 backdrop-blur-sm transform-gpu translate-z-0 mb-4">
						<span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,1)] animate-pulse" />
						<span className="text-[10px] font-black tracking-[0.15em] text-red-400 uppercase">
							{t("live.liveBadge")}
						</span>
					</div>
					<h2 className="text-3xl font-black italic tracking-tighter text-transparent bg-clip-text bg-linear-to-r from-cyan-300 via-blue-500 to-cyan-400 drop-shadow-[0_0_20px_rgba(0,240,255,0.4)] leading-tight text-center">
						{t("live.battleTitle")}
					</h2>
					<p className="text-zinc-400 text-sm font-medium mt-1">
						{t("live.nextIn")}
					</p>
				</div>

				{!activeEventId && (
					<div className="text-center text-zinc-500 text-sm py-8 max-w-xs mx-auto">
						{t("live.noEventSub", "Inicia sesión para entrar en la batalla.")}
					</div>
				)}

				{activeEventId && loading && (
					<p className="text-center text-zinc-500 text-sm py-8">
						{t("live.loading", "Cargando duelo…")}
					</p>
				)}

				{activeEventId && empty && (
					<div className="text-center py-8 flex flex-col gap-3 items-center">
						<p className="text-zinc-400 text-sm max-w-xs">
							{t(
								"live.empty",
								"Aún no hay duelo activo — vuelve cuando el DJ haya cargado canciones.",
							)}
						</p>
						<button
							type="button"
							onClick={() => void reload()}
							className="h-10 px-4 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs font-black uppercase tracking-widest active:scale-95"
						>
							{t("menu.retry")}
						</button>
					</div>
				)}

				{activeEventId && !empty && a && b && (
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
							disabled={voted !== null}
						/>

						<div className="relative flex justify-center -my-3 z-10 pointer-events-none">
							<div className="w-8 h-8 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center shadow-lg">
								<span className="text-[10px] font-black italic text-zinc-500">
									{t("live.vs")}
								</span>
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
							disabled={voted !== null}
						/>
					</div>
				)}

				{activeEventId && error && (
					<p className="text-rose-300 text-center text-xs mt-4">
						{t("live.errLoad", "Error cargando el duelo")}
					</p>
				)}
			</main>

			<VoteFooter
				disabled={voted !== null}
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
	gsap.to(node, {
		scaleX: target / 100,
		duration: 0.9,
		ease: "power3.out",
		force3D: true,
	});
}

function animateCount(node: HTMLSpanElement | null, target: number) {
	if (!node) return;
	const obj = { val: parseInt(node.textContent ?? "0", 10) || 0 };
	gsap.to(obj, {
		val: target,
		duration: 0.9,
		snap: { val: 1 },
		ease: "power2.out",
		onUpdate: () => {
			node.textContent = `${Math.round(obj.val)}%`;
		},
	});
}
