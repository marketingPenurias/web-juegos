import { Music2 } from "lucide-react";

/** Hueco del ranking: sin evento, o sin votos todavía (llamada a la acción). */
export function EmptyState({ reason }: { reason: "no_active_event" | "no_tracks" }) {
	return (
		<div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center gap-4">
			<Music2 className="w-16 h-16 text-zinc-700" aria-hidden="true" />
			<p className="text-2xl font-black italic tracking-tight text-zinc-400">
				{reason === "no_active_event"
					? "No hay evento activo esta noche"
					: /* V20: el ranking sólo lista temas VOTADOS, así que al empezar la
					     noche está vacío a propósito → convertimos el hueco en llamada
					     a la acción. */
						"Aún no hay votos · escanea el QR y elige la primera"}
			</p>
		</div>
	);
}
