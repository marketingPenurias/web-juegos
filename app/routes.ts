import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("api/analytics", "routes/api.analytics.ts"),
	route("api/track", "routes/api.track.ts"),
	route("api/wallet", "routes/api.wallet.ts"),
	route("api/rewards", "routes/api.rewards.ts"),
	route("api/music", "routes/api.music.ts"),
	route("api/catalog", "routes/api.catalog.ts"),
	route("api/session", "routes/api.session.ts"),
	route("api/history", "routes/api.history.ts"),
	route("api/auth-sync", "routes/api.auth-sync.ts"),
	// TODO: CLEANUP DEBUG — verificado: `auth/callback` no colisiona con
	// ninguna otra entrada (ni con la convención de archivos de RR7
	// porque usamos `route(...)` explícito).  Path final: /auth/callback.
	route("auth/callback", "routes/auth.callback.tsx"),
	route("tv/music", "routes/tv.music.tsx"),
	route("legal", "routes/legal.tsx"),
] satisfies RouteConfig;
