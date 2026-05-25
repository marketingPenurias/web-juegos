import type { Route } from "./+types/api.music";
import {
	handleMusicAction,
	handleMusicLoader,
} from "../lib/music-handler.server";

export async function loader({ request, context }: Route.LoaderArgs) {
	return handleMusicLoader(request, context);
}

export async function action({ request, context }: Route.ActionArgs) {
	return handleMusicAction(request, context);
}
