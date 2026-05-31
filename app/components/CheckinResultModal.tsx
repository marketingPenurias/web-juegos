import { useRef } from "react";
import { CheckCircle2, Coins, Flame, XCircle } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";

/**
 * CheckinResultModal — celebración del check-in procesado en la app.
 *
 *   Se alimenta de `store.checkinResult`, que rellena `usePendingCheckin`
 *   (flujo frío: QR escaneado sin sesión y procesado tras el login) o
 *   cualquier check-in in-app futuro.  Muestra recompensa + racha + hito.
 */

export function CheckinResultModal() {
	const result = useGameState((s) => s.checkinResult);
	const setCheckinResult = useGameState((s) => s.setCheckinResult);
	const cardRef = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			if (!result) return;
			gsap.fromTo(
				cardRef.current,
				{ scale: 0.7, opacity: 0, y: 24 },
				{ scale: 1, opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.7)", force3D: true },
			);
		},
		{ dependencies: [result] },
	);

	if (!result) return null;
	const close = () => setCheckinResult(null);

	return (
		<div
			role="dialog"
			aria-modal="true"
			className="fixed inset-0 z-100 bg-black/85 backdrop-blur-md transform-gpu translate-z-0 flex items-center justify-center px-8"
		>
			<div
				ref={cardRef}
				className="w-full max-w-[340px] rounded-4xl bg-linear-to-br from-zinc-900 to-zinc-950 border border-lime-400/50 p-7 text-center shadow-[0_0_60px_rgba(57,255,20,0.35)]"
			>
				{result.ok ? (
					<>
						<div className="w-20 h-20 rounded-full bg-lime-500/15 border border-lime-400/50 mx-auto flex items-center justify-center mb-4">
							<CheckCircle2 className="w-10 h-10 text-lime-300" aria-hidden="true" />
						</div>
						<p className="text-[10px] uppercase tracking-[0.3em] text-lime-400 font-bold mb-1">
							{result.qrLabel ?? "Check-in"}
						</p>
						<h2 className="text-2xl font-black italic text-white mb-3">
							¡Check-in confirmado!
						</h2>

						{result.reward && result.reward > 0 ? (
							<div className="flex items-center justify-center gap-2 my-3">
								<Coins className="w-7 h-7 text-amber-300" aria-hidden="true" />
								<span className="text-4xl font-black text-amber-300 tabular-nums">
									+{result.reward}
								</span>
							</div>
						) : (
							<p className="text-sm text-zinc-400 my-3">
								Ya cobraste tu premio de check-in esta noche, pero tu visita cuenta para la racha.
							</p>
						)}

						<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/15 border border-orange-400/40 mb-2">
							<Flame className="w-4 h-4 text-orange-300" aria-hidden="true" />
							<span className="text-xs font-black text-orange-200">
								Racha: {result.streak ?? 0}{" "}
								{(result.streak ?? 0) === 1 ? "semana" : "semanas"}
							</span>
						</div>

						{result.milestoneWeek && result.milestoneWeek > 0 ? (
							<div className="mt-3 rounded-2xl bg-amber-500/10 border border-amber-400/50 p-3">
								<p className="text-[10px] uppercase tracking-widest text-amber-300 font-black">
									🏆 ¡Hito de fidelidad!
								</p>
								<p className="text-sm text-white font-bold mt-1">
									{result.milestoneWeek} semanas seguidas · +{result.milestoneAmount} tokens extra
								</p>
							</div>
						) : null}
					</>
				) : (
					<>
						<div className="w-16 h-16 rounded-full bg-zinc-800 border border-zinc-700 mx-auto flex items-center justify-center mb-4">
							<XCircle className="w-9 h-9 text-rose-400" aria-hidden="true" />
						</div>
						<h2 className="text-xl font-black italic text-white mb-2">
							{result.error === "already_checked_in"
								? "Ya hiciste este check-in"
								: "No se pudo registrar"}
						</h2>
						<p className="text-zinc-400 text-sm">
							{result.error === "already_checked_in"
								? `${result.qrLabel ?? "Este QR"} ya está registrado en tu noche. ¡Vuelve mañana!`
								: result.error === "invalid_qr"
									? "Este QR no es válido o ya no está activo."
									: "Inténtalo de nuevo en unos segundos."}
						</p>
					</>
				)}

				<button
					type="button"
					onClick={close}
					className="mt-6 w-full h-12 rounded-2xl bg-linear-to-r from-lime-400 to-emerald-500 text-black font-black tracking-tight active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-lime-400"
				>
					¡Seguir!
				</button>
			</div>
		</div>
	);
}
