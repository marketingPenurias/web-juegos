import type { Route } from "./+types/tv.music";
import { TvScreen } from "../components/TvScreen";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Nightgraph TV · Top en directo" },
		{ name: "robots", content: "noindex" },
	];
}

/**
 * `/tv/music` — variante "sólo Top" del Jumbotron.
 *
 *   Wrapper fino sobre el MISMO componente que `/tv/dashboard`
 *   (`TvScreen`), con QR y modo Batalla desactivados.  Ya no es un
 *   componente paralelo: comparte boot/auth/Realtime/branding.  La
 *   pantalla always-on recomendada es `/tv/dashboard` (incluye QR).
 */
export default function TvMusic() {
	return <TvScreen />;
}
