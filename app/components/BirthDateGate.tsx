import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cake, Loader2, ShieldCheck } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { getAccessToken } from "../lib/supabase.client";
import { useGameState } from "../store/useGameState";
import { useTenant } from "../lib/tenant";

/**
 * BirthDateGate — captura obligatoria de fecha de nacimiento (V1.7).
 *
 *   Se monta a nivel app y se muestra como overlay bloqueante cuando el
 *   usuario YA tiene sesión real (`userProfileId`) pero todavía no tiene
 *   `birthDate`.  No le dejamos jugar hasta completarla (+18, control de
 *   edad y futuras promos de cumpleaños).  Persiste vía `POST /api/session`
 *   y refleja el valor en el store al instante (sin recargar).
 */

const MIN_AGE = 18;

export function BirthDateGate() {
	const { t } = useTranslation();
	const tenant = useTenant();
	const userProfileId = useGameState((s) => s.userProfileId);
	const birthDate = useGameState((s) => s.birthDate);
	const sessionLoaded = useGameState((s) => s.sessionLoaded);
	const setBirthDate = useGameState((s) => s.setBirthDate);

	const [value, setValue] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const cardRef = useRef<HTMLDivElement>(null);

	// Límites del input: como muy reciente hoy; como muy antiguo 1920.
	const { maxDate, minDate } = useMemo(() => {
		const now = new Date();
		const yyyy = now.getUTCFullYear();
		const pad = (n: number) => String(n).padStart(2, "0");
		const max = `${yyyy}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
		return { maxDate: max, minDate: "1920-01-01" };
	}, []);

	// Sólo tras resolver /api/session: así el gate NO parpadea en cada recarga
	// mientras `birthDate` (no persistido) aún viaja desde el server.
	const show = sessionLoaded && userProfileId !== null && !birthDate;

	useGSAP(
		() => {
			if (!show || !cardRef.current) return;
			gsap.fromTo(
				cardRef.current,
				{ opacity: 0, y: 24, scale: 0.96 },
				{ opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(1.4)" },
			);
		},
		{ dependencies: [show] },
	);

	if (!show) return null;

	// Edad EXACTA por fecha de corte: la fecha de nacimiento más reciente que
	// ya cumple 18 hoy.  Nacer después de ese corte = menor (cubre el caso de
	// que aún no haya llegado su cumpleaños este año).
	const isAdult = (iso: string): boolean => {
		const d = new Date(`${iso}T00:00:00Z`);
		if (Number.isNaN(d.getTime())) return false;
		const today = new Date();
		const cutoff = new Date(
			Date.UTC(today.getUTCFullYear() - MIN_AGE, today.getUTCMonth(), today.getUTCDate()),
		);
		return d.getTime() <= cutoff.getTime();
	};

	const submit = async () => {
		if (saving) return;
		setError(null);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			setError(t("birthGate.errInvalid", "Introduce una fecha válida."));
			return;
		}
		if (!isAdult(value)) {
			setError(t("birthGate.errUnder18", "Debes ser mayor de 18 años para entrar."));
			return;
		}
		setSaving(true);
		try {
			const token = await getAccessToken();
			if (!token) {
				setError(t("birthGate.errSave", "No se pudo guardar. Inténtalo de nuevo."));
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
				body: JSON.stringify({ tenant_slug: tenant.slug, birth_date: value }),
			});
			const data = (await res.json().catch(() => ({ ok: false }))) as {
				ok?: boolean;
				birth_date?: string;
				error?: string;
			};
			if (!res.ok || data.ok !== true) {
				// El backend re-valida la edad: reflejamos su veredicto.
				if (data.error === "under_18") {
					setError(t("birthGate.errUnder18", "Debes ser mayor de 18 años para entrar."));
				} else if (data.error === "invalid_birth_date") {
					setError(t("birthGate.errInvalid", "Introduce una fecha válida."));
				} else {
					setError(t("birthGate.errSave", "No se pudo guardar. Inténtalo de nuevo."));
				}
				return;
			}
			// Refleja al instante → el gate se desmonta sin recargar.
			setBirthDate(data.birth_date ?? value);
		} catch {
			setError(t("birthGate.errSave", "No se pudo guardar. Inténtalo de nuevo."));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-md flex items-center justify-center px-6">
			<div
				ref={cardRef}
				className="w-full max-w-[360px] rounded-4xl bg-linear-to-br from-zinc-900 to-zinc-950 border border-cyan-400/40 p-7 text-center shadow-[0_0_60px_rgba(0,212,255,0.25)]"
			>
				<div className="w-16 h-16 rounded-full bg-cyan-500/15 border border-cyan-400/50 mx-auto flex items-center justify-center mb-4">
					<Cake className="w-8 h-8 text-cyan-300" aria-hidden="true" />
				</div>
				<h2 className="text-2xl font-black italic tracking-tight text-white mb-1">
					{t("birthGate.title", "¿Cuándo es tu cumple?")}
				</h2>
				<p className="text-sm text-zinc-400 mb-5">
					{t(
						"birthGate.subtitle",
						"Lo necesitamos para verificar que eres +18 y prepararte sorpresas de cumpleaños 🎁",
					)}
				</p>

				<label className="block text-left text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
					{t("birthGate.label", "Fecha de nacimiento")}
				</label>
				<input
					type="date"
					value={value}
					max={maxDate}
					min={minDate}
					onChange={(e) => setValue(e.target.value)}
					className="w-full h-12 rounded-2xl bg-zinc-950 border border-zinc-700 px-3 text-white font-bold mb-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
				/>

				{error && (
					<p className="text-rose-300 text-sm font-bold mb-2" role="alert">
						{error}
					</p>
				)}

				<button
					type="button"
					onClick={() => void submit()}
					disabled={saving || !value}
					className="w-full h-12 rounded-2xl bg-linear-to-r from-cyan-500 to-blue-500 text-black font-black tracking-tight active:scale-95 transition-transform disabled:opacity-50 inline-flex items-center justify-center gap-2 mt-2"
				>
					{saving ? (
						<><Loader2 className="w-4 h-4 animate-spin" /> {t("birthGate.saving", "Guardando…")}</>
					) : (
						t("birthGate.cta", "Entrar a jugar")
					)}
				</button>

				<p className="text-[10px] text-zinc-600 mt-3 flex items-center justify-center gap-1">
					<ShieldCheck className="w-3 h-3" aria-hidden="true" />
					{t("birthGate.privacy", "Solo para verificación de edad y promos. +18.")}
				</p>
			</div>
		</div>
	);
}
