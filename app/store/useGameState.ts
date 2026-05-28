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

export type Mission = {
	id: string;
	titleKey: string;
	progress: number;
	goal: number;
	reward: number;
	icon: "music" | "swipe" | "share" | "trophy";
};

export type LeaderRow = {
	id: string;
	name: string;
	tokens: number;
	avatar: string;
};

type SongVotes = {
	estopa: number;
};

type Ticket = {
	id: string;
	itemName: string;
	priceTokens: number;
	status: "active" | "redeemed";
	createdAt: number;
};

export type Transaction = {
	id: string;
	labelKey: string;
	delta: number;
	createdAt: number;
};

export type SongRequest = {
	id: string;
	title: string;
	artist: string;
	cover: string;
	boosted: boolean;
};

export type UserProfile = {
	handle: string;
	email: string;
	level: number;
	levelProgress: number;
};

const INITIAL_TRANSACTIONS: Transaction[] = [
	{ id: "tx_1", labelKey: "history.tx_signup", delta: 450, createdAt: Date.now() - 1000 * 60 * 60 * 24 },
	{ id: "tx_2", labelKey: "history.tx_streak", delta: 30, createdAt: Date.now() - 1000 * 60 * 60 * 6 },
	{ id: "tx_3", labelKey: "history.tx_invite", delta: 25, createdAt: Date.now() - 1000 * 60 * 60 * 2 },
];

const INITIAL_MISSIONS: Mission[] = [
	{ id: "tinder-10", titleKey: "hub.mission_tinder", progress: 4, goal: 10, reward: 20, icon: "swipe" },
	{ id: "vote-3", titleKey: "hub.mission_vote", progress: 1, goal: 3, reward: 15, icon: "music" },
];

const INITIAL_LEADERBOARD: LeaderRow[] = [
	{ id: "1", name: "Carla R.", tokens: 1820, avatar: "👑" },
	{ id: "2", name: "Marcos D.", tokens: 1640, avatar: "🎧" },
	{ id: "3", name: "Tú", tokens: 1390, avatar: "⚡" },
];

const INITIAL_SONG_REQUESTS: SongRequest[] = [
	{ id: "s_1", title: "Despacito", artist: "Luis Fonsi", cover: "🎵", boosted: false },
	{ id: "s_2", title: "Bombay", artist: "El Arrebato", cover: "🌅", boosted: false },
	{ id: "s_3", title: "Tu Cara Bonita", artist: "Estopa", cover: "🎸", boosted: false },
	{ id: "s_4", title: "Zapatillas", artist: "El Canto del Loco", cover: "👟", boosted: false },
	{ id: "s_5", title: "Insurrección", artist: "El Último de la Fila", cover: "🔥", boosted: false },
];

// Profile real ahora vive en `useAuthUser` (Supabase Auth) + tier helpers.
// Mantenemos `profile` en el store sólo como pieza vestigial para no
// romper el contrato de Zustand persist v1 al migrar — la pantalla
// Profile.tsx ya NO lo lee.  Cuando incrementemos a v3 del schema
// persist lo retiramos del store entero.
const INITIAL_PROFILE: UserProfile = {
	handle: "",
	email: "",
	level: 1,
	levelProgress: 0,
};

export type ActiveRedemption = {
	rewardId: string;
	productName: string;
	priceEur: number; // 0 = GRATIS
	expiresAt: string; // ISO timestamp
};

type GameState = {
	tokens: number;
	streak: number;
	currentScreen: Screen;
	songVotes: SongVotes;
	friends: string[];
	missions: Mission[];
	leaderboard: LeaderRow[];
	activeTicket: Ticket | null;
	transactions: Transaction[];
	songRequests: SongRequest[];
	profile: UserProfile;

	// ── Datos reales servidos por /api/session ──────────────────────────
	// Mientras estos sigan en null, la UI debe seguir tolerando el
	// modo demo (Onboarding → Hub sin Supabase configurado).
	userProfileId: string | null;
	lifetimeEarned: number;
	activeEventId: string | null;
	activeEventName: string | null;

	// ── Estado de canje activo (pantalla camarero) ──────────────────────
	activeRedemption: ActiveRedemption | null;

	setScreen: (s: Screen) => void;
	addTokens: (n: number, labelKey?: string) => void;
	spendTokens: (n: number, labelKey?: string) => boolean;
	voteSongEstopa: (delta: number) => void;
	driftSongVotes: () => void;
	completeMission: (id: string) => void;
	setFriends: (friends: string[]) => void;
	createTicket: (itemName: string, priceTokens: number) => void;
	redeemTicket: () => void;
	clearTicket: () => void;
	boostSongRequest: (id: string) => boolean;
	logout: () => void;

	// ── Acciones de sync con backend ───────────────────────────────────
	syncSession: (s: {
		userProfileId: string;
		tokenBalance: number;
		lifetimeEarned: number;
		activeEventId: string | null;
		activeEventName: string | null;
	}) => void;
	setBalance: (tokenBalance: number, lifetimeEarned?: number) => void;
	openRedemption: (r: ActiveRedemption) => void;
	closeRedemption: () => void;
};

