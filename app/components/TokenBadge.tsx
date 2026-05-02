import { useEffect, useRef } from "react";
import { Coins } from "lucide-react";
import { useTranslation } from "react-i18next";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { cn } from "../lib/utils";

type Props = { className?: string };

export function TokenBadge({ className }: Props) {
	const tokens = useGameState((s) => s.tokens);
	const { t } = useTranslation();
	const numberRef = useRef<HTMLSpanElement>(null);
	const previousRef = useRef<number>(tokens);

	useGSAP(() => {
		const node = numberRef.current;
		if (!node) return;
		const from = previousRef.current;
		const obj = { val: from };
		gsap.to(obj, {
			val: tokens,
			duration: 0.7,
			ease: "power2.out",
			snap: { val: 1 },
			onUpdate: () => {
				node.textContent = String(Math.round(obj.val));
			},
		});
		previousRef.current = tokens;
	}, { dependencies: [tokens] });

	useEffect(() => {
		previousRef.current = tokens;
	}, []);

	return (
		<div
			className={cn(
				"flex items-center gap-2 bg-[#0a192f]/80 backdrop-blur-md transform-gpu translate-z-0 border border-cyan-500/40 rounded-full py-1.5 px-3.5 shadow-[0_0_15px_rgba(0,240,255,0.25)]",
				className,
			)}
			aria-label={t("hub.balance") + " " + tokens + " Tokens"}
		>
			<Coins className="text-cyan-400 w-4 h-4 drop-shadow-[0_0_5px_rgba(0,240,255,0.8)]" />
			<span className="font-extrabold text-sm text-cyan-50 tracking-wide tabular-nums">
				<span ref={numberRef}>{tokens}</span>{" "}
				<span className="text-cyan-300/80 font-bold">Tokens</span>
			</span>
		</div>
	);
}
