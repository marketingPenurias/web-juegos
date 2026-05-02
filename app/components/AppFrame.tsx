import { cn } from "../lib/utils";

type Props = { children: React.ReactNode; className?: string };

export function AppFrame({ children, className }: Props) {
	return (
		<div className="relative z-10 min-h-dvh w-full flex items-center justify-center sm:p-4 md:p-6 lg:p-8 overscroll-none">
			<div
				className={cn(
					"relative w-full h-[100dvh] bg-[#050505] overflow-hidden flex flex-col",
					"sm:h-[844px] sm:max-w-[390px] sm:rounded-[40px] sm:border-8 sm:border-zinc-900 sm:shadow-2xl",
					"md:max-w-[420px] md:h-[880px]",
					"lg:max-w-[460px] lg:h-[920px]",
					"xl:max-w-[500px] xl:h-[960px]",
					"2xl:max-w-[560px] 2xl:h-[1040px]",
					className,
				)}
			>
				<div className="absolute top-[-10%] left-[-20%] w-[250px] h-[250px] bg-cyan-600/20 rounded-full blur-[100px] pointer-events-none mix-blend-screen" />
				<div className="absolute bottom-[20%] right-[-10%] w-[300px] h-[300px] bg-lime-500/10 rounded-full blur-[120px] pointer-events-none mix-blend-screen" />
				<div className="absolute top-[40%] left-[50%] -translate-x-1/2 w-[350px] h-[350px] bg-blue-600/15 rounded-full blur-[140px] pointer-events-none mix-blend-screen" />

				<div className="flex-1 flex flex-col relative z-10 overflow-hidden">
					{children}
				</div>
			</div>
		</div>
	);
}