const recordTransaction = (
	prev: Transaction[],
	delta: number,
	labelKey?: string,
): Transaction[] => {
	if (!labelKey) return prev;
	const next: Transaction = {
		id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		labelKey,
		delta,
		createdAt: Date.now(),
	};
	return [next, ...prev].slice(0, 30);
};

export const useGameState = create<GameState>()(
	persist(
		(set, get) => ({
			tokens: 450,
			streak: 3,
			currentScreen: "onboarding",
			songVotes: { estopa: 58 },
			friends: ["Andrea", "Mario", "Lucía", "Carlos"],
			missions: INITIAL_MISSIONS,
			leaderboard: INITIAL_LEADERBOARD,
			activeTicket: null,
			transactions: INITIAL_TRANSACTIONS,
			songRequests: INITIAL_SONG_REQUESTS,
			profile: INITIAL_PROFILE,

			userProfileId: null,
			lifetimeEarned: 0,
			activeEventId: null,
			activeEventName: null,
			activeRedemption: null,

			setScreen: (s) => set({ currentScreen: s }),

			addTokens: (n, labelKey) =>
				set((state) => ({
					tokens: Math.max(0, state.tokens + n),
					transactions: recordTransaction(state.transactions, n, labelKey),
				})),

			spendTokens: (n, labelKey) => {
				const { tokens, transactions } = get();
				if (tokens < n) return false;
				set({
					tokens: Math.max(0, tokens - n),
					transactions: recordTransaction(transactions, -n, labelKey),
				});
				return true;
			},

			voteSongEstopa: (delta) =>
				set((state) => {
					const next = Math.max(1, Math.min(99, state.songVotes.estopa + delta));
					return { songVotes: { estopa: next } };
				}),

			driftSongVotes: () =>
				set((state) => {
					const fluctuate = Math.random() > 0.5 ? 1 : -1;
					const next = state.songVotes.estopa + fluctuate;
					if (next > 66 || next < 58) return state;
					return { songVotes: { estopa: next } };
				}),

			completeMission: (id) =>
				set((state) => {
					const m = state.missions.find((x) => x.id === id);
					if (!m) return state;
					return {
						missions: state.missions.filter((x) => x.id !== id),
						tokens: Math.max(0, state.tokens + m.reward),
						transactions: recordTransaction(
							state.transactions,
							m.reward,
							"history.tx_mission",
						),
					};
				}),

			setFriends: (friends) => set({ friends }),

			createTicket: (itemName, priceTokens) =>
				set({
					activeTicket: {
						id: `t_${Date.now()}`,
						itemName,
						priceTokens,
						status: "active",
						createdAt: Date.now(),
					},
				}),

			redeemTicket: () =>
				set((state) =>
					state.activeTicket
						? { activeTicket: { ...state.activeTicket, status: "redeemed" } }
						: state,
				),

			clearTicket: () => set({ activeTicket: null }),

			boostSongRequest: (id) => {
				const { tokens, songRequests, transactions } = get();
				if (tokens < 50) return false;
				const target = songRequests.find((s) => s.id === id);
				if (!target || target.boosted) return false;
				const reordered = [
					{ ...target, boosted: true },
					...songRequests.filter((s) => s.id !== id),
				];
				set({
					tokens: tokens - 50,
					songRequests: reordered,
					transactions: recordTransaction(
						transactions,
						-50,
						"history.tx_jukebox_boost",
					),
				});
				return true;
			},

			logout: () =>
				set({
					currentScreen: "onboarding",
					tokens: 450,
					activeTicket: null,
					transactions: INITIAL_TRANSACTIONS,
					songRequests: INITIAL_SONG_REQUESTS,
					userProfileId: null,
					lifetimeEarned: 0,
					activeEventId: null,
					activeEventName: null,
					activeRedemption: null,
				}),

			// ── Sync server ────────────────────────────────────────────
			syncSession: ({
				userProfileId,
				tokenBalance,
				lifetimeEarned,
				activeEventId,
				activeEventName,
			}) =>
				set({
					userProfileId,
					tokens: Math.max(0, tokenBalance),
					lifetimeEarned: Math.max(0, lifetimeEarned),
					activeEventId,
					activeEventName,
				}),

			setBalance: (tokenBalance, lifetimeEarned) =>
				set((state) => ({
					tokens: Math.max(0, tokenBalance),
					lifetimeEarned:
						typeof lifetimeEarned === "number"
							? Math.max(state.lifetimeEarned, lifetimeEarned)
							: state.lifetimeEarned,
				})),

			openRedemption: (r) => set({ activeRedemption: r }),
			closeRedemption: () => set({ activeRedemption: null }),
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
				songVotes: state.songVotes,
				friends: state.friends,
				missions: state.missions,
				activeTicket: state.activeTicket,
				transactions: state.transactions,
				songRequests: state.songRequests,
				// `userProfileId`, `lifetimeEarned`, `activeEventId`,
				// `activeRedemption` se persisten para sobrevivir al reload
				// (la noche del piloto, no queremos que un refresh accidental
				// pierda el reward que el usuario acaba de pagar).
				userProfileId: state.userProfileId,
				lifetimeEarned: state.lifetimeEarned,
				activeEventId: state.activeEventId,
				activeEventName: state.activeEventName,
				activeRedemption: state.activeRedemption,
			}),
			version: 2,
		},
	),
);
