import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { TierCode } from "../lib/tier";

export type Screen =
	| "onboarding"
	| "hub"
	| "live"
	| "menu"
	| "tinder"
	| "ruleta"
	| "ticket"
	| "jukebox"
	| "profile"
	| "dj";

export type ActiveRedemption = {
	rewardId: string;
	productName: string;
	priceEur: number; // 0 = GRATIS
	expiresAt: string; // ISO timestamp
};

export type DailyActivity = {
	ruleta_spin: boolean;
	tinder_swipe: boolean;
	tinder_completion: boolean;
	vote_track: boolean;
	jukebox_boost: boolean;
};

/**
 * Un nivel de la escalera de fidelidad, tal y como lo configura CADA sala.
 * Llega en `/api/session`; el cliente no calcula umbrales ni precios.
 */
export type TierRule = {
	tier_code: string;
	display_name: string;
	min_lifetime: number;
	/** Tokens por cada € de descuento en este nivel (menos = mejor). */
	tokens_per_euro: number | null;
	max_redemptions_per_night: number | null;
	badge_emoji: string | null;
	sort_order: number;
};

export type RewardRule = {
	event_code: string;
	amount: number;
	description: string;
};

// Resultado de un check-in procesado (incl. el "flujo frío": QR escaneado
// sin sesión → se procesa tras el login).  Lo muestra `CheckinResultModal`.
export type CheckinResult = {
	ok: boolean;
	qrLabel?: string;
	reward?: number;
	streak?: number;
	milestoneWeek?: number;
	milestoneAmount?: number;
	/**
	 * A qué equivalen sus tokens ahora mismo.  `affordable` = lo mejor que ya
	 * puede pedir; `next` = lo más cerca que le queda y cuánto le falta.  Lo
	 * calcula el servidor con las MISMAS reglas del menú, para no prometer algo
	 * que luego el menú le niegue.
	 */
	hint?: {
		balance: number;
		affordable: { name: string; promo_price_eur: number; cost_tokens: number } | null;
		next: { name: string; promo_price_eur: number; cost_tokens: number; missing: number } | null;
		redemptions_left: number | null;
	} | null;
	error?: string;
};

const EMPTY_DAILY_ACTIVITY: DailyActivity = {
	ruleta_spin: false,
	tinder_swipe: false,
	tinder_completion: false,
	vote_track: false,
	jukebox_boost: false,
};

/**
 * Store global del cliente — versión post Clean House (V16).
 *
 *   Tras la Operación Wiring se retiró TODO el estado mock de la V1 que ya
 *   no alimentaba UI o fue conectado a Supabase:
 *     · songVotes / songRequests / boostSongRequest (jukebox real → event_tracks)
 *     · transactions (historial real → /api/history vía useHistory)
 *     · missions / completeMission (misiones reales → daily_activity)
 *     · leaderboard (ranking real → /api/leaderboard vía useLeaderboard)
 *     · activeTicket / createTicket (tickets reales → user_rewards)
 *     · profile / spendTokens (vestigiales sin lectores)
 *
 *   Lo que queda es estado real (server-truth) + UI puramente local
 *   (currentScreen, friends de la ruleta, flags one-shot).
 */
