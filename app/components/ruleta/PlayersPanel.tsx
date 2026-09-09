import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus, Users, X } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";
import { cn } from "../../lib/utils";

const MAX_PLAYERS = 8;

type Props = {
	friends: string[];
	/** Color del sector de esa persona en la rueda, o null si aún no tiene. */
	colorFor: (i: number) => string | null;
	onChange: (i: number, value: string) => void;
	onAdd: () => void;
	onRemoveAt: (i: number) => void;
	loserIndex: number | null;
	disabled: boolean;
	open: boolean;
	onToggle: () => void;
};

/**
 * PlayersPanel — el primer paso, y el que se saltaba todo el mundo.
 *
 *   Cada fila lleva el color del sector que esa persona ocupa en la rueda.
 *   No es adorno: es la única forma de saber de un vistazo cuál eres tú ahí
 *   arriba.  Una fila vacía no tiene color porque no está en la rueda.
 */
export function PlayersPanel({
	friends,
	colorFor,
	onChange,
	onAdd,
	onRemoveAt,
	loserIndex,
	disabled,
	open,
	onToggle,
}: Props) {
	const { t } = useTranslation();
	const bodyRef = useRef<HTMLDivElement>(null);
	const firstRef = useRef<HTMLInputElement>(null);

	// El cursor ya puesto en el primer hueco: en una barra, cada toque de
	// menos cuenta.
	useEffect(() => {
		if (open && friends[0] === "") firstRef.current?.focus();
		// Solo al montar: si no, robaría el foco cada vez que se escribe.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useGSAP(
		() => {
			const node = bodyRef.current;
			if (!node) return;
			gsap.to(node, {
				height: open ? "auto" : 0,
				opacity: open ? 1 : 0,
				duration: 0.32,
				ease: "power2.inOut",
			});
		},
		{ dependencies: [open] },
	);

	return (
		<section className="rul-fade shrink-0 px-6 pt-3">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				aria-controls="players-body"
				className="w-full flex items-center justify-between gap-3 px-4 h-11 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-zinc-200 active:scale-[0.99] transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400"
			>
				<div className="flex items-center gap-2">
					<Users className="w-4 h-4 text-cyan-300" aria-hidden="true" />
					<span className="text-sm font-bold">{t("ruleta.whoPlays")}</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs font-bold text-zinc-500 tabular-nums">
						{t("ruleta.players", { n: friends.filter((f) => f.trim()).length })}
					</span>
					<ChevronDown
						className={cn(
							"w-4 h-4 text-zinc-500 transition-transform duration-300",
							open ? "rotate-180" : "rotate-0",
						)}
						aria-hidden="true"
					/>
				</div>
			</button>

			<div
				id="players-body"
				ref={bodyRef}
				className="overflow-hidden"
				style={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
			>
				<div className="pt-3 flex flex-col gap-2">
					{friends.map((name, i) => {
						const color = colorFor(i);
						return (
							<div key={i} className="flex items-center gap-2">
								<span
									aria-hidden="true"
									className={cn(
										"w-2.5 h-2.5 rounded-full shrink-0 border",
										color ? "border-transparent" : "border-zinc-700",
									)}
									style={color ? { backgroundColor: color } : undefined}
								/>
								<input
									ref={i === 0 ? firstRef : undefined}
									type="text"
									value={name}
									onChange={(e) => onChange(i, e.target.value)}
									maxLength={12}
									autoComplete="off"
									placeholder={t("ruleta.namePlaceholder")}
									aria-label={t("ruleta.friendName", { n: i + 1 })}
									className={cn(
										"h-11 flex-1 min-w-0 rounded-xl bg-zinc-900/80 border px-3 text-sm font-bold text-white placeholder:text-zinc-600 placeholder:font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400",
										loserIndex === i
											? "border-red-500 text-red-400"
											: "border-zinc-800",
									)}
									disabled={disabled}
								/>
								<button
									type="button"
									onClick={() => onRemoveAt(i)}
									disabled={disabled || friends.length <= 2}
									aria-label={t("ruleta.removeThis", { n: i + 1 })}
									className="w-9 h-9 shrink-0 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 active:scale-95 disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-cyan-400"
								>
									<X className="w-4 h-4" aria-hidden="true" />
								</button>
							</div>
						);
					})}

					<button
						type="button"
						onClick={onAdd}
						disabled={friends.length >= MAX_PLAYERS || disabled}
						className="h-11 rounded-xl border border-dashed border-zinc-700 text-zinc-400 text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.99] transition-transform disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-cyan-400"
					>
						<Plus className="w-4 h-4" aria-hidden="true" />
						{t("ruleta.addPlayer")}
					</button>
				</div>
			</div>
		</section>
	);
}
