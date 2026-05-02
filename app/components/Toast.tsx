import { useEffect, useRef, useState } from "react";
import { gsap, useGSAP } from "../lib/gsap";
import { cn } from "../lib/utils";

type Props = {
	message: string | null;
	onDone: () => void;
	tone?: "default" | "success" | "warning";
};

export function Toast({ message, onDone, tone = "default" }: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (message) setVisible(true);
	}, [message]);

	useGSAP(
		() => {
			if (!visible || !ref.current) return;
			const tl = gsap.timeline({
				onComplete: () => {
					setVisible(false);
					onDone();
				},
			});
			tl.fromTo(
				ref.current,
				{ y: 24, opacity: 0, scale: 0.95 },
				{ y: 0, opacity: 1, scale: 1, duration: 0.25, ease: "power3.out" },
			)
				.to(ref.current, { duration: 1.2 })
				.to(ref.current, {
					y: -8,
					opacity: 0,
					duration: 0.3,
					ease: "power2.in",
				});
			return () => {
				tl.kill();
			};
		},
		{ dependencies: [visible, message] },
	);

	if (!visible || !message) return null;

	return (
		<div
			role="status"
			ref={ref}
			className={cn(
				"fixed left-1/2 -translate-x-1/2 bottom-32 z-[100] px-5 py-3 rounded-2xl backdrop-blur-xl transform-gpu translate-z-0 border text-sm font-bold pointer-events-none",
				tone === "success" &&
					"bg-lime-500/15 border-lime-400/50 text-lime-200 shadow-[0_0_25px_rgba(57,255,20,0.45)]",
				tone === "warning" &&
					"bg-red-500/15 border-red-400/50 text-red-200 shadow-[0_0_25px_rgba(239,68,68,0.45)]",
				tone === "default" &&
					"bg-white/10 border-white/20 text-white shadow-[0_0_25px_rgba(0,212,255,0.35)]",
			)}
		>
			{message}
		</div>
	);
}
