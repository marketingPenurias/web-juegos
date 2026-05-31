import type { Route } from "./+types/api.admin";
import { corsHeaders, preflight } from "../lib/api.server";
import { handleAdminAction } from "../lib/admin-handler.server";

export async function action({ request, context }: Route.ActionArgs) {
	return handleAdminAction(request, context);
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
