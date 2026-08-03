/**
 * Tipos compartidos por las piezas del jumbotron (V20 · F4).
 * Extraídos de `Jumbotron.tsx`, que rondaba las 900 líneas.
 */
export type Track = {
	id: string;
	title: string;
	artist: string;
	cover_image_url: string | null;
	total_votes: number;
	is_played: boolean;
	// V17: sello temporal para ocultar del ranking 2h tras sonar (permite que
	// el filtro cliente respete la ventana igual que el poll/servidor).
	played_at?: string | null;
	// V18: instante del último voto → desempate por antigüedad en el ranking.
	last_vote_at?: string | null;
};
