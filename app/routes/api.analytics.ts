import type { Route } from "./+types/api.analytics";
import {
	analyticsLoader,
	handleAnalyticsAction,
} from "../lib/analytics-handler.server";

/**
 * POST /api/analytics — canonical event ingestion endpoint.
 *
 * Single source of truth implemented in lib/analytics-handler.server.ts
 * so the legacy /api/track route can reuse the exact same handler.
 */
export async function action({ request, context }: Route.ActionArgs) {
	return handleAnalyticsAction(request, context);
}

export function loader({ request }: Route.LoaderArgs) {
	return analyticsLoader(request);
}
