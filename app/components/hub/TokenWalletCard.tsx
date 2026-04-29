import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Coins } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";
import { useGameState } from "../../store/useGameState";

type Props = { onOpenHistory: () => void };

export function TokenWalletCard({ onOpenHistory }: Props) {
	const { t } = useTranslation();
	const tokens = useGameState((s) => s.tokens);
	const numberRef = useRef<HTMLSpanElement>(null);
	const previousRef = useRef<number>(tokens);

	useGSAP(
		() => {
			const node = numberRef.current;
			if (!node) return;
			const obj = { val: previousRef.current };
			gsap.to(obj, {
				val: tokens,
				duration: 0.9,
				ease: "power2.out",
				snap: { val: 1 },
				onUpdate: () => {
					node.textContent = String(Math.round(obj.val));
				},
			});
			previousRef.current = tokens;
		},
		{ dependencies: [tokens] },
	);

	return (
		<section
			aria-label={t("hub.balance")}
			className="hub-card relative bg-linear-to-br from-[#0a192f] to-[#040b16] rounded-[24px] p-6 border border-cyan-500/30 shadow-[0_10px_40px_rgba(0,240,255,0.15)] overflow-hidden"
		>
			<div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/20 blur-[50px] rounded-full mix-blend-screen pointer-events-none" />
			<div className="flex justify-between items-start relative z-10">
				<div>
					<p className="text-cyan-200/60 font-medium text-sm mb-1 uppercase tracking-widest">
						{t("hub.balance")}
					</p>
					<div className="flex items-end gap-2">
						<Coins className="text-cyan-400 w-8 h-8 mb-1" aria-hidden="true" />
						<span className="text-5xl font-black text-white tracking-tighter drop-shadow-[0_0_15px_rgba(0,240,255,0.4)] tabular-nums">
							<span ref={numberRef}>{tokens}</span>
						</span>
					</div>
				</div>
				<button
					type="button"
					onClick={onOpenHistory}
					className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 px-3 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					{t("hub.history")}
				</button>
			</div>
		</section>
	);
}
