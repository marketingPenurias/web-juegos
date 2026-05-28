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
 *        Supabase recupera el `code_verifier` del localStorage
 *        (sobrevive el redirect porque la SPA persiste el flag PKCE
 *        antes de saltar a Google).
 *     3. Forzamos `setSession()` con el payload del exchange para
 *        garantizar que el adaptador de storage escribe la sesión
 *        antes de navegar — fix del bug "exchange OK pero
 *        getSession() devuelve null 500 ms después".
 *     4. Redirige a `/`.  `useSession()` y el listener del
 *        Onboarding ven la sesión instantáneamente.
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
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const [error, setError] = useState<string | null>(null);
	const exchangedRef = useRef(false);

	useEffect(() => {
		// React Strict Mode dispara useEffect dos veces en dev.  Sin esta
		// guarda, el segundo intento de `exchangeCodeForSession` falla con
		// "code verifier mismatch" porque el primero ya consumió el code.
		if (exchangedRef.current) return;
		exchangedRef.current = true;

		const supabase = getBrowserSupabase();
		if (!supabase) {
			navigate("/", { replace: true });
			return;
		}

		// Google puede devolver error directo (consentimiento denegado,
		// dominio bloqueado…) — los propagamos a UI en lugar de fallar
		// silencioso.
		const oauthError =
			params.get("error_description") || params.get("error");
		if (oauthError) {
			setError(oauthError);
			return;
		}

		const code = params.get("code");
		if (!code) {
			// Sin code y sin error: el usuario aterrizó aquí sin pasar por
			// Google (refresh manual, share del link).  Vuelve al inicio.
			navigate("/", { replace: true });
			return;
		}

		void (async () => {
			const { data, error: exchangeError } =
				await supabase.auth.exchangeCodeForSession(code);
			if (exchangeError) {
				setError(exchangeError.message);
				return;
			}

			// Refuerzo de persistencia: aunque `exchangeCodeForSession`
			// debería escribir la sesión en storage, en producción CF +
			// React 19 hemos visto el storage "evaporarse" entre el
			// exchange y el siguiente `getSession()`.  Re-inyectamos la
			// sesión a mano para garantizar la escritura.
			if (data.session) {
				await supabase.auth.setSession({
					access_token: data.session.access_token,
					refresh_token: data.session.refresh_token,
				});
			}

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