type GameState = {
	tokens: number;
	streak: number;
	currentScreen: Screen;
	// Nombres de jugadores de la Ruleta de Rondas (UI local, no server).
	friends: string[];

	// ── Datos reales servidos por /api/session ──────────────────────────
	userProfileId: string | null;
	lifetimeEarned: number;
	activeEventId: string | null;
	activeEventName: string | null;
	// Fecha de nacimiento (V1.7).  null = aún no capturada → gate de onboarding.
	birthDate: string | null;
	// Tier de fidelidad calculado por el SERVIDOR (`get_user_tier`, umbrales de
	// `tenant_tier_thresholds`).  Se guarda tal cual para no recalcularlo en
	// cliente con constantes que podrían desincronizarse (V20 · F3).
	tier: TierCode;
	// La escalera de niveles de ESTA sala (umbrales, tasa tk/€, canjes por
	// noche).  Es configurable por discoteca, así que llega del servidor en vez
	// de estar cableada en el cliente.  Vacío = aún no ha respondido la sesión.
	tiers: TierRule[];
	// Nombre elegido por la persona: es el que se ve en el ranking y en la TV.
	// null = todavía no tiene → el ranking mostrará "Jefe #N" y conviene
	// invitarle a elegir uno.
	displayName: string | null;
	// Código para invitar. Se comparte como enlace `?ref=CODIGO`.
	inviteCode: string | null;
	// ¿Se ha resuelto ya /api/session al menos una vez?  El gate de cumpleaños
	// SÓLO puede mostrarse cuando esto es true — así no parpadea en cada
	// recarga mientras `birthDate` (no persistido) aún no ha llegado del server.
	sessionLoaded: boolean;

	// ── Estado de canje activo (pantalla camarero) ──────────────────────
	activeRedemption: ActiveRedemption | null;

	// ¿Hay una batalla de temas EN VIVO ahora mismo?  Lo mantiene
	// `useActiveBattle` (un único canal Realtime + fallback) y lo consumen el
	// BottomNav y el lanzador de juegos para el aviso flotante.  Efímero: no se
	// persiste, siempre se recalcula al arrancar.
	battleActive: boolean;

	// ── Misiones/economía dinámica (servidor authoritative) ─────────────
	dailyActivity: DailyActivity;
	rewardRules: RewardRule[];

	// ── Onboarding / fidelidad ──────────────────────────────────────────
	isNewUser: boolean;
	welcomeSeen: boolean;
	redeemTutorialSeen: boolean;
	checkinResult: CheckinResult | null;

	setScreen: (s: Screen) => void;
	// `labelKey` se mantiene por compatibilidad con los call-sites optimistas;
	// el historial real vive en wallet_ledger (no se guarda en cliente).
	addTokens: (n: number, labelKey?: string) => void;
	setFriends: (friends: string[]) => void;
	setBirthDate: (d: string) => void;
	setBattleActive: (active: boolean) => void;
	logout: () => void;

	// ── Acciones de sync con backend ───────────────────────────────────
	syncSession: (s: {
		userProfileId: string;
		tokenBalance: number;
		lifetimeEarned: number;
		activeEventId: string | null;
		activeEventName: string | null;
		dailyActivity?: DailyActivity;
		rewardRules?: RewardRule[];
		streak?: number;
		isNewUser?: boolean;
		birthDate?: string | null;
		tier?: TierCode;
		tiers?: TierRule[];
		displayName?: string | null;
		inviteCode?: string | null;
	}) => void;
	setDisplayName: (name: string) => void;
	setBalance: (tokenBalance: number, lifetimeEarned?: number) => void;
	setStreak: (streak: number) => void;
	markDaily: (key: keyof DailyActivity) => void;
	dismissWelcome: () => void;
	markRedeemTutorialSeen: () => void;
	setCheckinResult: (r: CheckinResult | null) => void;
	openRedemption: (r: ActiveRedemption) => void;
	closeRedemption: () => void;
	rewardAmount: (code: string, fallback?: number) => number;
};

