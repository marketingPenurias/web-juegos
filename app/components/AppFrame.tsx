import { useEffect } from "react";
import { cn } from "../lib/utils";
import { flushOfflineQueue, installAnalyticsListeners } from "../lib/analytics";
import { resolveTheme, useTenant } from "../lib/tenant";

type Props = { children: React.ReactNode; className?: string };

export function AppFrame({ children, className }: Props) {
	const tenant = useTenant();
	const theme = resolveTheme(tenant.theme);

	useEffect(() => {
		// Drain any events that were queued while offline on the previous session.
		void flushOfflineQueue();
		// Wire network-recovery + visibility listeners; cleanup on unmount.
		return installAnalyticsListeners();
	}, []);

	const styleVars: React.CSSProperties = {
		"--tenant-primary": theme.primary,
		"--tenant-secondary": theme.secondary,
		"--tenant-accent": theme.accent,
		"--tenant-background": theme.background,
	} as React.CSSProperties;

	return (
		<div
			style={styleVars}
			className="relative z-10 min-h-dvh w-full flex items-center justify-center sm:p-4 md:p-6 lg:p-8 overscroll-none"
		>
			<div
				className={cn(
					"relative w-full h-dvh overflow-hidden flex flex-col bg-(--tenant-background)",
					"sm:h-[844px] sm:max-w-[390px] sm:rounded-[40px] sm:border-8 sm:border-zinc-900 sm:shadow-2xl",
					"md:max-w-[420px] md:h-[880px]",
					"lg:max-w-[460px] lg:h-[920px]",
					"xl:max-w-[500px] xl:h-[960px]",
					"2xl:max-w-[560px] 2xl:h-[1040px]",
					className,
				)}
			>
				<div className="absolute top-[-10%] left-[-20%] w-[250px] h-[250px] bg-(--tenant-primary)/20 rounded-full blur-[100px] pointer-events-none mix-blend-screen" />
				<div className="absolute bottom-[20%] right-[-10%] w-[300px] h-[300px] bg-(--tenant-secondary)/10 rounded-full blur-[120px] pointer-events-none mix-blend-screen" />
				<div className="absolute top-[40%] left-[50%] -translate-x-1/2 w-[350px] h-[350px] bg-(--tenant-accent)/15 rounded-full blur-[140px] pointer-events-none mix-blend-screen" />

				<div className="flex-1 flex flex-col relative z-10 overflow-hidden">
					{children}
				</div>
			</div>
		</div>
	);
}
