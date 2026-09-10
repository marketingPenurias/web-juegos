import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Sparkles } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { useGameState } from "../store/useGameState";
import { useClaim } from "../lib/useClaim";
import { TokenBadge } from "../components/TokenBadge";
import { Toast } from "../components/Toast";
import { PlayersPanel } from "../components/ruleta/PlayersPanel";
import { WinnerModal } from "../components/ruleta/WinnerModal";
import { cn } from "../lib/utils";

const SECTOR_COLORS = [
	"#39FF14",
	"#7DF9FF",
	"#FFD700",
	"#FF3CAC",
	"#9D4EDD",
	"#FF7A00",
	"#00E0A4",
	"#FF6B6B",
];

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const SAFE_JITTER = 0.32;
const DEFAULT_SPIN_REWARD = 15; // fallback; el importe real lo fija tenant_token_rewards.

/**
 * RuletaRondas — quién paga la siguiente ronda.
 *
 *   Rediseño del 9 de septiembre.  El problema no era que la gente no
 *   encontrase dónde cambiar los nombres: era que la pantalla se abría
 *   TERMINADA.  Cuatro nombres inventados ya puestos, la rueda montada y el
 *   botón de girar encendido.  Un campo relleno dice "esto ya está bien";
 *   solo un hueco vacío pide que lo llenes.  Así que se sorteaba entre
 *   Andrea, Mario, Lucía y Carlos, que no estaban en la mesa.
 *
 *   Lo que cambia:
 *
 *     · Se arranca en blanco (`friends: ["", ""]` en el store) y el primer
 *       hueco viene con el nombre de quien ha abierto la app, que es un dato
 *       real y de paso enseña con el ejemplo qué va ahí.
 *     · **La rueda se construye con los nombres.**  Un sector aparece al
 *       escribir un nombre y desaparece al borrarlo.  No hace falta explicar
 *       la relación: se ve.
 *     · El botón de girar no existe hasta que hay con quién jugar, y mientras
 *       tanto dice qué falta en vez de no hacer nada.
 *     · El verde neón queda reservado para "listo".  Mientras se prepara,
 *       todo es cian.  Antes las dos fases eran del mismo color y por eso
 *       ninguna se leía como pendiente.
 *
 *   Y un fallo de verdad que había debajo: la rueda se dibujaba sobre TODOS
 *   los huecos y el sorteo también, así que con dos nombres y dos huecos
 *   vacíos podía tocarle pagar a "Amigo 4".  Ahora la rueda y el sorteo son
 *   la misma lista: solo los nombres escritos.
 *
 *   Economía (sin cambios): girar concede +15 fichas vía `useClaim` →
 *   `/api/wallet`, con el importe y el límite diario decididos en el
 *   servidor.  El "quién paga" es una decisión social, no toca el ledger.
 */

