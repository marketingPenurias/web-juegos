import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("api/analytics", "routes/api.analytics.ts"),
	route("api/track", "routes/api.track.ts"),
	route("api/wallet", "routes/api.wallet.ts"),
	route("api/rewards", "routes/api.rewards.ts"),
	route("api/music", "routes/api.music.ts"),
] satisfies RouteConfig;
