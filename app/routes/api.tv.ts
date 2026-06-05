import type { Route } from "./+types/api.tv";
import { corsHeaders, preflight } from "../lib/api.server";
import { handleTvAction } from "../lib/tv-handler.server";

export async function action({ request, context }: Route.ActionArgs) {
	return handleTvAction(request, context);
}

export function loader({ request }: Route.LoaderArgs) {
	const cors = preflight(request);
	if (cors) return cors;
	return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
		status: 405,
		headers: {
			"Content-Type": "application/json",
			...corsHeaders(request.headers.get("origin")),
		},
	});
}
