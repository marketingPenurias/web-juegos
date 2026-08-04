/**
 * Tier helpers — Piloto MVP.
 *
 * Para el piloto, la UI asume Bronce para todos los usuarios (decisión
 * CTO: cero lógica de bloqueos compleja en el cliente).  La BD sí
 * almacena lifetime_earned y la RPC `purchase_reward` valida el tier
 * server-side; el cliente sólo renderiza visual.
 *
 * Cuando entremos a Fase 2 del Architecture Proposal, este módulo se
 * extenderá con `tierFromLifetime`, `evaluateProduct`, etc.  La firma
 * de `TierCode` y los metadatos visuales son compatibles hacia adelante.
 */

export type TierCode = "bronce" | "plata" | "oro" | "platino";

export type TierMeta = {
	code: TierCode;
	displayName: string;
	emoji: string;
	colorPrimary: string;
	colorAccent: string;
	colorRing: string;
	minLifetime: number;
};

export const TIERS: Record<TierCode, TierMeta> = {
	bronce: {
		code: "bronce",
		displayName: "Bronce",
		emoji: "🥉",
		colorPrimary: "#CD7F32",
		colorAccent: "#A0522D",
		colorRing: "rgba(205, 127, 50, 0.5)",
		minLifetime: 0,
	},
	plata: {
		code: "plata",
		displayName: "Plata",
		emoji: "🥈",
		colorPrimary: "#C0C0C0",
		colorAccent: "#9CA3AF",
		colorRing: "rgba(192, 192, 192, 0.5)",
		minLifetime: 500,
	},
	oro: {
		code: "oro",
		displayName: "Oro",
		emoji: "🥇",
		colorPrimary: "#FFD700",
		colorAccent: "#FFA500",
		colorRing: "rgba(255, 215, 0, 0.5)",
		minLifetime: 1500,
	},
	platino: {
		code: "platino",
		displayName: "Platino",
		emoji: "💎",
		colorPrimary: "#E5E4E2",
		colorAccent: "#7DF9FF",
		colorRing: "rgba(125, 249, 255, 0.5)",
		minLifetime: 4000,
	},
};

export const TIER_ORDER: TierCode[] = ["bronce", "plata", "oro", "platino"];

/**
 * Mapea lifetime_earned → TierCode con las constantes anteriores.
 * Pura, sin side effects.  Para el piloto se llama desde useSession
 * para colorear la cinta del Hub aunque la UI siga mostrando "Bronce"
 * por decisión de scope.
 */
export function tierFromLifetime(lifetime: number): TierCode {
	const safe = Math.max(0, Math.floor(lifetime || 0));
	let current: TierCode = "bronce";
	for (const code of TIER_ORDER) {
		if (safe >= TIERS[code].minLifetime) current = code;
	}
	return current;
}

/**
 * Próximo umbral por encima del tier actual.  null si ya Platino.
 */
export function nextTier(code: TierCode): TierMeta | null {
	const idx = TIER_ORDER.indexOf(code);
	if (idx < 0 || idx >= TIER_ORDER.length - 1) return null;
	return TIERS[TIER_ORDER[idx + 1]];
}

/** Posición del tier en la escalera (bronce=0 … platino=3). */
export function tierRank(code: TierCode | null | undefined): number {
	const idx = code ? TIER_ORDER.indexOf(code) : -1;
	return idx < 0 ? 0 : idx; // sin requisito = bronce (accesible a todos)
}

/**
 * Visibilidad de un producto según el tier del usuario (V20 · F3).
 *
 *   Regla de producto: ves lo tuyo y **asomas al siguiente nivel** como
 *   zanahoria; lo que está dos escalones por encima ni se muestra (ruido).
 *
 *     bronce → ve bronce (disponible) + plata ("próximamente")
 *     oro    → ve bronce/plata/oro (disponible) + platino ("próximamente")
 *
 *   Pura y sin dependencias: fácil de testear y de reutilizar en otras vistas.
 */
export type ProductVisibility = "available" | "locked_next" | "hidden";

export function productVisibility(
	productTier: TierCode | null | undefined,
	userTier: TierCode,
): ProductVisibility {
	const p = tierRank(productTier);
	const u = tierRank(userTier);
	if (p <= u) return "available";
	if (p === u + 1) return "locked_next";
	return "hidden";
}

/**
 * Puntos (lifetime_earned) que faltan para alcanzar un tier.  0 si ya se tiene.
 * Sirve para el "te faltan N" de las tarjetas bloqueadas.
 */
export function pointsToTier(lifetime: number, target: TierCode): number {
	return Math.max(0, TIERS[target].minLifetime - Math.max(0, lifetime || 0));
}

/**
 * Progreso 0..1 dentro del tier actual hacia el siguiente.  Devuelve 1
 * si ya está en el tier máximo.
 */
export function tierProgressFraction(lifetime: number, code: TierCode): number {
	const meta = TIERS[code];
	const next = nextTier(code);
	if (!next) return 1;
	const range = next.minLifetime - meta.minLifetime;
	if (range <= 0) return 1;
	const offset = Math.max(0, lifetime - meta.minLifetime);
	return Math.min(1, offset / range);
}
