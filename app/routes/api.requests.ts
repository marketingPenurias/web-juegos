import type { Route } from "./+types/api.requests";
import {
	handleRequestsAction,
	handleRequestsLoader,
} from "../lib/requests-handler.server";

export async function loader({ request, context }: Route.LoaderArgs) {
	return handleRequestsLoader(request, context);
}

export async function action({ request, context }: Route.ActionArgs) {
	return handleRequestsAction(request, context);
}
