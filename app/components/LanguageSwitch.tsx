import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

type Props = { className?: string; compact?: boolean };

const LANGS = ["es", "en"] as const;

export function LanguageSwitch({ className, compact = false }: Props) {
	const { i18n, t } = useTranslation();
	const current = i18n.resolvedLanguage ?? i18n.language ?? "es";

	const toggle = (next: string) => {
		if (next === current) return;
		void i18n.changeLanguage(next);
	};

	if (compact) {
		const next = current === "es" ? "en" : "es";
		return (
			<button
				type="button"
				onClick={() => toggle(next)}
				aria-label={t("lang.switch")}
				className={cn(
					"h-9 px-3 rounded-full bg-zinc-900/80 border border-zinc-800 text-zinc-300 inline-flex items-center gap-1.5 text-xs font-black tracking-widest active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400",
					className,
				)}
			>
				<Languages className="w-3.5 h-3.5" aria-hidden="true" />
				{t(`lang.${current}`)}
			</button>
		);
	}

	return (
		<div
			role="group"
			aria-label={t("lang.switch")}
			className={cn(
				"inline-flex items-center gap-1 p-1 rounded-full bg-zinc-900/80 border border-zinc-800",
				className,
			)}
		>
			{LANGS.map((lng) => {
				const active = lng === current;
				return (
					<button
						key={lng}
						type="button"
						onClick={() => toggle(lng)}
						aria-pressed={active}
						className={cn(
							"h-7 px-3 rounded-full text-[11px] font-black tracking-widest transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400",
							active
								? "bg-cyan-500 text-black shadow-[0_0_15px_rgba(0,240,255,0.4)]"
								: "text-zinc-400 hover:text-zinc-200",
						)}
					>
						{t(`lang.${lng}`)}
					</button>
				);
			})}
		</div>
	);
}
