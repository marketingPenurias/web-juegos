import { useEffect } from "react";
import { useGameState, type Screen } from "../store/useGameState";

/**
 * useDeepLinkScreen — abrir la app directamente en una pantalla concreta.
 *
 *   Nace con el QR de la BATALLA en la tele (V20): escanear lleva a
 *   `/checkin?code=…&next=live`, y tras registrar la visita el usuario debe
 *   aterrizar en el duelo, no en el Hub.
 *
 *   Por qué vía localStorage y no leyendo el query en el momento:
 *     · El destino tiene que SOBREVIVIR al redirect de Google OAuth (el usuario
 *       nuevo escanea → login → vuelve a `/`), y a que la sesión tarde en
 *       resolverse.  Guardamos la intención y la aplicamos cuando hay perfil.
 *     · Aplicarla antes de tener sesión mandaría al usuario a una pantalla que
 *       sólo sabe decir "inicia sesión".
 *
 *   Es one-shot: se consume al aplicarla, así un refresh no vuelve a forzarla.
 */

export const PENDING_SCREEN_KEY = "ng_pending_screen";

/** Pantallas que aceptamos por deep-link (evita valores arbitrarios en la URL). */
const ALLOWED: Screen[] = [
	"hub",
	"live",
	"menu",
	"tinder",
	"ruleta",
	"ticket",
	"jukebox",
	"profile",
];

function isAllowed(value: string | null): value is Screen {
	return !!value && (ALLOWED as string[]).includes(value);
}

/** Guarda la intención de navegación (la consume `useDeepLinkScreen`). */
export function rememberScreen(value: string | null): void {
	if (typeof window === "undefined" || !isAllowed(value)) return;
	try {
		window.localStorage.setItem(PENDING_SCREEN_KEY, value);
	} catch {
		/* modo incógnito / storage lleno: se pierde el deep-link, no rompemos */
	}
}

export function useDeepLinkScreen(): void {
	const setScreen = useGameState((s) => s.setScreen);
	const userProfileId = useGameState((s) => s.userProfileId);

	// 1) `/?screen=live` → recordar y limpiar la URL (para que un refresh no
	//    vuelva a forzar la pantalla).
	useEffect(() => {
		if (typeof window === "undefined") return;
		const url = new URL(window.location.href);
		const raw = url.searchParams.get("screen");
		if (!raw) return;
		rememberScreen(raw);
		url.searchParams.delete("screen");
		window.history.replaceState(
			{},
			"",
			`${url.pathname}${url.search}${url.hash}`,
		);
	}, []);

	// 2) En cuanto hay sesión resuelta, aplicar la intención pendiente.
	useEffect(() => {
		if (typeof window === "undefined" || !userProfileId) return;
		let pending: string | null = null;
		try {
			pending = window.localStorage.getItem(PENDING_SCREEN_KEY);
		} catch {
			pending = null;
		}
		if (!isAllowed(pending)) return;
		setScreen(pending);
		try {
			window.localStorage.removeItem(PENDING_SCREEN_KEY);
		} catch {
			/* ignore */
		}
	}, [userProfileId, setScreen]);
}
