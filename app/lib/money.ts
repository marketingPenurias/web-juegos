/**
 * Euros, escritos como se escriben en España.
 *
 *   `Math.round` convertía un flash drop de 2,50 € en "3€" en la pantalla del
 *   local, mientras el aviso que le llegaba al móvil decía "2,50€" — la misma
 *   promoción con dos precios distintos según dónde la mirases.  Ese aviso ya
 *   se arregló en la base de datos (migración 44); esto es la otra mitad.
 *
 *   Los precios de carta sí son enteros a propósito (regla del local: un
 *   3,50 € en barra no existe), así que la mayoría de las veces esto devuelve
 *   lo mismo que antes.  La diferencia aparece justo donde importa.
 */
export function formatEur(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(Number(value))) {
		return "—";
	}
	const n = Number(value);
	return n === Math.trunc(n)
		? `${n}€`
		: `${n.toFixed(2).replace(".", ",")}€`;
}

/**
 * Redondea —o no— un precio según lo que use la sala.
 *
 *   La Pocha trabaja con euros enteros: "un 3,50 € en barra no existe".  Eso
 *   estaba metido a pelo en el guardado, así que su regla se la comían todas
 *   las demás salas, y una discoteca que cobre 4,50 € por un chupito no podía
 *   ponerlo: el panel le aceptaba el número y guardaba otro.
 *
 *   Ahora es un ajuste del local (`tenants.features.pricing.whole_euros`).
 *   Por defecto NO se redondea: descartar en silencio lo que alguien acaba de
 *   teclear es peor que enseñar un decimal de más.
 */
export function normalizePriceEur(value: number, wholeEuros: boolean): number {
	return wholeEuros ? Math.round(value) : Math.round(value * 100) / 100;
}

/** Lee el ajuste del `features` jsonb de la sala. */
export function usesWholeEuros(features: unknown): boolean {
	const pricing = (features as { pricing?: { whole_euros?: unknown } } | null)
		?.pricing;
	return pricing?.whole_euros === true;
}
