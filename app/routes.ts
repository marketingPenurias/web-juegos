import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("api/track", "routes/api.track.ts"),
] satisfies RouteConfig;
