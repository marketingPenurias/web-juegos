import { useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowRight, Beer, Coins, Music2 } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap";
import { useTenant } from "../../lib/tenant";

/**
 * PromoScreen — nuestra pantalla en la tele del local.
 *
 *   Es UNA PANTALLA MÁS, al nivel del Top de la noche o de la batalla: el DJ
 *   la pone cuando le conviene y se queda hasta que la quite.  Nació como una
 *   cuña con temporizador —veinte segundos cada cinco minutos— y estaba mal
 *   planteada: interrumpía sola, sin que nadie lo hubiera decidido, y ni el
 *   DJ ni nosotros sabíamos qué se estaba viendo en cada momento.
 *
 *   A quién le habla: a la gente que está en la pista con una copa en la
 *   mano, a diez metros y a oscuras.  No le interesa quiénes somos nosotros
 *   —no nos compran— sino qué gana sacando el móvil.  Así que el titular es
 *   suyo, "la música la eliges tú", y la marca va donde le corresponde: en
 *   pequeño, abajo.  Al dueño del local, y a cualquier otro que entre por la
 *   puerta, la firma le llega igual.
 *
 *   El bucle se enseña como bucle —juegas, ganas, cambias— porque es lo que
 *   es.  Numerarlo 1-2-3 diría que hay un final, y no lo hay: la gracia es
 *   que vuelve a empezar.
 *
 *   El fondo son nodos y líneas: es el búho de nuestro logo desarmado, que
 *   en una sala a oscuras pasa por lo que parece, una parrilla de luces.
 */

/** Constelación fija: mismos puntos cada noche, sin sorpresas de layout. */
const NODES: Array<[number, number]> = [
	[8, 22], [18, 12], [27, 30], [14, 44], [35, 16], [44, 34], [33, 52],
	[52, 12], [61, 28], [55, 48], [70, 18], [78, 36], [66, 56], [88, 24],
	[92, 46], [24, 68], [46, 72], [74, 74], [12, 84], [58, 88], [86, 82],
];
/** Líneas entre nodos cercanos (índices en NODES). */
const EDGES: Array<[number, number]> = [
	[0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [2, 5], [5, 6], [4, 7], [7, 8],
	[8, 9], [5, 9], [8, 10], [10, 11], [11, 12], [9, 12], [11, 13], [13, 14],
	[3, 15], [15, 16], [6, 16], [16, 17], [12, 17], [15, 18], [16, 19], [17, 20],
];

export function PromoScreen({
	qrUrl,
	host,
}: {
	qrUrl: string;
	host: string;
}) {
	const tenant = useTenant();
	const rootRef = useRef<HTMLDivElement>(null);

	useGSAP(
		() => {
			// La entrada arranca en `opacity: 0`.  Si el navegador congela los
			// fotogramas —y esta pantalla lleva ocho horas encendida sin que
			// nadie la toque— el tween se queda a medias y la cuña son veinte
			// segundos de negro.  Sin primer plano no se anima: se ve y ya.
			if (document.visibilityState !== "visible") return;
			gsap.from(".promo-in", {
				y: 26,
				opacity: 0,
				stagger: 0.09,
				duration: 0.6,
				ease: "power3.out",
			});
			// La constelación respira: lento, para que no compita con nada.
			gsap.to(".promo-node", {
				opacity: 0.9,
				duration: 2.2,
				stagger: { each: 0.12, from: "random" },
				repeat: -1,
				yoyo: true,
				ease: "sine.inOut",
			});
		},
		{ scope: rootRef },
	);

	const accent = tenant.theme.primary ?? "#7DF9FF";

	return (
		<div
			ref={rootRef}
			className="absolute inset-0 z-[44] bg-black/80 backdrop-blur-xl flex items-center justify-center px-16"
			aria-hidden="true"
		>
			{/* El búho desarmado: nodos y líneas, muy por debajo del contenido. */}
			<svg
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
				className="absolute inset-0 w-full h-full opacity-25"
			>
				{EDGES.map(([a, b], i) => (
					<line
						key={i}
						x1={NODES[a][0]}
						y1={NODES[a][1]}
						x2={NODES[b][0]}
						y2={NODES[b][1]}
						stroke={accent}
						strokeWidth={0.12}
					/>
				))}
				{NODES.map(([x, y], i) => (
					<circle
						key={i}
						className="promo-node"
						cx={x}
						cy={y}
						r={0.55}
						fill={accent}
						opacity={0.25}
					/>
				))}
			</svg>

			<div className="relative z-10 w-full max-w-[1500px] grid grid-cols-[1fr_auto] gap-20 items-center">
				<div className="min-w-0">
					<p className="promo-in text-lg uppercase tracking-[0.5em] font-black text-zinc-500">
						{tenant.name}
					</p>
					<h2 className="promo-in mt-4 text-9xl font-black italic tracking-tighter leading-[0.88]">
						LA MÚSICA
						<br />
						<span style={{ color: accent }}>LA ELIGES TÚ</span>
					</h2>

					{/* El bucle, dibujado como bucle. */}
					<div className="promo-in mt-14 flex items-center gap-5">
						<Step icon={Music2} text="Pide tu canción" accent={accent} />
						<ArrowRight
							className="w-8 h-8 text-zinc-700 shrink-0"
							aria-hidden="true"
						/>
						<Step icon={Coins} text="Gana fichas" accent={accent} />
						<ArrowRight
							className="w-8 h-8 text-zinc-700 shrink-0"
							aria-hidden="true"
						/>
						<Step icon={Beer} text="Cámbialas en barra" accent={accent} />
					</div>
				</div>

				<div className="promo-in flex flex-col items-center gap-5 shrink-0">
					<div className="rounded-3xl bg-white p-6 shadow-[0_0_80px_rgba(255,255,255,0.25)]">
						<QRCodeSVG
							value={qrUrl}
							level="M"
							marginSize={0}
							fgColor="#000000"
							bgColor="#ffffff"
							className="w-72 h-72"
						/>
					</div>
					<p className="text-3xl font-black italic tracking-tight">
						Escanea y juega
					</p>
					<p className="text-lg text-zinc-500 font-bold">{host}</p>
				</div>
			</div>

			{/* La firma, en su sitio: pequeña y abajo. */}
			<div className="absolute bottom-10 right-16 flex items-center gap-3 opacity-60">
				<img
					src="/logo-nightgraph.jpg"
					alt=""
					className="w-9 h-9 rounded-lg object-cover"
				/>
				<span className="text-sm font-black uppercase tracking-[0.35em] text-zinc-400">
					NightGraph
				</span>
			</div>
		</div>
	);
}

function Step({
	icon: Icon,
	text,
	accent,
}: {
	icon: typeof Music2;
	text: string;
	accent: string;
}) {
	return (
		<div className="flex items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-6 py-4">
			<Icon className="w-8 h-8 shrink-0" style={{ color: accent }} aria-hidden="true" />
			<span className="text-2xl font-black tracking-tight whitespace-nowrap">
				{text}
			</span>
		</div>
	);
}
