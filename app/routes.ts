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
	route("api/checkin", "routes/api.checkin.ts"),
	route("api/admin", "routes/api.admin.ts"),
	route("api/tv", "routes/api.tv.ts"),
	route("auth/callback", "routes/auth.callback.tsx"),
	route("checkin", "routes/checkin.tsx"),
	route("admin", "routes/admin.tsx"),
	route("tv/music", "routes/tv.music.tsx"),
	route("tv/dashboard", "routes/tv.dashboard.tsx"),
	route("legal", "routes/legal.tsx"),
] satisfies RouteConfig;
