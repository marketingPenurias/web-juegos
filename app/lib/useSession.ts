import { useEffect } from "react";
import { getAccessToken, getBrowserSupabase } from "./supabase.client";
import { useGameState } from "../store/useGameState";
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
	};
	auth_email?: string | null;
	active_event: { id: string; name: string } | null;
	tier: "bronce" | "plata" | "oro" | "platino";
	daily_activity?: DailyActivity;
	reward_rules?: RewardRule[];
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
				const res = await fetch(ENDPOINT, {
					method: "GET",
					headers: {
						Authorization: `Bearer ${token}`,
						"X-Tenant-Slug": tenant.slug,
					},
				});
				if (!res.ok) return;
				const data = (await res.json()) as SessionPayload;
				if (cancelled || !data?.ok) return;
				syncSession({
					userProfileId: data.profile.id,
					tokenBalance: Number(data.profile.token_balance ?? 0),
					lifetimeEarned: Number(data.profile.lifetime_earned ?? 0),
					activeEventId: data.active_event?.id ?? null,
					activeEventName: data.active_event?.name ?? null,
					dailyActivity: data.daily_activity,
					rewardRules: data.reward_rules,
				});
			} catch {
				// Network errors are non-fatal — UI keeps the persisted mock.
			}
		}

		void fetchSession();

		// Re-sync on auth state changes (login / logout / token refresh).
		const supabase = getBrowserSupabase();
		if (!supabase) return () => undefined;
		const { data } = supabase.auth.onAuthStateChange((event) => {
			if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
				void fetchSession();
			}
			if (event === "SIGNED_OUT") {
				logout();
			}
		});

		return () => {
			cancelled = true;
			data.subscription.unsubscribe();
		};
	}, [tenant.slug, syncSession, logout]);
}
