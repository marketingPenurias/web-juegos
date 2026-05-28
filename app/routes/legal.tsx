import { useRef } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import type { Route } from "./+types/legal";
import { gsap, useGSAP } from "../lib/gsap";

/**
 * /legal — Escudo Legal MVP.
 *
 *   Página estática, sin loaders ni dependencias de BD.  Cubre el
 *   mínimo de transparencia exigida por RGPD para un piloto cerrado
 *   (Art. 13 RGPD — info al sujeto en el momento de la recogida):
 *
 *     · Quién es el responsable del tratamiento.
 *     · Qué datos personales se procesan.
 *     · Finalidad del tratamiento.
 *     · Derechos del usuario + canal de contacto.
 *
 *   NO incluye banner de cookies: sólo usamos cookies técnicas /
 *   estrictamente necesarias (sesión Supabase Auth), exentas del
 *   consentimiento previo según Art. 22.2 LSSI (España).
 */

export function meta(_args: Route.MetaArgs) {
	return [
		{ title: "Términos y privacidad · Nightgraph" },
		{
			name: "description",
			content:
				"Información legal del piloto Nightgraph — datos que tratamos, finalidad y cómo ejercer tus derechos.",
		},
		{ name: "robots", content: "noindex,nofollow" },
	];
}

const SECTIONS: Array<{ heading: string; body: string }> = [
	{
		heading: "Quiénes somos",
		body: "Esta app es una prueba de concepto (Piloto) operada por el equipo de desarrollo de Nightgraph.",
	},
	{
		heading: "Qué datos recogemos",
		body: "Al iniciar sesión con Google, únicamente capturamos tu dirección de correo electrónico y tu nombre público.",
	},
	{
		heading: "Para qué usamos tus datos",
		body: "Exclusivamente para crear tu monedero virtual de tokens y gestionar tu sesión en La Pocha durante la duración de este piloto.",
	},
	{
		heading: "Tus derechos",
		body: "No venderemos, cederemos ni compartiremos tus datos con terceros. Si deseas que eliminemos tu cuenta y tu correo de nuestra base de datos, simplemente escríbenos a nightgraph-admin@nightgraph.io y lo borraremos inmediatamente.",
	},
];

const CONTACT_EMAIL = "nightgraph-admin@nightgraph.io";

export default function Legal() {
	const containerRef = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			gsap.from(".legal-fade", {
				y: 16,
				opacity: 0,
				stagger: 0.07,
				duration: 0.5,
				ease: "power3.out",
			});
		},
		{ scope: containerRef },
	);

	return (
		<div
			ref={containerRef}
			className="min-h-dvh w-full bg-black text-white relative flex flex-col"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-4 flex items-center justify-between legal-fade shrink-0">
				<Link
					to="/"
					aria-label="Volver"
					className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400 transition-transform"
				>
					<ArrowLeft className="w-4 h-4" aria-hidden="true" />
				</Link>
				<div className="text-center">
					<p className="text-[10px] uppercase tracking-[0.3em] text-cyan-300 font-bold">
						Información legal
					</p>
					<h1 className="text-base font-black italic tracking-tight text-white">
						Piloto Nightgraph
					</h1>
				</div>
				<div className="w-10 h-10" aria-hidden="true" />
			</header>

			<main className="flex-1 px-6 pb-12 max-w-2xl mx-auto w-full">
				<div className="legal-fade inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-500/30 mb-6">
					<ShieldCheck
						className="w-3.5 h-3.5 text-cyan-300"
						aria-hidden="true"
					/>
					<span className="text-[10px] font-black tracking-widest text-cyan-300 uppercase">
						Términos de uso y privacidad
					</span>
				</div>

				<p className="legal-fade text-zinc-400 text-sm leading-relaxed mb-8">
					Antes de iniciar sesión, lee con calma cómo tratamos tu información
					durante este piloto. Si tienes cualquier duda, escríbenos a{" "}
					<a
						href={`mailto:${CONTACT_EMAIL}`}
						className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
					>
						{CONTACT_EMAIL}
					</a>
					.
				</p>

				<dl className="flex flex-col gap-5">
					{SECTIONS.map(({ heading, body }) => (
						<section
							key={heading}
							className="legal-fade rounded-2xl bg-zinc-900/50 border border-zinc-800 p-5"
						>
							<dt className="text-xs uppercase tracking-[0.3em] text-cyan-300 font-black mb-2">
								{heading}
							</dt>
							<dd className="text-sm leading-relaxed text-zinc-200">
								{body.includes(CONTACT_EMAIL) ? (
									<>
										{body.split(CONTACT_EMAIL)[0]}
										<a
											href={`mailto:${CONTACT_EMAIL}`}
											className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-400 rounded font-bold"
										>
											{CONTACT_EMAIL}
										</a>
										{body.split(CONTACT_EMAIL)[1]}
									</>
								) : (
									body
								)}
							</dd>
						</section>
					))}
				</dl>

				<p className="legal-fade text-[11px] text-zinc-600 mt-8 text-center leading-relaxed">
					Documento informativo del piloto Nightgraph · Última actualización:
					28 de mayo de 2026
				</p>

				<div className="legal-fade mt-8">
					<Link
						to="/"
						className="block w-full h-12 rounded-2xl bg-white text-black font-black tracking-tight flex items-center justify-center gap-2 active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400"
					>
						Volver al inicio
					</Link>
				</div>
			</main>
		</div>
	);
}
