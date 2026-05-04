import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("api/track", "routes/api.track.ts"),
	route("api/wallet", "routes/api.wallet.ts"),
] satisfies RouteConfig;
