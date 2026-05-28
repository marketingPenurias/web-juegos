import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import type { Route } from "./+types/auth.callback";
import { getBrowserSupabase } from "../lib/supabase.client";

/**
 * /auth/callback — handshake explícito PKCE.
 *
 *   Google → Supabase → este endpoint con `?code=…&state=…`.
 *   Pasos:
 *     1. Lee `code` del query string.
 *     2. Llama `supabase.auth.exchangeCodeForSession(code)`.
 *        Supabase recupera el `code_verifier` del cookieStorage
 *        (sobrevive el redirect porque vive en una cookie
 *        SameSite=Lax con domain `.nightgraph.io`).
 *     3. Al éxito → redirige a `/`.  El listener de Onboarding
 *        captura el SIGNED_IN y pone la pantalla en "hub";
 *        `useSession()` de LaPochaApp hace el bootstrap.
 *
 *   Por qué no `detectSessionInUrl: true`:
 *     Si la lib auto-procesa el code en CADA navegación, consume el
 *     `code_verifier` antes de que este callback lo necesite y termina
 *     dejando al usuario sin sesión.  Por eso forzamos `false` en el
 *     cliente y manejamos el exchange aquí, en una sola ruta
 *     conocida (la misma que damos de alta en Supabase OAuth →
 *     "Redirect URLs").
 */

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Conectando… · Nightgraph" },
		{ name: "robots", content: "noindex,nofollow" },
	];
}

export default function AuthCallback() {
	// TODO: CLEANUP DEBUG
	console.log("[AUTH DEBUG] auth.callback render", {
		href: typeof window !== "undefined" ? window.location.href : "(ssr)",
		search:
			typeof window !== "undefined" ? window.location.search : "(ssr)",
	});

	const navigate = useNavigate();
	const [params] = useSearchParams();
	const [error, setError] = useState<string | null>(null);
	const exchangedRef = useRef(false);

	useEffect(() => {
		// TODO: CLEANUP DEBUG
		console.log("[AUTH DEBUG] auth.callback useEffect fired", {
			alreadyExchanged: exchangedRef.current,
		});

		// React Strict Mode dispara useEffect dos veces en dev.  Sin esta
		// guarda, el segundo intento de `exchangeCodeForSession` falla con
		// "code verifier mismatch" porque el primero ya consumió el code.
		if (exchangedRef.current) return;
		exchangedRef.current = true;

		const supabase = getBrowserSupabase();
		// TODO: CLEANUP DEBUG
		console.log("[AUTH DEBUG] supabase client", {
			hasClient: !!supabase,
		});
		if (!supabase) {
			// TODO: CLEANUP DEBUG
			console.error("[AUTH DEBUG] no supabase client → bouncing /");
			navigate("/", { replace: true });
			return;
		}

		// Google puede devolver error directo (consentimiento denegado,
		// dominio bloqueado…) — los propagamos a UI en lugar de fallar
		// silencioso.
		const oauthError =
			params.get("error_description") || params.get("error");
		if (oauthError) {
			// TODO: CLEANUP DEBUG
			console.error("[AUTH DEBUG] oauth error from provider", oauthError);
			setError(oauthError);
			return;
		}

		const code = params.get("code");
		// TODO: CLEANUP DEBUG
		console.log("[AUTH DEBUG] code received", {
			present: !!code,
			length: code?.length ?? 0,
			preview: code ? `${code.slice(0, 8)}…` : null,
		});
		if (!code) {
			// Sin code y sin error: el usuario aterrizó aquí sin pasar por
			// Google (refresh manual, share del link).  Vuelve al inicio.
			// TODO: CLEANUP DEBUG
			console.warn("[AUTH DEBUG] no code in URL → bouncing /");
			navigate("/", { replace: true });
			return;
		}

		void (async () => {
			// TODO: CLEANUP DEBUG
			console.log("[AUTH DEBUG] calling exchangeCodeForSession…");
			const exchangeResult =
				await supabase.auth.exchangeCodeForSession(code);
			// TODO: CLEANUP DEBUG
			console.log("[AUTH DEBUG] exchange result", {
				hasError: !!exchangeResult.error,
				errorMessage: exchangeResult.error?.message,
				hasSession: !!exchangeResult.data?.session,
				userId: exchangeResult.data?.session?.user?.id,
				email: exchangeResult.data?.session?.user?.email,
				accessTokenPresent:
					!!exchangeResult.data?.session?.access_token,
				expiresAt: exchangeResult.data?.session?.expires_at,
			});

			if (exchangeResult.error) {
				// TODO: CLEANUP DEBUG
				console.error(
					"[AUTH DEBUG] exchange failed",
					exchangeResult.error,
				);
				setError(exchangeResult.error.message);
				return;
			}

			// TODO: CLEANUP DEBUG
			// Pausa intencionada de 500 ms para garantizar que cookieStorage
			// termina de escribir antes de la siguiente lectura en `/`.
			// Si esto soluciona el bug, confirma que hay un race entre la
			// escritura asincrónica de la cookie y el getSession() inmediato
			// del Onboarding.
			console.log(
				"[AUTH DEBUG] exchange OK · sleeping 500ms before navigate",
			);
			await new Promise((resolve) => setTimeout(resolve, 500));

			// TODO: CLEANUP DEBUG
			// Releemos la sesión justo antes de navegar para confirmar que
			// persistió en cookieStorage.
			const { data: postSession } = await supabase.auth.getSession();
			// TODO: CLEANUP DEBUG
			console.log("[AUTH DEBUG] post-sleep getSession", {
				hasSession: !!postSession.session,
				userId: postSession.session?.user?.id,
			});

			// TODO: CLEANUP DEBUG
			console.log("[AUTH DEBUG] navigating to /");
			navigate("/", { replace: true });
		})();
	}, [navigate, params]);

	return (
		<div className="min-h-dvh w-full bg-black text-white flex items-center justify-center px-6">
			<div className="text-center max-w-sm">
				{error ? (
					<>
						<h1 className="text-2xl font-black italic tracking-tight mb-3">
							No pudimos completar tu inicio de sesión
						</h1>
						<p className="text-sm text-zinc-400 mb-6 wrap-break-word">
							{error}
						</p>
						<button
							type="button"
							onClick={() => navigate("/", { replace: true })}
							className="h-11 px-5 rounded-2xl bg-white text-black font-black tracking-tight active:scale-95 transition-transform focus-visible:ring-2 focus-visible:ring-cyan-400"
						>
							Volver al inicio
						</button>
					</>
				) : (
					<>
						<Loader2
							className="w-10 h-10 text-cyan-400 animate-spin mx-auto mb-4"
							aria-hidden="true"
						/>
						<p className="text-sm text-zinc-300 font-bold tracking-wide">
							Conectando con Google…
						</p>
						<p className="text-[11px] text-zinc-500 mt-2">
							Esto solo tarda un segundo.
						</p>
					</>
				)}
			</div>
		</div>
	);
}
