import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { Toast } from "../components/Toast";
import { LiveHeader } from "../components/live/LiveHeader";
import { SongRow } from "../components/live/SongRow";
import { BoostBurst } from "../components/live/BoostBurst";
import { VoteFooter, type VoteAction } from "../components/live/VoteFooter";

const BOOST_COST = 30;

type Choice = "estopa" | "ecdl";

export function LiveBattle() {
	const { t } = useTranslation();
	const songVotes = useGameState((s) => s.songVotes);
	const voteSongEstopa = useGameState((s) => s.voteSongEstopa);
	const driftSongVotes = useGameState((s) => s.driftSongVotes);
	const spendTokens = useGameState((s) => s.spendTokens);
	const tokens = useGameState((s) => s.tokens);

	const [voted, setVoted] = useState<Choice | null>(null);
	const [selected, setSelected] = useState<Choice | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const [tone, setTone] = useState<"default" | "success" | "warning">("default");

	const containerRef = useRef<HTMLDivElement>(null);
	const estopaBarRef = useRef<HTMLDivElement>(null);
	const ecdlBarRef = useRef<HTMLDivElement>(null);
	const estopaPctRef = useRef<HTMLSpanElement>(null);
	const ecdlPctRef = useRef<HTMLSpanElement>(null);
	const burstRef = useRef<HTMLDivElement>(null);

	const elCantoVotes = 100 - songVotes.estopa;

	useEffect(() => {
		if (voted) return;
		const id = window.setInterval(() => driftSongVotes(), 3500);
		return () => window.clearInterval(id);
	}, [voted, driftSongVotes]);

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
			animateBar(estopaBarRef.current, songVotes.estopa);
			animateBar(ecdlBarRef.current, elCantoVotes);
			animateCount(estopaPctRef.current, songVotes.estopa);
			animateCount(ecdlPctRef.current, elCantoVotes);
		},
		{ dependencies: [songVotes.estopa] },
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

	const handleConfirm = (action: VoteAction) => {
		if (!selected || voted) return;

		const sign = selected === "estopa" ? 1 : -1;
		const magnitude = action === "boost" ? 5 : 1;

		if (action === "boost") {
			const ok = spendTokens(BOOST_COST, "history.tx_boost_song");
			if (!ok) {
				setTone("warning");
				setToast(t("live.toastNoTokens"));
				return;
			}
			setTone("success");
			setToast(t("live.toastBoost"));
			triggerBoostBurst();
		} else {
			setTone("default");
			setToast(t("live.toastVote"));
		}

		voteSongEstopa(sign * magnitude);
		setVoted(selected);
	};

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

				<div className="space-y-6">
					<SongRow
						name="Estopa"
						color="cyan"
						percent={songVotes.estopa}
						barRef={estopaBarRef}
						pctRef={estopaPctRef}
						selected={selected === "estopa"}
						confirmed={voted === "estopa"}
						onSelect={() => setSelected("estopa")}
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
						name="El Canto del Loco"
						color="lime"
						percent={elCantoVotes}
						barRef={ecdlBarRef}
						pctRef={ecdlPctRef}
						selected={selected === "ecdl"}
						confirmed={voted === "ecdl"}
						onSelect={() => setSelected("ecdl")}
						disabled={voted !== null}
					/>
				</div>
			</main>

			<VoteFooter
				disabled={voted !== null}
				hasSelection={selected !== null}
				tokens={tokens}
				boostCost={BOOST_COST}
				onConfirm={handleConfirm}
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
