import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CheckCircle2, Coins, Flame, MapPin, XCircle, Loader2 } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { getAccessToken } from "../lib/supabase.client";
import { PENDING_CHECKIN_KEY } from "../lib/usePendingCheckin";

/**
 * /checkin?code=POCHA-XXXX — landing del escaneo de QR físico.
 *
 *   El QR codifica `https://lapocha.nightgraph.es/checkin?code=...`.
 *   La página: exige sesión, llama a `POST /api/checkin`, y celebra el
 *   resultado (recompensa + racha + pop-up de hito).  Toda la lógica de
 *   negocio (validez del QR, límite, racha) vive en el RPC server-side;
 *   aquí sólo pintamos el resultado.
 */

type State =
	| { phase: "loading" }
	| { phase: "need_login" }
	| { phase: "no_code" }
	| {
			phase: "ok";
			qrLabel: string;
			reward: number;
			streak: number;
			milestoneWeek: number;
			milestoneAmount: number;
	  }
	| { phase: "error"; code: string; qrLabel?: string };

function tenantSlugFromHost(): string {
	if (typeof window === "undefined") return "lapocha";
	const host = window.location.hostname;
	const sub = host.split(".")[0];
	// Subdominios de marca → slug; localhost / pages.dev → lapocha (piloto).
	if (!sub || sub === "localhost" || sub === "www" || host.includes("pages.dev")) {
		return "lapocha";
	}
	return sub;
}

