import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Minus, Plus, Users } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";
import { cn } from "../../lib/utils";

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

type Props = {
	friends: string[];
	onChange: (i: number, value: string) => void;
	onAdd: () => void;
	onRemove: () => void;
	loserIndex: number | null;
	disabled: boolean;
};

export function PlayersPanel({
	friends,
	onChange,
	onAdd,
	onRemove,
	loserIndex,
	disabled,
}: Props) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(true);
	const bodyRef = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			const node = bodyRef.current;
			if (!node) return;
			if (open) node.style.height = "auto";
			gsap.to(node, {
				scaleY: open ? 1 : 0,
				opacity: open ? 1 : 0,
				duration: 0.32,
				ease: "power2.inOut",
				force3D: true,
				onComplete: () => {
					if (!open && bodyRef.current) bodyRef.current.style.height = "0px";
				},
			});
		},
		{ dependencies: [open] },
	);

	return (
		<section className="rul-fade shrink-0 px-6 pt-3 pb-2">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				aria-controls="players-body"
				className="w-full flex items-center justify-between gap-3 px-4 h-11 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-zinc-200 active:scale-[0.99] transition-transform focus-visible:ring-2 focus-visible:ring-lime-400"
			>
				<div className="flex items-center gap-2">
					<Users className="w-4 h-4 text-lime-400" aria-hidden="true" />
					<span className="text-sm font-bold">
						{t("ruleta.players", { n: friends.length })}
					</span>
				</div>
				<ChevronDown
					className={cn(
						"w-4 h-4 text-zinc-500 transition-transform duration-300",
						open ? "rotate-180" : "rotate-0",
					)}
					aria-hidden="true"
				/>
			</button>

			<div
				id="players-body"
				ref={bodyRef}
				className="overflow-hidden will-change-transform"
				style={{
					transformOrigin: "top center",
					height: open ? "auto" : 0,
				}}
			>
				<div className="pt-3">
					<div className="flex items-center justify-end gap-1 mb-2">
						<button
							type="button"
							onClick={onRemove}
							disabled={friends.length <= MIN_PLAYERS || disabled}
							aria-label={t("ruleta.removePlayer")}
							className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-cyan-400"
						>
							<Minus className="w-4 h-4" aria-hidden="true" />
						</button>
						<button
							type="button"
							onClick={onAdd}
							disabled={friends.length >= MAX_PLAYERS || disabled}
							aria-label={t("ruleta.addPlayer")}
							className="w-8 h-8 rounded-full bg-lime-500 text-black flex items-center justify-center active:scale-95 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-lime-300"
						>
							<Plus className="w-4 h-4" aria-hidden="true" />
						</button>
					</div>
					<div className="grid grid-cols-2 gap-2">
						{friends.map((name, i) => (
							<input
								key={i}
								type="text"
								value={name}
								onChange={(e) => onChange(i, e.target.value)}
								maxLength={16}
								placeholder={t("ruleta.friend", { n: i + 1 })}
								aria-label={t("ruleta.friendName", { n: i + 1 })}
								className={cn(
									"h-10 rounded-xl bg-zinc-900/80 border px-3 text-sm font-bold text-white placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400",
									loserIndex === i
										? "border-red-500 text-red-400"
										: "border-zinc-800",
								)}
								disabled={disabled}
							/>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
