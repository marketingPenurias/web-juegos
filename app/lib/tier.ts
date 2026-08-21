/**
 * Tier helpers — SOLO presentación.
 *
 *   Los umbrales, la tasa tk/€ y los canjes por noche son **configurables por
 *   discoteca** y viven en `tenant_tier_thresholds`.  El servidor los aplica
 *   (`get_user_tier`, `get_promo_catalog`) y manda el resultado ya resuelto:
 *   el tier en `/api/session`, los precios y bloqueos en `/api/catalog`.
 *
 *   Aquí quedan únicamente los colores y el emoji de respaldo.  Cualquier
 *   umbral cableado en el cliente sería una copia que se desincroniza en
 *   cuanto una sala cambie su escalera — de hecho ya pasó: este módulo decía
 *   que Plata eran 500 puntos cuando la BD llevaba tiempo en 300.
 */

export type TierCode = "bronce" | "plata" | "oro" | "platino";

export type TierMeta = {
	code: TierCode;
	displayName: string;
	emoji: string;
	colorPrimary: string;
	colorAccent: string;
	colorRing: string;
};

/**
 * Respaldo visual.  El nombre y el emoji reales llegan en `tiers` desde
 * `/api/session` (una sala puede llamar "Leyenda" a su nivel máximo); esto
 * solo cubre el primer render, antes de que la sesión responda.
 */
export const TIERS: Record<TierCode, TierMeta> = {
	bronce: {
		code: "bronce",
		displayName: "Bronce",
		emoji: "🥉",
		colorPrimary: "#CD7F32",
		colorAccent: "#A0522D",
		colorRing: "rgba(205, 127, 50, 0.5)",
	},
	plata: {
		code: "plata",
		displayName: "Plata",
		emoji: "🥈",
		colorPrimary: "#C0C0C0",
		colorAccent: "#9CA3AF",
		colorRing: "rgba(192, 192, 192, 0.5)",
	},
	oro: {
		code: "oro",
		displayName: "Oro",
		emoji: "🥇",
		colorPrimary: "#FFD700",
		colorAccent: "#FFA500",
		colorRing: "rgba(255, 215, 0, 0.5)",
	},
	platino: {
		code: "platino",
		displayName: "Platino",
		emoji: "💎",
		colorPrimary: "#E5E4E2",
		colorAccent: "#7DF9FF",
		colorRing: "rgba(125, 249, 255, 0.5)",
	},
};

export const TIER_ORDER: TierCode[] = ["bronce", "plata", "oro", "platino"];

export function isTierCode(value: unknown): value is TierCode {
	return (
		value === "bronce" ||
		value === "plata" ||
		value === "oro" ||
		value === "platino"
	);
}