export default function Checkin() {
	const [state, setState] = useState<State>({ phase: "loading" });
	const cardRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();

	useEffect(() => {
		let cancelled = false;
		async function run() {
			const params = new URLSearchParams(window.location.search);
			const code = (params.get("code") ?? "").trim();
			if (!code) {
				setState({ phase: "no_code" });
				return;
			}
			let token: string | null = null;
			try {
				token = await getAccessToken();
			} catch {
				token = null;
			}
			if (!token) {
				// FLUJO FRÍO: guardamos el código y mandamos a loguearse.  El
				// hook `usePendingCheckin` (montado en la app) lo procesará
				// automáticamente en cuanto haya sesión.
				try {
					window.localStorage.setItem(PENDING_CHECKIN_KEY, code);
				} catch {
					/* ignore */
				}
				setState({ phase: "need_login" });
				// Navegación SPA (sin hard-reload): preserva estado y caché.
				// El hook `usePendingCheckin` procesará el código tras el login.
				window.setTimeout(() => {
					if (!cancelled) navigate("/", { replace: true });
				}, 1800);
				return;
			}
			try {
				const res = await fetch("/api/checkin", {
					method: "POST",
					cache: "no-store",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
						"X-Tenant-Slug": tenantSlugFromHost(),
					},
					body: JSON.stringify({ code, tenant_slug: tenantSlugFromHost() }),
				});
				const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
				if (cancelled) return;
				if (res.ok && data.ok === true) {
					setState({
						phase: "ok",
						qrLabel: String(data.qr_label ?? "Check-in"),
						reward: Number(data.reward_amount ?? 0),
						streak: Number(data.streak ?? 0),
						milestoneWeek: Number(data.milestone_week ?? 0),
						milestoneAmount: Number(data.milestone_amount ?? 0),
					});
				} else {
					setState({
						phase: "error",
						code: String(data.error ?? "error"),
						qrLabel: data.qr_label ? String(data.qr_label) : undefined,
					});
				}
			} catch {
				if (!cancelled) setState({ phase: "error", code: "network_error" });
			}
		}
		void run();
		return () => {
			cancelled = true;
		};
	}, [navigate]);

	useGSAP(
		() => {
			if (state.phase === "ok" || state.phase === "error") {
				gsap.fromTo(
					cardRef.current,
					{ scale: 0.7, opacity: 0, y: 24 },
					{ scale: 1, opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.7)", force3D: true },
				);
			}
		},
		{ dependencies: [state.phase] },
	);

	return (
		<div className="min-h-dvh w-full bg-black flex items-center justify-center px-6 text-center">
			<div className="absolute inset-0 pointer-events-none">
				<div className="absolute top-[-10%] left-[-20%] w-[250px] h-[250px] bg-lime-500/20 rounded-full blur-[100px]" />
				<div className="absolute bottom-[10%] right-[-10%] w-[300px] h-[300px] bg-cyan-500/10 rounded-full blur-[120px]" />
			</div>

			<div ref={cardRef} className="relative z-10 w-full max-w-[360px]">
				{state.phase === "loading" && (
					<div className="flex flex-col items-center gap-4 text-zinc-300">
						<Loader2 className="w-10 h-10 animate-spin text-lime-400" aria-hidden="true" />
						<p className="font-bold">Validando tu check-in…</p>
					</div>
				)}

				{state.phase === "no_code" && (
					<Msg icon={<XCircle className="w-12 h-12 text-rose-400" />} title="QR no válido"
						sub="Este enlace no contiene un código de check-in." />
				)}

				{state.phase === "need_login" && (
					<div className="flex flex-col items-center gap-4">
						<MapPin className="w-12 h-12 text-cyan-400 animate-pulse" aria-hidden="true" />
						<h1 className="text-2xl font-black italic text-white">Te llevamos a entrar…</h1>
						<p className="text-zinc-400 text-sm">Guardamos tu check-in. En cuanto inicies sesión, lo sumamos automáticamente. 🎁</p>
						<Link to="/" replace className="mt-2 h-12 px-6 rounded-2xl bg-white text-black font-black flex items-center justify-center active:scale-95">
							Continuar
						</Link>
					</div>
				)}

				{state.phase === "ok" && (
					<div className="rounded-4xl bg-linear-to-br from-zinc-900 to-zinc-950 border border-lime-400/50 p-7 shadow-[0_0_60px_rgba(57,255,20,0.35)]">
						<div className="w-20 h-20 rounded-full bg-lime-500/15 border border-lime-400/50 mx-auto flex items-center justify-center mb-4">
							<CheckCircle2 className="w-10 h-10 text-lime-300" aria-hidden="true" />
						</div>
						<p className="text-[10px] uppercase tracking-[0.3em] text-lime-400 font-bold mb-1">{state.qrLabel}</p>
						<h1 className="text-2xl font-black italic text-white mb-3">¡Check-in confirmado!</h1>

						{state.reward > 0 ? (
							<div className="flex items-center justify-center gap-2 my-3">
								<Coins className="w-7 h-7 text-amber-300" aria-hidden="true" />
								<span className="text-4xl font-black text-amber-300 tabular-nums">+{state.reward}</span>
							</div>
						) : (
							<p className="text-sm text-zinc-400 my-3">Ya cobraste tu premio de check-in esta noche, pero tu visita cuenta para la racha.</p>
						)}

						<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/15 border border-orange-400/40 mb-2">
							<Flame className="w-4 h-4 text-orange-300" aria-hidden="true" />
							<span className="text-xs font-black text-orange-200">Racha: {state.streak} {state.streak === 1 ? "semana" : "semanas"}</span>
						</div>

						{state.milestoneWeek > 0 && (
							<div className="mt-3 rounded-2xl bg-amber-500/10 border border-amber-400/50 p-3">
								<p className="text-[10px] uppercase tracking-widest text-amber-300 font-black">🏆 ¡Hito de fidelidad!</p>
								<p className="text-sm text-white font-bold mt-1">{state.milestoneWeek} semanas seguidas · +{state.milestoneAmount} tokens extra</p>
							</div>
						)}

						<Link to="/" className="mt-5 inline-flex w-full h-12 rounded-2xl bg-linear-to-r from-lime-400 to-emerald-500 text-black font-black items-center justify-center active:scale-95">
							Volver a la app
						</Link>
					</div>
				)}

				{state.phase === "error" && (
					<div className="rounded-4xl bg-linear-to-br from-zinc-900 to-zinc-950 border border-zinc-700 p-7">
						<div className="w-16 h-16 rounded-full bg-zinc-800 border border-zinc-700 mx-auto flex items-center justify-center mb-4">
							<XCircle className="w-9 h-9 text-rose-400" aria-hidden="true" />
						</div>
						<h1 className="text-xl font-black italic text-white mb-2">
							{state.code === "already_checked_in" ? "Ya hiciste este check-in" : "No se pudo registrar"}
						</h1>
						<p className="text-zinc-400 text-sm">
							{state.code === "already_checked_in"
								? `${state.qrLabel ?? "Este QR"} ya está registrado en tu noche. ¡Vuelve mañana!`
								: state.code === "invalid_qr"
									? "Este QR no es válido o ya no está activo."
									: "Inténtalo de nuevo en unos segundos."}
						</p>
						<Link to="/" className="mt-5 inline-flex w-full h-12 rounded-2xl bg-zinc-800 border border-zinc-700 text-zinc-100 font-black items-center justify-center active:scale-95">
							Volver a la app
						</Link>
					</div>
				)}
			</div>
		</div>
	);
}

function Msg({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
	return (
		<div className="flex flex-col items-center gap-3">
			<div aria-hidden="true">{icon}</div>
			<h1 className="text-2xl font-black italic text-white">{title}</h1>
			<p className="text-zinc-400 text-sm">{sub}</p>
			<Link to="/" className="mt-2 h-12 px-6 rounded-2xl bg-zinc-800 border border-zinc-700 text-zinc-100 font-black flex items-center justify-center active:scale-95">
				Volver a la app
			</Link>
		</div>
	);
}
