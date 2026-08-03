/**
 * Fechas del panel del DJ, SIEMPRE en la hora del local (Europe/Madrid).
 *
 *   El staff piensa en "la fiesta empieza a las 23:00", no en UTC ni en la zona
 *   del portátil que tengan abierto.  Estos helpers convierten entre el ISO que
 *   guarda la BD y el valor de un <input type="datetime-local">, respetando el
 *   cambio de hora (DST).
 *
 *   Extraído de `routes/admin.tsx` (V20 · F4): es lógica pura y testeable, y el
 *   fichero del panel era un god-file de 1.600 líneas.
 */

// ── Timezone: SIEMPRE Europe/Madrid (no el reloj del dispositivo del DJ) ──
export const VENUE_TZ = "Europe/Madrid";

/** Offset (ms) que Madrid lleva sobre UTC en el instante `utcMs` (maneja DST). */
function madridOffsetMs(utcMs: number): number {
	const dtf = new Intl.DateTimeFormat("en-US", {
		timeZone: VENUE_TZ, year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
	});
	const p: Record<string, string> = {};
	for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
	const asUtcFromMadridWall = Date.UTC(
		Number(p.year), Number(p.month) - 1, Number(p.day),
		Number(p.hour === "24" ? "0" : p.hour), Number(p.minute), Number(p.second),
	);
	return asUtcFromMadridWall - utcMs;
}

/** ISO (UTC) almacenado → valor `datetime-local` mostrado en hora de Madrid. */
export function toLocalInput(iso?: string | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	// sv-SE da formato ISO "YYYY-MM-DD HH:mm" ya en la TZ pedida.
	const s = new Intl.DateTimeFormat("sv-SE", {
		timeZone: VENUE_TZ, year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", hour12: false,
	}).format(d);
	return s.replace(" ", "T");
}

/** Valor `datetime-local` (hora-pared de Madrid) → ISO UTC correcto. */
export function fromLocalInput(local: string): string | undefined {
	if (!local) return undefined;
	const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
	if (!m) return undefined;
	const [, y, mo, d, h, mi] = m.map(Number);
	// Interpretamos la hora-pared como UTC y restamos el offset de Madrid
	// para obtener el instante real (DST incluido).
	const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
	const offset = madridOffsetMs(wallAsUtc);
	return new Date(wallAsUtc - offset).toISOString();
}
