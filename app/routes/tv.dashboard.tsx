import type { Route } from "./+types/tv.dashboard";
import { useLoaderData } from "react-router";
import { loadTvDashboard } from "../lib/tv-dashboard-handler.server";
import { Jumbotron } from "../components/Jumbotron";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Nightgraph TV · Jumbotron" },
		{ name: "robots", content: "noindex" },
	];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	return loadTvDashboard(request, context);
}

export default function TvDashboard() {
	const data = useLoaderData<typeof loader>();
	const initialBattle = data.battle
		? { id: data.battle.id, endsAt: data.battle.ends_at, a: data.battle.a, b: data.battle.b }
		: null;

	return (
		<Jumbotron
			tenantId={data.tenant_id}
			eventId={data.event_id}
			initialTracks={data.tracks}
			showQr
			enableBattle
			initialBattle={initialBattle}
		/>
	);
}
