import { useEffect, useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/tv.music";
import { loadJumbotron } from "../lib/tv-music-handler.server";
import { Jumbotron } from "../components/Jumbotron";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "Nightgraph TV · Top en directo" },
		{ name: "robots", content: "noindex" },
	];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	return loadJumbotron(request, context);
}

export default function TvMusic() {
	const data = useLoaderData<typeof loader>();
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);

	// Realtime needs the browser supabase client (which only exists
	// after hydration).  Render the server-painted leaderboard until
	// then so the projector never shows a black screen.
	if (!hydrated) {
		return (
			<Jumbotron
				tenantId={data.tenant_id}
				eventId={data.event_id}
				initialTracks={data.tracks}
			/>
		);
	}

	return (
		<Jumbotron
			tenantId={data.tenant_id}
			eventId={data.event_id}
			initialTracks={data.tracks}
		/>
	);
}
