import { useCallback, useEffect, useState } from "react";
import { EyeOff, RefreshCw, Users } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * NameModerationPanel — quitar un nombre que no debería estar en la tele.
 *
 *   Cada persona elige el nombre con el que aparece en el ranking, y el ranking
 *   se proyecta en la sala.  La validación frena URLs y textos largos, pero no
 *   frena un insulto: sin esta palanca, un nombre ofensivo se queda ahí toda la
 *   noche.
 *
 *   Solo se listan los que SE VEN.  Moderar a quien no sale en pantalla sería
 *   pedirle al staff que revise una lista de cientos de personas buscando algo
 *   que no molesta a nadie.
 *
 *   Quitar el nombre no banea: la persona vuelve a salir como "Jefe #N" y puede
 *   elegir otro.  Para el reincidente está la puerta, que funciona mejor que
 *   cualquier lista de palabras prohibidas.
 */

type Person = {
	id: string;
	display_name: string | null;
	lifetime_earned: number;
};

type Call = (
	op: string,
	payload?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** Cuántos entran en el ranking que se proyecta. */
const ON_SCREEN = 10;

export function NameModerationPanel({
	call,
	onToast,
}: {
	call: Call;
	onToast: (msg: string) => void;
}) {
	const [people, setPeople] = useState<Person[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		const d = await call("visible_names");
		if (d.ok === true) setPeople((d.people as Person[]) ?? []);
		else onToast("⚠️ No se pudieron cargar los nombres");
		setLoading(false);
	}, [call, onToast]);

	useEffect(() => {
		void load();
	}, [load]);

	const clear = async (id: string) => {
		setBusy(id);
		const r = await call("clear_display_name", { profile_id: id });
		setBusy(null);
		setConfirming(null);
		if (r.ok === true) {
			onToast(`🚫 Nombre retirado: «${r.previous_name ?? "—"}»`);
			await load();
		} else {
			onToast("⚠️ No se pudo retirar");
		}
	};

	return (
		<section className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col gap-3">
			<header className="flex items-center gap-2">
				<Users className="w-4 h-4 text-cyan-400" aria-hidden="true" />
				<h2 className="font-black text-sm uppercase tracking-widest text-zinc-200">
					Nombres en pantalla
				</h2>
				<button
					type="button"
					onClick={() => void load()}
					aria-label="Recargar"
					className="ml-auto h-8 w-8 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 inline-flex items-center justify-center active:scale-95"
				>
					<RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
				</button>
			</header>
			<p className="text-[11px] text-zinc-500 -mt-1">
				Si alguien se pone algo que no quieres proyectar, quítale el nombre:
				vuelve a salir como «Jefe» y podrá elegir otro.
			</p>

			{loading && people.length === 0 && (
				<p className="text-[11px] text-zinc-500">Cargando…</p>
			)}
			{!loading && people.length === 0 && (
				<p className="text-[11px] text-zinc-500">
					Todavía nadie ha elegido nombre.
				</p>
			)}

			<div className="flex flex-col">
				{people.map((p, i) => (
					<div
						key={p.id}
						className={cn(
							"flex items-center gap-3 py-2 border-t border-zinc-800/70 first:border-t-0",
							// Fuera del corte del ranking: no se proyecta, así que se
							// atenúa para que el staff mire primero lo que sí se ve.
							i >= ON_SCREEN && "opacity-50",
						)}
					>
						<span className="w-6 text-[11px] tabular-nums text-zinc-600 font-black">
							{i + 1}
						</span>
						<span className="flex-1 min-w-0 text-sm font-bold text-zinc-200 truncate">
							{p.display_name}
						</span>
						<span className="text-[11px] tabular-nums text-zinc-500">
							{p.lifetime_earned}
						</span>
						{confirming === p.id ? (
							<div className="flex gap-1 shrink-0">
								<button
									type="button"
									onClick={() => void clear(p.id)}
									disabled={busy === p.id}
									className="h-8 px-2.5 rounded-lg bg-rose-500 text-black text-[10px] font-black uppercase active:scale-95 disabled:opacity-50"
								>
									{busy === p.id ? "…" : "Confirmar"}
								</button>
								<button
									type="button"
									onClick={() => setConfirming(null)}
									className="h-8 px-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] font-black uppercase active:scale-95"
								>
									No
								</button>
							</div>
						) : (
							<button
								type="button"
								onClick={() => setConfirming(p.id)}
								aria-label={`Retirar el nombre de ${p.display_name}`}
								className="h-8 w-8 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 inline-flex items-center justify-center active:scale-95 shrink-0"
							>
								<EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
							</button>
						)}
					</div>
				))}
			</div>
		</section>
	);
}