export function RuletaRondas() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);
	const friends = useGameState((s) => s.friends);
	const setFriends = useGameState((s) => s.setFriends);
	const displayName = useGameState((s) => s.displayName);
	const addTokens = useGameState((s) => s.addTokens);
	const markDaily = useGameState((s) => s.markDaily);
	const activeEventId = useGameState((s) => s.activeEventId);
	const rewardAmount = useGameState((s) => s.rewardAmount);
	const { claim } = useClaim();

	// Economía centralizada (single source of truth = backend).
	const SPIN_REWARD = rewardAmount("ruleta_spin", DEFAULT_SPIN_REWARD);

	const containerRef = useRef<HTMLDivElement>(null);
	const wheelRef = useRef<SVGSVGElement>(null);
	const totalRotationRef = useRef(0);
	// Cómo ha ido el cobro de esta tirada.  `null` = todavía no ha contestado
	// el servidor.  Hace falta guardarlo porque el aviso se da cuando la rueda
	// para, cinco segundos y medio después de pedirlo.
	const claimRef = useRef<{ ok: boolean } | null>(null);

	const [spinning, setSpinning] = useState(false);
	const [panelOpen, setPanelOpen] = useState(true);
	const [loserIndex, setLoserIndex] = useState<number | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const [tone, setTone] = useState<"default" | "warning" | "success">(
		"default",
	);

	// Quien juega DE VERDAD: los huecos con algo escrito, conservando de qué
	// fila salen para poder marcar al que paga allí arriba.
	const players = useMemo(
		() =>
			friends
				.map((name, idx) => ({ name: name.trim(), idx }))
				.filter((p) => p.name.length > 0),
		[friends],
	);
	const ready = players.length >= MIN_PLAYERS;

	// El primer nombre, puesto: es el de quien ha abierto la app.  Un dato
	// real, no un ejemplo inventado — y ahorra un campo que teclear en una
	// barra a oscuras.  Solo si no hay nada escrito todavía.
	useEffect(() => {
		if (!displayName) return;
		if (friends.some((f) => f.trim().length > 0)) return;
		setFriends([displayName.slice(0, 12), ...friends.slice(1)]);
	}, [displayName, friends, setFriends]);

	useGSAP(
		() => {
			// La entrada arranca desde `opacity: 0`, así que mientras dura, los
			// nombres y el botón de girar no existen para el usuario.  Si el
			// navegador congela los fotogramas —pestaña en segundo plano, móvil
			// bloqueado, ahorro de batería— el tween se queda a medias y la
			// pantalla se queda sin controles: pasa de verdad, alguien abre la
			// app, mira el WhatsApp y vuelve.  Si al montar no estamos en
			// primer plano no se anima nada y todo se ve, que es lo que importa.
			if (document.visibilityState !== "visible") return;
			gsap.from(".rul-fade", {
				y: 18,
				opacity: 0,
				stagger: 0.07,
				duration: 0.5,
				ease: "power3.out",
			});
		},
		{ scope: containerRef },
	);

	// La rueda acusa cada nombre nuevo.  Es el momento que explica el juego
	// sin una sola línea de texto: escribes a alguien y aparece su trozo.
	useGSAP(
		() => {
			if (spinning) return;
			gsap.from(".rul-sector:last-of-type", {
				scale: 0.82,
				opacity: 0,
				duration: 0.4,
				ease: "back.out(2)",
				transformOrigin: "150px 150px",
			});
		},
		{ scope: containerRef, dependencies: [players.length] },
	);

	const updateName = (i: number, value: string) => {
		const next = [...friends];
		next[i] = value;
		setFriends(next);
		setLoserIndex(null);
	};

	const addPlayer = () => {
		if (friends.length >= MAX_PLAYERS) return;
		setFriends([...friends, ""]);
		setLoserIndex(null);
	};

	const removeAt = (i: number) => {
		if (friends.length <= MIN_PLAYERS) return;
		setFriends(friends.filter((_, j) => j !== i));
		setLoserIndex(null);
	};

	// El color del sector de cada fila, para que se pueda saber cuál eres tú
	// en la rueda.  Una fila vacía no tiene color porque no está en la rueda.
	const colorFor = (friendIndex: number): string | null => {
		const pos = players.findIndex((p) => p.idx === friendIndex);
		return pos === -1 ? null : SECTOR_COLORS[pos % SECTOR_COLORS.length];
	};

	const translateClaimError = (code: string): string => {
		switch (code) {
			case "unauthorized":
				return t("ruleta.errAuth", "Inicia sesión para ganar tokens");
			case "daily_limit_reached":
				return t("ruleta.errDaily", "Ya giraste hoy · vuelve mañana");
			case "network_error":
				return t("ruleta.errNetwork", "Sin conexión · no se conceden tokens");
			default:
				return t("ruleta.errGeneric", "No se pudo guardar el premio");
		}
	};

	const handleSpin = async () => {
		if (spinning || !ready || !wheelRef.current) return;

		// ── OPTIMISTIC UI ──────────────────────────────────────────────
		// Sumamos los tokens y giramos YA (60fps, sin bloquear en la red).
		// El claim corre en background; el RPC valida el límite diario y
		// el ledger es la autoridad final: si falla (ya giró hoy / sin
		// red), `useClaim` reconcilia el balance via setBalance y aquí
		// avisamos con un toast.  Cero "tokens fantasma" tras reconciliar.
		addTokens(SPIN_REWARD, "history.tx_ruleta");
		markDaily("ruleta_spin"); // misión reactiva: check verde al instante
		claimRef.current = null;
		void claim("ruleta_spin", activeEventId).then((result) => {
			claimRef.current = { ok: result.ok };
			if (!result.ok) {
				setTone("warning");
				setToast(translateClaimError(result.error));
			}
		});

		setSpinning(true);
		setLoserIndex(null);
		// Los nombres ya han hecho su trabajo: fuera, que la rueda se lleve
		// la pantalla entera durante los cinco segundos que importan.
		setPanelOpen(false);

		const sectorCount = players.length;
		const sectorAngle = 360 / sectorCount;
		const targetPos = Math.floor(Math.random() * sectorCount);
		const baseTurns = 6 + Math.floor(Math.random() * 3);

		const jitter = (Math.random() * 2 - 1) * SAFE_JITTER * sectorAngle;
		const sectorMid = targetPos * sectorAngle + sectorAngle / 2 + jitter;

		// La flecha tiene que acabar señalando al que paga.  Antes se sumaba
		// `360 - sectorMid` a lo que ya llevaba girado, y como lo que llevaba
		// girado NO era múltiplo de 360, el resultado quedaba desplazado: la
		// primera tirada acertaba (se partía de cero) y a partir de la segunda
		// el nombre del cartel y el sector de la flecha eran distintos.  En
		// simulación, 1.042 de 1.400 tiradas.  Justo en "Otra ronda", que es
		// donde más se mira.
		//
		// Se calcula el ángulo final ABSOLUTO y se gira sólo lo que falta para
		// llegar a él, siempre hacia adelante.
		const currentRot = totalRotationRef.current;
		const targetMod = normalizeDeg(360 - sectorMid);
		const currentMod = normalizeDeg(currentRot);
		const delta = normalizeDeg(targetMod - currentMod);
		const finalRotation = currentRot + baseTurns * 360 + delta;

		gsap.to(wheelRef.current, {
			rotation: finalRotation,
			duration: 5.5,
			ease: "power4.out",
			transformOrigin: "50% 50%",
			force3D: true,
			onComplete: () => {
				totalRotationRef.current = finalRotation;
				setLoserIndex(players[targetPos].idx);
				setSpinning(false);
				// Sólo se canta el premio si de verdad se ha cobrado.  Antes se
				// cantaba siempre: en la segunda tirada de la noche el saldo no
				// se movía —el límite es una por noche— y la app seguía diciendo
				// "+15 tokens ✓".  Decirle a alguien que ha ganado fichas que no
				// tiene es de lo peor que puede hacer esta app.
				if (claimRef.current?.ok) {
					setTone("success");
					setToast(
						t("ruleta.tokensWon", "+{{n}} tokens por girar", {
							n: SPIN_REWARD,
						}),
					);
				}
			},
		});
	};

	const reset = () => {
		setLoserIndex(null);
	};

	const exit = () => {
		setLoserIndex(null);
		setScreen("hub");
	};

	const sectorAngle = players.length > 0 ? 360 / players.length : 360;
	const radius = 130;
	const cx = 150;
	const cy = 150;

	const loserName = loserIndex !== null ? friends[loserIndex].trim() : "";

	return (
		<div
			ref={containerRef}
			className="flex-1 flex flex-col relative z-20 min-h-0 overflow-hidden bg-black"
		>
			<header className="px-6 pt-12 sm:pt-8 pb-2 flex items-center justify-between rul-fade shrink-0">
				<button
					type="button"
					onClick={() => setScreen("hub")}
					aria-label={t("common.back")}
					className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan-400"
				>
					<ArrowLeft className="w-4 h-4" aria-hidden="true" />
				</button>
				<div className="text-center">
					<p className="text-[10px] uppercase tracking-[0.3em] text-lime-400 font-bold">
						{t("ruleta.miniGame")}
					</p>
					<h1 className="text-base font-black italic tracking-tight text-white">
						{t("ruleta.title")}
					</h1>
				</div>
				<TokenBadge />
			</header>

			<PlayersPanel
				friends={friends}
				colorFor={colorFor}
				onChange={updateName}
				onAdd={addPlayer}
				onRemoveAt={removeAt}
				loserIndex={loserIndex}
				disabled={spinning}
				open={panelOpen}
				onToggle={() => setPanelOpen((o) => !o)}
			/>

			<main className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-2 relative overflow-y-auto no-scrollbar">
				<div className="relative w-[300px] h-[300px] flex items-center justify-center">
					{/* El halo solo cuando hay partida.  Mientras faltan nombres la
					    rueda está apagada, y eso ya dice que falta algo. */}
					<div
						className={cn(
							"absolute inset-0 rounded-full blur-3xl pointer-events-none transition-opacity duration-500",
							ready ? "bg-lime-500/20 opacity-100" : "opacity-0",
						)}
					/>
					<div
						className={cn(
							"absolute inset-0 rounded-full border transition-all duration-500",
							ready
								? "border-lime-500/30 shadow-[0_0_45px_rgba(57,255,20,0.45)]"
								: "border-zinc-800",
						)}
					/>

					{ready ? (
						<svg
							ref={wheelRef}
							viewBox="0 0 300 300"
							className="w-[280px] h-[280px] drop-shadow-[0_0_30px_rgba(125,249,255,0.45)] will-change-transform"
							style={{ transform: "rotate(0deg)" }}
							aria-label={t("ruleta.wheelLabel")}
						>
							{players.map((player, i) => {
								const startAngle = i * sectorAngle - 90;
								const endAngle = (i + 1) * sectorAngle - 90;
								const start = polarPoint(cx, cy, radius, startAngle);
								const end = polarPoint(cx, cy, radius, endAngle);
								const largeArc = sectorAngle > 180 ? 1 : 0;
								const path = `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
								const labelAngle = startAngle + sectorAngle / 2;
								const labelPoint = polarPoint(cx, cy, radius * 0.62, labelAngle);
								const color = SECTOR_COLORS[i % SECTOR_COLORS.length];
								// Nombres del derecho SIEMPRE.  El texto va en radial, así
								// que en la mitad izquierda de la rueda sale boca abajo:
								// se le da media vuelta para que se lea igual de bien.
								const labelRot = normalizeDeg(labelAngle + 90);
								const upsideDown = labelRot > 90 && labelRot < 270;
								const textRot = upsideDown ? labelRot + 180 : labelRot;
								return (
									<g key={player.idx} className="rul-sector">
										<path
											d={path}
											fill={color}
											fillOpacity={0.18}
											stroke={color}
											strokeWidth={2}
										/>
										{/* Blanco, no del color del sector: el nombre hay que
										    leerlo de un vistazo y a un metro de distancia. */}
										<text
											x={labelPoint.x}
											y={labelPoint.y}
											textAnchor="middle"
											dominantBaseline="middle"
											fontSize={players.length > 6 ? 12 : 15}
											fontWeight="900"
											fill="#ffffff"
											stroke="#000000"
											strokeWidth={3}
											paintOrder="stroke"
											transform={`rotate(${textRot} ${labelPoint.x} ${labelPoint.y})`}
										>
											{player.name}
										</text>
									</g>
								);
							})}
							<circle
								cx={cx}
								cy={cy}
								r={28}
								fill="#0a0a0a"
								stroke="#39FF14"
								strokeWidth={2}
							/>
						</svg>
					) : (
						/* Rueda en hueco: existe, pero está sin montar.  Es la forma
						   más corta de decir "esto lo montas tú". */
						<div className="w-[280px] h-[280px] rounded-full border-2 border-dashed border-zinc-800 flex items-center justify-center px-10">
							<p className="text-center text-sm font-bold text-zinc-600 leading-snug">
								{t("ruleta.emptyWheel")}
							</p>
						</div>
					)}

					<div
						className={cn(
							"absolute top-2 left-1/2 -translate-x-1/2 w-0 h-0 z-10 transition-opacity duration-500",
							ready ? "opacity-100" : "opacity-20",
						)}
						style={{
							borderLeft: "12px solid transparent",
							borderRight: "12px solid transparent",
							borderTop: "22px solid #39FF14",
							filter: "drop-shadow(0 0 8px #39FF14)",
						}}
						aria-hidden="true"
					/>
				</div>

				<p className="mt-4 text-center text-[11px] uppercase tracking-widest text-zinc-500 font-bold">
					{ready
						? t("ruleta.spinReward", "+{{n}} tokens al girar", {
								n: SPIN_REWARD,
							})
						: t("ruleta.stake")}
				</p>
			</main>

			<footer className="px-6 pb-3 pt-2 rul-fade shrink-0">
				<button
					type="button"
					onClick={() => void handleSpin()}
					disabled={spinning || !ready}
					className={cn(
						"h-14 w-full rounded-2xl font-black tracking-tight flex items-center justify-center gap-2 active:scale-95 transition-all focus-visible:ring-2 focus-visible:ring-lime-400",
						ready
							? "bg-linear-to-r from-lime-400 to-emerald-500 text-black"
							: "bg-zinc-900 border border-zinc-800 text-zinc-500",
						ready && !spinning && "shadow-[0_0_30px_rgba(57,255,20,0.55)]",
						spinning && "opacity-50 cursor-not-allowed",
					)}
				>
					{ready && (
						<Sparkles className="w-5 h-5 fill-black" aria-hidden="true" />
					)}
					{!ready
						? t("ruleta.needNames", { count: MIN_PLAYERS - players.length })
						: spinning
							? t("ruleta.spinning")
							: t("ruleta.spin")}
				</button>
			</footer>

			{loserIndex !== null && (
				<WinnerModal
					loserName={loserName}
					onAnotherRound={reset}
					onExit={exit}
				/>
			)}

			<Toast message={toast} onDone={() => setToast(null)} tone={tone} />
		</div>
	);
}

function normalizeDeg(deg: number) {
	return ((deg % 360) + 360) % 360;
}

function polarPoint(cx: number, cy: number, r: number, angleDeg: number) {
	const rad = (angleDeg * Math.PI) / 180;
	return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
