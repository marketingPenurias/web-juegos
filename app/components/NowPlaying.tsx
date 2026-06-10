import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Disc3, ExternalLink } from "lucide-react";
import { gsap, useGSAP } from "../lib/gsap";
import { getBrowserSupabase } from "../lib/supabase.client";
import { useEventTracksChannel } from "../lib/useEventTracksChannel";
import { useGameState } from "../store/useGameState";

/**
 * NowPlaying — barra global "Sonando ahora" en el móvil del usuario.
 *
 *   Lee la canción con `is_played = true` del evento activo (la marca el DJ
 *   desde /admin, con exclusión mutua en BD).  Suscripción Realtime a
 *   `event_tracks` (permitido para móviles, junto a `live_battles`); cuando
 *   el DJ cambia de tema, la barra se actualiza al instante.  Muestra
 *   portada, título, artista y enlace a Spotify para que el usuario la
 *   guarde.  Si no hay nada sonando, no renderiza nada.
 */

type Playing = {
	id: string;
	title: string;
	artist: string;
	cover_image_url: string | null;
	spotify_id: string | null;
};

function spotifyUrl(spotifyId?: string | null): string | null {
	if (!spotifyId) return null;
	const id = spotifyId.startsWith("spotify:track:")
		? spotifyId.split(":").pop() ?? ""
		: spotifyId;
	return id ? `https://open.spotify.com/track/${id}` : null;
}

export function NowPlaying() {
	const { t } = useTranslation();
	const eventId = useGameState((s) => s.activeEventId);
	const [playing, setPlaying] = useState<Playing | null>(null);
	const barRef = useRef<HTMLDivElement>(null);

	// Estado inicial: la canción marcada como sonando ahora mismo (1 fetch).
	useEffect(() => {
		const supabase = getBrowserSupabase();
		if (!supabase || !eventId) {
			setPlaying(null);
			return;
		}
		let cancelled = false;
		void (async () => {
			const { data } = await supabase
				.from("event_tracks")
				.select("id, title, artist, cover_image_url, spotify_id")
				.eq("event_id", eventId)
				.eq("is_played", true)
				.limit(1)
				.maybeSingle();
			if (!cancelled) setPlaying((data as Playing) ?? null);
		})();
		return () => {
			cancelled = true;
		};
	}, [eventId]);

	// Realtime COMPARTIDO: el DJ cambia el tema → exclusión mutua (una true,
	// resto false).  Usa el canal único de event_tracks (sin doble socket).
	useEventTracksChannel(eventId, (payload) => {
		if (payload.eventType === "DELETE") {
			const oldId = (payload.old as { id?: string })?.id;
			setPlaying((cur) => (cur && cur.id === oldId ? null : cur));
			return;
		}
		const row = payload.new as (Playing & { is_played?: boolean }) | undefined;
		if (!row?.id) return;
		if (row.is_played === true) {
			setPlaying({
				id: row.id,
				title: row.title,
				artist: row.artist,
				cover_image_url: row.cover_image_url,
				spotify_id: row.spotify_id,
			});
		} else {
			setPlaying((cur) => (cur && cur.id === row.id ? null : cur));
		}
	});

	useGSAP(
		() => {
			if (playing) {
				gsap.fromTo(
					barRef.current,
					{ y: 20, opacity: 0 },
					{ y: 0, opacity: 1, duration: 0.4, ease: "power3.out", force3D: true },
				);
			}
		},
		{ dependencies: [playing?.id] },
	);

	if (!playing) return null;
	const url = spotifyUrl(playing.spotify_id);

	return (
		<div
			ref={barRef}
			className="shrink-0 mx-3 mb-1 rounded-2xl bg-linear-to-r from-zinc-900 to-zinc-950 border border-cyan-500/30 px-3 py-2 flex items-center gap-3 shadow-[0_0_20px_rgba(0,212,255,0.18)]"
		>
			<div className="w-10 h-10 rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center shrink-0">
				{playing.cover_image_url ? (
					<img src={playing.cover_image_url} alt="" className="w-full h-full object-cover" />
				) : (
					<Disc3 className="w-5 h-5 text-cyan-400 animate-spin [animation-duration:3s]" aria-hidden="true" />
				)}
			</div>
			<div className="flex-1 min-w-0">
				<p className="text-[9px] uppercase tracking-[0.25em] text-cyan-400 font-black flex items-center gap-1">
					<span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
					{t("nowPlaying.tag", "Sonando ahora")}
				</p>
				<p className="text-sm font-bold text-white truncate leading-tight">{playing.title}</p>
				<p className="text-[11px] text-zinc-400 truncate">{playing.artist}</p>
			</div>
			{url && (
				<a
					href={url}
					target="_blank"
					rel="noreferrer"
					className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-xl bg-[#1DB954] text-black font-black text-xs active:scale-95"
					aria-label={t("nowPlaying.openSpotify", "Abrir en Spotify")}
				>
					<ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
					Spotify
				</a>
			)}
		</div>
	);
}
