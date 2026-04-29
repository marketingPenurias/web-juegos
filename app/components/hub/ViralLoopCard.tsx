import { Trans, useTranslation } from "react-i18next";
import { Copy, Gift, Share2 } from "lucide-react";

export function ViralLoopCard() {
	const { t } = useTranslation();

	return (
		<section
			aria-label={t("hub.packLeader")}
			className="hub-card bg-linear-to-t from-purple-900/40 to-zinc-900/60 rounded-[24px] p-1 border border-purple-500/30 overflow-hidden relative"
		>
			<div className="absolute -top-10 -right-10 w-40 h-40 bg-purple-500/20 blur-[40px] rounded-full pointer-events-none" />

			<div className="bg-zinc-950/80 backdrop-blur-sm rounded-[20px] p-5 h-full">
				<div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-950/60 border border-purple-500/40 mb-3">
					<Gift className="w-3.5 h-3.5 text-purple-400" aria-hidden="true" />
					<span className="text-[10px] font-black tracking-widest text-purple-300 uppercase">
						{t("hub.packLeader")}
					</span>
				</div>

				<h3 className="text-xl font-black italic tracking-tight text-white mb-2 leading-tight">
					{t("hub.viralTitle")} <br />
					<span className="text-transparent bg-clip-text bg-linear-to-r from-purple-400 to-pink-500 drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]">
						{t("hub.viralReward")}
					</span>
				</h3>

				<p className="text-zinc-400 text-sm mb-5">
					<Trans
						i18nKey="hub.viralProgress"
						components={{ strong: <strong className="text-white" /> }}
					/>
				</p>

				<div className="flex gap-2">
					<button
						type="button"
						className="flex-1 h-12 bg-white text-black rounded-xl font-black text-[15px] flex items-center justify-center gap-2 active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400"
					>
						<Share2 className="w-4 h-4" aria-hidden="true" />
						{t("hub.share")}
					</button>
					<button
						type="button"
						aria-label={t("hub.copy")}
						className="w-12 h-12 bg-zinc-900 border border-zinc-700 rounded-xl flex items-center justify-center text-zinc-300 active:scale-95 hover:bg-zinc-800 transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400"
					>
						<Copy className="w-5 h-5" aria-hidden="true" />
					</button>
				</div>
			</div>
		</section>
	);
}
