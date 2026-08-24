import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Pencil, X } from "lucide-react";
import { getAccessToken } from "../lib/supabase.client";
import { useTenant } from "../lib/tenant";
import { useGameState } from "../store/useGameState";
import { cn } from "../lib/utils";

/**
 * DisplayNameEditor — el nombre con el que se te ve en el ranking y en la TV.
 *
 *   Hasta ahora ese nombre no lo elegía nadie: el alta lo dejaba vacío y el
 *   ranking pintaba "Jefe #7".  Aquí la persona decide cómo aparece.
 *
 *   Las reglas (longitud, caracteres, y que no esté cogido en esta sala) las
 *   impone `set_display_name` en la base de datos.  Aquí solo se recorta a la
 *   longitud máxima para que el campo no acepte más de lo que el servidor va a
 *   admitir; el veredicto siempre es del servidor.
 */

const MAX = 20;

export function DisplayNameEditor() {
	const { t } = useTranslation();
	const tenant = useTenant();
	const displayName = useGameState((s) => s.displayName);
	const setDisplayName = useGameState((s) => s.setDisplayName);

	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(displayName ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const open = () => {
		setValue(displayName ?? "");
		setError(null);
		setEditing(true);
	};

	const save = async () => {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			const token = await getAccessToken();
			if (!token) {
				setError(t("name.errSave", "No se pudo guardar. Inténtalo de nuevo."));
				return;
			}
			const res = await fetch("/api/session", {
				method: "POST",
				cache: "no-store",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
					"X-Tenant-Slug": tenant.slug,
				},
				body: JSON.stringify({
					tenant_slug: tenant.slug,
					display_name: value,
				}),
			});
			const data = (await res.json().catch(() => ({ ok: false }))) as {
				ok?: boolean;
				display_name?: string;
				error?: string;
				detail?: string;
			};
			if (!res.ok || data.ok !== true) {
				if (data.error === "display_name_taken") {
					setError(t("name.errTaken", "Ese nombre ya está cogido. Prueba otro."));
				} else if (data.error === "invalid_display_name") {
					// El detalle viene de la BD y ya explica QUÉ falla (longitud,
					// caracteres…), así que se muestra tal cual en vez de un
					// genérico que obligue a adivinar.
					setError(data.detail ?? t("name.errInvalid", "Ese nombre no vale."));
				} else {
					setError(t("name.errSave", "No se pudo guardar. Inténtalo de nuevo."));
				}
				return;
			}
			setDisplayName(data.display_name ?? value.trim());
			setEditing(false);
		} catch {
			setError(t("name.errSave", "No se pudo guardar. Inténtalo de nuevo."));
		} finally {
			setSaving(false);
		}
	};

	if (!editing) {
		return (
			<div className="flex items-center gap-2">
				<div className="flex-1 min-w-0">
					<p className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-black">
						{t("name.label", "Tu nombre en el ranking")}
					</p>
					<p
						className={cn(
							"text-sm font-black truncate mt-0.5",
							displayName ? "text-white" : "text-amber-300",
						)}
					>
						{displayName ?? t("name.unset", "Sin elegir · sales como «Jefe»")}
					</p>
				</div>
				<button
					type="button"
					onClick={open}
					className="h-9 px-3 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] font-black uppercase tracking-widest active:scale-95 inline-flex items-center gap-1.5 shrink-0"
				>
					<Pencil className="w-3 h-3" aria-hidden="true" />
					{displayName ? t("name.change", "Cambiar") : t("name.choose", "Elegir")}
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<label
				htmlFor="display-name"
				className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-black"
			>
				{t("name.label", "Tu nombre en el ranking")}
			</label>
			<div className="flex items-center gap-2">
				<input
					id="display-name"
					value={value}
					onChange={(e) => setValue(e.target.value.slice(0, MAX))}
					maxLength={MAX}
					autoFocus
					disabled={saving}
					placeholder={t("name.placeholder", "Cómo quieres que te vean")}
					className="flex-1 min-w-0 h-11 rounded-xl bg-zinc-950 border border-zinc-700 px-3 text-sm text-white"
				/>
				<button
					type="button"
					onClick={() => void save()}
					disabled={saving}
					aria-label={t("common.save", "Guardar")}
					className="h-11 w-11 rounded-xl bg-cyan-500 text-black inline-flex items-center justify-center active:scale-95 disabled:opacity-50 shrink-0"
				>
					<Check className="w-4 h-4" aria-hidden="true" />
				</button>
				<button
					type="button"
					onClick={() => setEditing(false)}
					disabled={saving}
					aria-label={t("common.cancel", "Cancelar")}
					className="h-11 w-11 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 inline-flex items-center justify-center active:scale-95 shrink-0"
				>
					<X className="w-4 h-4" aria-hidden="true" />
				</button>
			</div>
			{error ? (
				<p className="text-[11px] text-rose-300">{error}</p>
			) : (
				<p className="text-[11px] text-zinc-500">
					{t("name.hint", "Entre 3 y {{max}} caracteres. Se ve en la tele del local.", {
						max: MAX,
					})}
				</p>
			)}
		</div>
	);
}
