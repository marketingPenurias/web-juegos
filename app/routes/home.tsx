import { useEffect, useState } from "react";
import { useRouteLoaderData } from "react-router";
import type { Route } from "./+types/home";
import LaPochaApp from "../components/LaPochaApp";
import type { Tenant } from "../lib/tenant";
import "../lib/i18n";

/** Nombre del local resuelto por el root loader (o la marca, si aún no hay). */
function venueNameFrom(data: unknown): string {
	const tenant = (data as { tenant?: Partial<Tenant> } | undefined)?.tenant;
	return tenant?.name?.trim() || "NightGraph";
}

export function meta({ matches }: Route.MetaArgs) {
	// El título sale del TENANT, no de un literal: cada local debe verse con su
	// nombre en la pestaña y al compartir el enlace (antes todos ponían
	// "La Pocha", incluido cualquier cliente nuevo).
	const root = matches.find((m) => m?.id === "root");
	const name = venueNameFrom(root?.data);
	return [
		{ title: `${name} · Juegos en Vivo` },
		{
			name: "description",
			content: `${name} · gamificación y experiencias VIP en directo. Juega, vota y desbloquea.`,
		},
		{ name: "theme-color", content: "#000000" },
	];
}

export default function Home() {
	const [hydrated, setHydrated] = useState(false);
	const rootData = useRouteLoaderData("root");
	const venueName = venueNameFrom(rootData);
	useEffect(() => setHydrated(true), []);

	if (!hydrated) {
		return (
			<div className="electric-bg min-h-dvh w-full flex items-center justify-center">
				<div className="w-full sm:max-w-[390px] sm:h-[844px] sm:rounded-[40px] sm:border-8 sm:border-zinc-900 bg-[#050505] flex items-center justify-center">
					<div className="flex flex-col items-center gap-4">
						<div className="w-12 h-12 rounded-full bg-linear-to-tr from-cyan-600 to-blue-500 animate-pulse" />
						<p className="text-zinc-500 text-xs uppercase tracking-[0.3em] font-bold">
							{venueName}
						</p>
					</div>
				</div>
			</div>
		);
	}

	return <LaPochaApp />;
}
