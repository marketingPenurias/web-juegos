import { useEffect } from "react";
import { getAccessToken, getBrowserSupabase } from "./supabase.client";
import { useGameState, type TierRule } from "../store/useGameState";
import { useTenant } from "./tenant";

/**
 * useSession — bootstrap único del bundle real del usuario.
 *
 *   Trae `/api/session` cuando hay JWT y refleja el resultado en el
 *   store global (tokens, lifetime_earned, activeEventId).  Sin esto
 *   el Hub muestra el `tokens: 450` mock y los juegos no saben qué
 *   evento usar para `vote_track`.
 *
 *   Patrón:
 *     - Se monta en LaPochaApp para que viva tanto tiempo como la app.
 *     - Re-sincroniza en SIGNED_IN / SIGNED_OUT.
 *     - Falla en silencio — el usuario ve los datos mock como fallback
 *       (modo demo Supabase off, sin sesión, etc.).
 *
 *   No hace polling.  La revalidación se delega a:
 *     · setBalance() tras purchase / vote / earn.
 *     · re-fetch manual desde Hub (futuro Fase 2).
 */

const ENDPOINT = "/api/session";

type DailyActivity = {
	ruleta_spin: boolean;
	tinder_swipe: boolean;
	tinder_completion: boolean;
	vote_track: boolean;
	jukebox_boost: boolean;
};

type RewardRule = {
	event_code: string;
	amount: number;
	description: string;
};

type SessionPayload = {
	ok: true;
	profile: {
		id: string;
		token_balance: number;
		lifetime_earned: number;
		birth_date?: string | null;
		display_name?: string | null;
		invite_code?: string | null;
	};
	auth_email?: string | null;
	active_event: { id: string; name: string } | null;
	tier: "bronce" | "plata" | "oro" | "platino";
	tiers?: TierRule[];
	daily_activity?: DailyActivity;
	reward_rules?: RewardRule[];
	streak?: number;
	is_new_user?: boolean;
};

export function useSession() {
	const tenant = useTenant();
	const syncSession = useGameState((s) => s.syncSession);
	const logout = useGameState((s) => s.logout);

	useEffect(() => {
		let cancelled = false;

		async function fetchSession() {
			let token: string | null = null;
			try {
				token = await getAccessToken();
			} catch {
				token = null;
			}
			if (!token) return; // demo mode

			try {
				// TODO: CLEANUP AUTH VERIFY DEBUG
				console.log("[SESSION] sending Bearer to /api/session", {
					tenant: tenant.slug,
					tokenPreview: token.slice(0, 12) + "…",
				});
				const res = await fetch(ENDPOINT, {
					method: "GET",
					// `no-store`: evita que iOS Safari sirva un bundle de sesión
					// cacheado (sin evento activo) tras volver a la app (bfcache).
					cache: "no-store",
					headers: {
						Authorization: `Bearer ${token}`,
						"X-Tenant-Slug": tenant.slug,
					},
				});
				const payload = (await res.json().catch(() => ({}))) as
					| SessionPayload
					| { ok: false; error?: string; detail?: string };

				if (!res.ok || (payload as { ok?: boolean }).ok === false) {
					// TODO: CLEANUP SESSION DEBUG
					console.error("[SESSION ERROR] Fallo desde el backend:", {
						status: res.status,
						payload,
					});
					return;
				}

				const data = payload as SessionPayload;
				if (cancelled || !data?.ok) return;
				syncSession({
					userProfileId: data.profile.id,
					tokenBalance: Number(data.profile.token_balance ?? 0),
					lifetimeEarned: Number(data.profile.lifetime_earned ?? 0),
					activeEventId: data.active_event?.id ?? null,
					activeEventName: data.active_event?.name ?? null,
					dailyActivity: data.daily_activity,
					rewardRules: data.reward_rules,
					streak: data.streak,
					isNewUser: data.is_new_user,
					birthDate: data.profile.birth_date ?? null,
					// Tier server-authoritative (get_user_tier + tenant_tier_thresholds):
					// el cliente ya no lo recalcula, sólo lo pinta (V20 · F3).
					tier: data.tier,
					// La escalera de la sala (umbrales, tasa, canjes/noche):
					// configurable por discoteca, así que la manda el servidor.
					tiers: data.tiers,
					// El nombre del ranking. Puede ser null si aún no eligió.
					displayName: data.profile.display_name ?? null,
					inviteCode: data.profile.invite_code ?? null,
				});
			} catch (err) {
				// TODO: CLEANUP SESSION DEBUG
				console.error("[SESSION ERROR] Excepción de red:", err);
			}
		}

		void fetchSession();

		// ── Revalidación: la fiesta activa cambia bajo los pies ───────────
		//
		//   Preguntar una sola vez al arrancar dejaba móviles colgados toda la
		//   noche.  Si el DJ activa la fiesta —o cambia a otra— después de que
		//   alguien haya abierto la app, ese teléfono se queda apuntando a la
		//   fiesta anterior, o a ninguna, y el Jukebox y el Tinder se le
		//   quedan vacíos hasta que cierre y vuelva a abrir.  Pasó el 3 de
		//   septiembre y no hay forma de que el usuario lo entienda.
		//
		//   Dos disparadores, no uno:
		//     · Al volver a la pestaña.  Es el caso real —el móvil se guarda
		//       en el bolsillo y se saca otra vez— y no cuesta nada.
		//     · Un intervalo lento, para el que deja la app abierta mirando.
		//       En segundo plano el navegador lo estrangula, y da igual:
		//       cuando vuelva a primer plano dispara el otro.
		const REVALIDATE_MS = 120_000;

		const revalidate = () => {
			if (document.visibilityState !== "visible") return;
			void fetchSession();
		};

		document.addEventListener("visibilitychange", revalidate);
		const timer = window.setInterval(revalidate, REVALIDATE_MS);

		// Re-sync on auth state changes (login / logout / token refresh).
		const supabase = getBrowserSupabase();
		const sub = supabase?.auth.onAuthStateChange((event) => {
			if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
				void fetchSession();
			}
			if (event === "SIGNED_OUT") {
				logout();
			}
		});

		return () => {
			cancelled = true;
			document.removeEventListener("visibilitychange", revalidate);
			window.clearInterval(timer);
			sub?.data.subscription.unsubscribe();
		};
	}, [tenant.slug, syncSession, logout]);
}
