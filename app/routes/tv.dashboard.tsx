import type { Route } from "./+types/tv.dashboard";
import { TvScreen } from "../components/TvScreen";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Nightgraph TV · Jumbotron" },
		{ name: "robots", content: "noindex" },
	];
}

/**
 * `/tv/dashboard` — Jumbotron COMPLETO (pantalla always-on).
 *
 *   Top en directo + QR de captación + modo Batalla.  Toda la lógica de
 *   boot/auth/Realtime vive en el componente compartido `TvScreen`
 *   (Operación Wiring: una sola fuente, sin duplicar con `/tv/music`).
 */
export default function TvDashboard() {
	return <TvScreen showQr enableBattle />;
}
