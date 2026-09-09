/**
 * La configuración de la pantalla del local, en UN solo sitio.
 *
 *   El DJ la escribe desde /admin en `tenant_events.metadata.tv_backdrop`, y
 *   la leen tres sitios distintos: el arranque de la TV (`tv-handler`), el
 *   boot del cliente (`TvScreen`) y el Realtime del Jumbotron.  Hasta ahora
 *   cada uno la parseaba por su cuenta, con los defaults copiados a mano.
 *
 *   Eso es exactamente de donde salen los fallos que no dan error: basta con
 *   que alguien añada un campo y se olvide de uno de los tres para que la
 *   pantalla se comporte distinto según si acaba de arrancar o si el DJ tocó
 *   el panel.  Ya nos pasó con el slug de la sala, que tenía dos
 *   implementaciones que discrepaban.
 */

export type TvBackdropMode = "video" | "photo" | "carousel";

export type TvBackdrop = {
	mode: TvBackdropMode;
	url: string | null;
	showRanking: boolean;
	showBattle: boolean;
	showNowPlaying: boolean;
	/** Nuestra pantalla, al nivel del Top o la batalla (ver `PromoScreen`). */
	showPromo: boolean;
};

/** Lo que puede venir del jsonb: cualquier cosa, incluido nada. */
export type RawTvBackdrop = Partial<Record<keyof TvBackdrop, unknown>> | null;

export const DEFAULT_TV_BACKDROP: TvBackdrop = {
	mode: "carousel",
	url: null,
	showRanking: true,
	showBattle: true,
	// Apagado salvo que el DJ lo encienda: cambia el reparto de la pantalla.
	showNowPlaying: false,
	// Apagada salvo que el DJ la ponga: cuando está encendida ES la pantalla,
	// igual que el Top o la batalla, y nadie quiere que aparezca sola.
	showPromo: false,
};

export function normalizeTvBackdrop(raw: RawTvBackdrop): TvBackdrop {
	const mode = raw?.mode;
	return {
		mode: mode === "video" || mode === "photo" ? mode : "carousel",
		url: typeof raw?.url === "string" ? raw.url : null,
		showRanking: raw?.showRanking !== false,
		showBattle: raw?.showBattle !== false,
		showNowPlaying: raw?.showNowPlaying === true,
		showPromo: raw?.showPromo === true,
	};
}
