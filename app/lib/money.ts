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
