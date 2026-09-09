import type { Route } from "./+types/api.requests";
import { handleRequestsAction } from "../lib/requests-handler.server";

export async function action({ request, context }: Route.ActionArgs) {
	return handleRequestsAction(request, context);
}
