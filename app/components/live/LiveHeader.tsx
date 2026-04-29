import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
import { TokenBadge } from "../TokenBadge";

export function LiveHeader() {
	const { t } = useTranslation();
	return (
		<header className="px-6 pt-12 sm:pt-8 pb-4 relative z-20 flex flex-col gap-5">
			<div className="live-fade flex justify-between items-center">
				<h1 className="text-xl font-black tracking-[0.2em] text-white uppercase drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">
					{t("live.brand")}
				</h1>
				<TokenBadge />
			</div>

			<div className="live-fade flex flex-col gap-2">
				<div className="flex justify-between items-end text-xs font-bold uppercase tracking-wider">
					<span className="text-zinc-500">{t("live.level")}</span>
					<span className="text-lime-400 drop-shadow-[0_0_5px_rgba(57,255,20,0.4)] flex items-center gap-1">
						{t("live.ptsToFreeShot")}{" "}
						<Target className="w-3 h-3" aria-hidden="true" />
					</span>
				</div>

				<div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-800/80 shadow-inner relative">
					<div
						className="absolute top-0 left-0 h-full bg-linear-to-r from-lime-600 via-lime-400 to-lime-300 shadow-[0_0_12px_rgba(57,255,20,0.6)] rounded-full"
						style={{ width: "80%" }}
					/>
				</div>
			</div>
		</header>
	);
}
