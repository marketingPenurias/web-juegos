import { useEffect, useState } from "react";
import type { Route } from "./+types/home";
import LaPochaApp from "../components/LaPochaApp";
import "../lib/i18n";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "La Pocha · Juegos en Vivo" },
		{
			name: "description",
			content:
				"La Pocha · gamificación y experiencias VIP en directo. Juega, vota y desbloquea.",
		},
		{ name: "theme-color", content: "#000000" },
	];
}

export default function Home() {
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);

	if (!hydrated) {
		return (
			<div className="electric-bg min-h-dvh w-full flex items-center justify-center">
				<div className="w-full sm:max-w-[390px] sm:h-[844px] sm:rounded-[40px] sm:border-8 sm:border-zinc-900 bg-[#050505] flex items-center justify-center">
					<div className="flex flex-col items-center gap-4">
						<div className="w-12 h-12 rounded-full bg-linear-to-tr from-cyan-600 to-blue-500 animate-pulse" />
						<p className="text-zinc-500 text-xs uppercase tracking-[0.3em] font-bold">
							La Pocha
						</p>
					</div>
				</div>
			</div>
		);
	}

	return <LaPochaApp />;
}
