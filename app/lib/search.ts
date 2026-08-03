/**
 * Búsqueda tolerante de canciones — compartida por el Jukebox y el panel del DJ.
 *
 *   Vivía dentro de `Jukebox.tsx`, pero es lógica PURA (sin React, sin DOM) que
 *   también quiere el buscador del admin.  Aquí es testeable y se corrige en un
 *   único sitio.
 */

/**
 * Normaliza para comparar: sin acentos/diacríticos, en minúsculas y sin
 * puntuación.  Así "regueton" encuentra "Reguetón" y "cafune" → "Cruz Cafuné".
 */
export function normalize(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // fuera tildes/diéresis
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ") // fuera puntuación (ñ ya normalizada a n)
		.replace(/\s+/g, " ")
		.trim();
}

/** Divide lo escrito en términos normalizados (vacío = sin filtro). */
export function searchTokens(query: string): string[] {
	return normalize(query).split(" ").filter(Boolean);
}

/**
 * Puntúa una canción contra los términos buscados.  `null` = no coincide.
 * Menor puntuación = mejor coincidencia, para poder ordenar por relevancia.
 *
 *   · No hace falta el nombre exacto ni el orden correcto:
 *     "quevedo graciosa" encuentra "LA GRACIOSA — Quevedo, Elvis Crespo".
 *   · Todos los términos deben aparecer (AND), en título o artista.
 *   · Prioriza que el TÍTULO empiece por lo escrito.
 */
export function matchScore(
	song: { title: string; artist: string },
	tokens: string[],
): number | null {
	const title = normalize(song.title);
	const artist = normalize(song.artist);
	const hay = `${title} ${artist}`;
	let score = 0;
	for (const tk of tokens) {
		if (!hay.includes(tk)) return null;
		if (title.startsWith(tk)) score += 0;
		else if (title.includes(tk)) score += 1;
		else if (artist.startsWith(tk)) score += 2;
		else score += 3;
	}
	return score;
}

/**
 * Filtra y ORDENA POR RELEVANCIA una lista de canciones.
 * Con la búsqueda vacía devuelve la lista tal cual (sin reordenar).
 */
export function searchTracks<T extends { title: string; artist: string }>(
	tracks: T[],
	query: string,
	limit?: number,
): T[] {
	const tokens = searchTokens(query);
	if (tokens.length === 0) return tracks;
	const scored = tracks
		.map((t) => ({ t, score: matchScore(t, tokens) }))
		.filter((r): r is { t: T; score: number } => r.score !== null)
		.sort((a, b) => a.score - b.score || a.t.title.localeCompare(b.t.title))
		.map((r) => r.t);
	return typeof limit === "number" ? scored.slice(0, limit) : scored;
}
