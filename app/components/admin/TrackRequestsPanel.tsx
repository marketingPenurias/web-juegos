import { useCallback, useEffect, useState } from "react";
import { Check, Hand, Music2, X } from "lucide-react";
import { cn } from "../../lib/utils";

type Call = (
	op: string,
	payload?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type Request = {
	global_track_id: string;
	title: string;
	artist: string;
	genre: string | null;
	cover_image_url: string | null;
	people: number;
	first_asked: string;
};

const POLL_MS = 30_000;

/**
 * TrackRequestsPanel — lo que la sala le está pidiendo al DJ.
 *
 *   Agrupado POR CANCIÓN, no por petición.  Una bandeja con veinte líneas
 *   sueltas a las tres de la mañana no se lee; "siete personas han pedido
 *   ésta" se decide en un segundo.  Por eso el número de gente es lo más
 *   grande de cada fila y el orden lo marca él.
 *
 *   Sólo salen temas que el DJ YA tiene en su almacén, así que aceptar es un
 *   toque: la canción entra en la fiesta con su género y su carátula, y desde
 *   ese momento se puede votar en el Jukebox como cualquier otra.
 */
export function TrackRequestsPanel({
	call,
	eventId,
	onToast,
}: {
	call: Call;
	eventId: string;
	onToast: (msg: string) => void;
}) {
	const [requests, setRequests] = useState<Request[]>([]);
	const [busy, setBusy] = useState<string | null>(null);

	const load = useCallback(async () => {
		const res = await call("track_requests", { event_id: eventId });
		if (res.ok) setRequests((res.requests as Request[]) ?? []);
	}, [call, eventId]);

	// Van llegando toda la noche, así que se refresca solo.  Medio minuto: no
	// es una carrera y el panel del DJ ya tiene bastante movimiento.
	useEffect(() => {
		void load();
		const id = window.setInterval(() => void load(), POLL_MS);
		return () => window.clearInterval(id);
	}, [load]);

	const resolve = async (op: string, r: Request, msg: string) => {
		setBusy(r.global_track_id);
		const res = await call(op, {
			event_id: eventId,
			global_id: r.global_track_id,
		});
		setBusy(null);
		if (res.ok) {
			setRequests((cur) =>
				cur.filter((x) => x.global_track_id !== r.global_track_id),
			);
			onToast(msg);
		} else {
			onToast("No se pudo · inténtalo otra vez");
		}
	};

	return (
		<section className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<Hand className="w-5 h-5 text-amber-400" />
				<span className="font-black">Te están pidiendo</span>
				{requests.length > 0 && (
					<span className="ml-auto text-xs font-black tabular-nums text-amber-300 bg-amber-500/15 border border-amber-500/40 rounded-full px-3 py-1">
						{requests.length}
					</span>
				)}
			</div>

			{requests.length === 0 ? (
				<p className="text-[11px] text-zinc-500">
					Nadie ha pedido nada todavía. Cuando alguien busque en la app una
					canción que tienes guardada pero no cargaste esta noche, aparecerá
					aquí.
				</p>
			) : (
				<>
					<p className="text-[11px] text-zinc-500">
						Ordenadas por cuánta gente las pide. Todas están ya en tu almacén:
						aceptar la mete en la fiesta al instante.
					</p>
					<div className="flex flex-col gap-2">
						{requests.map((r) => (
							<div
								key={r.global_track_id}
								className="flex items-center gap-3 rounded-2xl bg-zinc-950/60 border border-zinc-800 p-3"
							>
								<div className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
									{r.cover_image_url ? (
										<img src={r.cover_image_url} alt="" className="w-full h-full object-cover" />
									) : (
										<Music2 className="w-5 h-5 text-zinc-600" aria-hidden="true" />
									)}
								</div>

								<div className="text-center shrink-0 w-12">
									<p className="text-2xl font-black tabular-nums leading-none text-amber-300">
										{r.people}
									</p>
									<p className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold">
										{r.people === 1 ? "persona" : "personas"}
									</p>
								</div>

								<div className="flex-1 min-w-0">
									<p className="font-black truncate">{r.title}</p>
									<p className="text-xs text-zinc-500 truncate">
										{r.artist}
										{r.genre ? ` · ${r.genre}` : ""}
									</p>
								</div>

								<button
									type="button"
									disabled={busy === r.global_track_id}
									onClick={() => void resolve("add_requested_track", r, `“${r.title}” añadida a la fiesta`)}
									className={cn(
										"h-10 px-4 rounded-xl bg-lime-500 text-black font-black text-sm inline-flex items-center gap-2 active:scale-95 shrink-0",
										busy === r.global_track_id && "opacity-40",
									)}
								>
									<Check className="w-4 h-4" />
									Ponerla
								</button>
								<button
									type="button"
									disabled={busy === r.global_track_id}
									onClick={() => void resolve("dismiss_request", r, "Descartada")}
									aria-label={`Descartar ${r.title}`}
									className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 inline-flex items-center justify-center active:scale-95 shrink-0 disabled:opacity-40"
								>
									<X className="w-4 h-4" />
								</button>
							</div>
						))}
					</div>
				</>
			)}
		</section>
	);
}
