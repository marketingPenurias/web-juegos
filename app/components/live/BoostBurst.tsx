import { forwardRef } from "react";
import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

export const BoostBurst = forwardRef<HTMLDivElement>((_props, ref) => {
	const { t } = useTranslation();
	return (
		<div
			ref={ref}
			className="absolute inset-0 z-50 pointer-events-none items-center justify-center hidden"
		>
			<div className="absolute inset-0 bg-amber-500/20 mix-blend-screen" />
			<div className="burst-glow w-40 h-40 bg-amber-400/40 rounded-full blur-[40px]" />
			<div className="burst-text absolute flex items-center gap-2">
				<Zap
					className="w-12 h-12 text-amber-300 fill-amber-400 drop-shadow-[0_0_20px_rgba(251,191,36,0.8)]"
					aria-hidden="true"
				/>
				<span className="text-4xl font-black text-white italic tracking-tighter drop-shadow-[0_0_20px_rgba(251,191,36,0.8)]">
					{t("live.boosted")}
				</span>
			</div>
		</div>
	);
});

BoostBurst.displayName = "BoostBurst";
