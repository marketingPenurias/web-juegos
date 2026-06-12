import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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

	// ── Estado de canje activo (pantalla camarero) ──────────────────────
	activeRedemption: ActiveRedemption | null;

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
	}) => void;
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
			activeRedemption: null,
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
			}) =>
				set((state) => ({
					userProfileId,
					tokens: Math.max(0, tokenBalance),
					lifetimeEarned: Math.max(0, lifetimeEarned),
					activeEventId,
					activeEventName,
					birthDate: birthDate !== undefined ? birthDate : state.birthDate,
					dailyActivity: dailyActivity ?? state.dailyActivity,
					rewardRules: rewardRules ?? state.rewardRules,
					streak: typeof streak === "number" ? streak : state.streak,
					// Sólo marcamos new-user si el server lo dice Y aún no se vio
					// la bienvenida (one-shot, sobrevive a recargas vía persist).
					isNewUser: isNewUser === true && !state.welcomeSeen,
				})),

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