export const useGameState = create<GameState>()(
	persist(
		(set, get) => ({
			tokens: 450,
			streak: 3,
			currentScreen: "onboarding",
			friends: ["Andrea", "Mario", "Lucía", "Carlos"],

			userProfileId: null,
			lifetimeEarned: 0,
			activeEventId: null,
			activeEventName: null,
			birthDate: null,
			tier: "bronce",
			tiers: [],
			displayName: null,
			inviteCode: null,
			sessionLoaded: false,
			activeRedemption: null,
			battleActive: false,
			dailyActivity: { ...EMPTY_DAILY_ACTIVITY },
			rewardRules: [],
			isNewUser: false,
			welcomeSeen: false,
			redeemTutorialSeen: false,
			checkinResult: null,

			setScreen: (s) => set({ currentScreen: s }),

			addTokens: (n) =>
				set((state) => ({ tokens: Math.max(0, state.tokens + n) })),

			setFriends: (friends) => set({ friends }),

			setBirthDate: (d) => set({ birthDate: d }),

			setBattleActive: (active) =>
				// Guarda sólo si cambia: evita re-renderizar el nav en cada tick del
				// poll de la batalla.
				set((state) => (state.battleActive === active ? state : { battleActive: active })),

			logout: () =>
				set({
					currentScreen: "onboarding",
					tokens: 450,
					activeRedemption: null,
					userProfileId: null,
					lifetimeEarned: 0,
					activeEventId: null,
					activeEventName: null,
					birthDate: null,
					tier: "bronce",
					tiers: [],
					displayName: null,
					inviteCode: null,
					// Al desloguear, la próxima sesión debe re-resolverse antes de
					// poder mostrar el gate de cumpleaños.
					sessionLoaded: false,
					battleActive: false,
					dailyActivity: { ...EMPTY_DAILY_ACTIVITY },
					rewardRules: [],
					// Reset para que el SIGUIENTE usuario en este móvil (otro JIT)
					// sí vea su propia bienvenida.
					isNewUser: false,
					welcomeSeen: false,
					checkinResult: null,
				}),

			// ── Sync server ────────────────────────────────────────────
			syncSession: ({
				userProfileId,
				tokenBalance,
				lifetimeEarned,
				activeEventId,
				activeEventName,
				dailyActivity,
				rewardRules,
				streak,
				isNewUser,
				birthDate,
				tier,
				tiers,
				displayName,
				inviteCode,
			}) =>
				set((state) => ({
					userProfileId,
					tokens: Math.max(0, tokenBalance),
					lifetimeEarned: Math.max(0, lifetimeEarned),
					activeEventId,
					activeEventName,
					// Sesión resuelta desde el server → el gate de cumpleaños ya
					// puede decidir con datos reales (evita el parpadeo al recargar).
					sessionLoaded: true,
					birthDate: birthDate !== undefined ? birthDate : state.birthDate,
					tier: tier ?? state.tier,
					tiers: tiers && tiers.length > 0 ? tiers : state.tiers,
					displayName:
						displayName !== undefined ? displayName : state.displayName,
					inviteCode: inviteCode ?? state.inviteCode,
					dailyActivity: dailyActivity ?? state.dailyActivity,
					rewardRules: rewardRules ?? state.rewardRules,
					streak: typeof streak === "number" ? streak : state.streak,
					// Sólo marcamos new-user si el server lo dice Y aún no se vio
					// la bienvenida (one-shot, sobrevive a recargas vía persist).
					isNewUser: isNewUser === true && !state.welcomeSeen,
				})),

			setDisplayName: (name) => set({ displayName: name }),

			setBalance: (tokenBalance, lifetimeEarned) =>
				set((state) => ({
					tokens: Math.max(0, tokenBalance),
					lifetimeEarned:
						typeof lifetimeEarned === "number"
							? Math.max(state.lifetimeEarned, lifetimeEarned)
							: state.lifetimeEarned,
				})),

			setStreak: (streak) => set({ streak: Math.max(0, streak) }),

			markDaily: (key) =>
				set((state) => {
					if (state.dailyActivity[key]) return state;
					return {
						dailyActivity: { ...state.dailyActivity, [key]: true },
					};
				}),

			dismissWelcome: () => set({ isNewUser: false, welcomeSeen: true }),

			markRedeemTutorialSeen: () => set({ redeemTutorialSeen: true }),

			setCheckinResult: (r) => set({ checkinResult: r }),

			openRedemption: (r) => set({ activeRedemption: r }),
			closeRedemption: () => set({ activeRedemption: null }),

			rewardAmount: (code, fallback = 0) => {
				const rule = get().rewardRules.find((r) => r.event_code === code);
				return rule ? rule.amount : fallback;
			},
		}),
		{
			name: "lapocha-state",
			storage: createJSONStorage(() =>
				typeof window !== "undefined" ? sessionStorage : (undefined as unknown as Storage),
			),
			partialize: (state) => ({
				tokens: state.tokens,
				streak: state.streak,
				currentScreen: state.currentScreen,
				friends: state.friends,
				// `userProfileId`, `lifetimeEarned`, `activeEventId`,
				// `activeRedemption` se persisten para sobrevivir al reload
				// (la noche del piloto, no queremos que un refresh accidental
				// pierda el reward que el usuario acaba de pagar).
				userProfileId: state.userProfileId,
				lifetimeEarned: state.lifetimeEarned,
				activeEventId: state.activeEventId,
				activeEventName: state.activeEventName,
				activeRedemption: state.activeRedemption,
				// One-shot bienvenida: si ya se vio, no reaparece tras recargar.
				welcomeSeen: state.welcomeSeen,
				redeemTutorialSeen: state.redeemTutorialSeen,
				// dailyActivity y rewardRules NO se persisten — son
				// always-fresh-from-server.
			}),
			// v4: Clean House — se retiró el estado mock de la V1.  Sin migrate,
			// un schema viejo en sessionStorage se descarta y arranca limpio.
			version: 4,
		},
	),
);
