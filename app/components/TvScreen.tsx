import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Jumbotron } from "./Jumbotron";
import { getAccessToken } from "../lib/supabase.client";

/**
 * TvScreen — pantalla de proyector ÚNICA (Operación Wiring).
 *
 *   Antes `/tv/music` y `/tv/dashboard` eran dos componentes paralelos
 *   con ~70 líneas de boot/auth duplicadas.  Ahora ambos renderizan este
 *   componente y sólo cambian los flags:
 *
 *     · `/tv/dashboard` → <TvScreen showQr enableBattle />  (jumbotron full)
 *     · `/tv/music`     → <TvScreen />                      (sólo Top)
 *
 *   Auth: Bearer cliente + rol display/admin vía `POST /api/tv`.
 */

type TvTrack = {
	id: string;
	title: string;
	artist: string;
	cover_image_url: string | null;
	total_votes: number;
	is_played: boolean;
};
type TvBattle = { id: string; ends_at: string; a: TvTrack; b: TvTrack } | null;

type Boot =
	| { phase: "loading" }
	| { phase: "need_login" }
	| { phase: "restricted" }
	| {
			phase: "ready";
			tenantId: string;
			eventId: string | null;
			tracks: TvTrack[];
			battle: TvBattle;
	  };

function tenantSlugFromHost(): string {
	if (typeof window === "undefined") return "lapocha";
	const host = window.location.hostname;
	const sub = host.split(".")[0];
	if (!sub || sub === "localhost" || sub === "www" || host.includes("pages.dev")) {
		return "lapocha";
	}
	return sub;
}

export function TvScreen({
	showQr = false,
	enableBattle = false,
}: {
	showQr?: boolean;
	enableBattle?: boolean;
}) {
	const [boot, setBoot] = useState<Boot>({ phase: "loading" });

	useEffect(() => {
		let active = true;
		(async () => {
			const token = await getAccessToken();
			if (!token) {
				if (active) setBoot({ phase: "need_login" });
				return;
			}
			const res = await fetch("/api/tv", {
				method: "POST",
				cache: "no-store",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
					"X-Tenant-Slug": tenantSlugFromHost(),
				},
				body: JSON.stringify({ tenant_slug: tenantSlugFromHost() }),
			});
			const data = (await res.json().catch(() => ({ ok: false }))) as Record<
				string,
				unknown
			>;
			if (!active) return;
			if (data.ok !== true) {
				// 401 → sin sesión válida · 403 → sin rol display/admin.
				setBoot({
					phase:
						res.status === 403 || data.error === "forbidden"
							? "restricted"
							: "need_login",
				});
				return;
			}
			setBoot({
				phase: "ready",
				tenantId: String(data.tenant_id ?? ""),
				eventId: (data.event_id as string | null) ?? null,
				tracks: (data.tracks as TvTrack[]) ?? [],
				battle: (data.battle as TvBattle) ?? null,
			});
		})();
		return () => {
			active = false;
		};
	}, []);

	if (boot.phase === "loading") {
		return (
			<Center>
				<Loader2 className="w-12 h-12 animate-spin text-cyan-400" />
				<p className="text-zinc-300 font-bold mt-3">Conectando con el directo…</p>
			</Center>
		);
	}
	if (boot.phase === "need_login") {
		return (
			<Center>
				<Lock className="w-12 h-12 text-zinc-600" />
				<h1 className="text-2xl font-black italic text-white mt-3">
					Inicia sesión
				</h1>
				<p className="text-zinc-400 mt-1">
					Entra con una cuenta de staff (display/admin) para proyectar.
				</p>
			</Center>
		);
	}
	if (boot.phase === "restricted") {
		return (
			<Center>
				<Lock className="w-12 h-12 text-rose-500" />
				<h1 className="text-2xl font-black italic text-white mt-3">
					Acceso restringido
				</h1>
				<p className="text-zinc-400 mt-1">
					Tu cuenta no tiene rol de pantalla (display) ni admin en este local.
				</p>
			</Center>
		);
	}

	const initialBattle =
		enableBattle && boot.battle
			? {
					id: boot.battle.id,
					endsAt: boot.battle.ends_at,
					a: boot.battle.a,
					b: boot.battle.b,
			  }
			: null;

	return (
		<Jumbotron
			tenantId={boot.tenantId}
			eventId={boot.eventId}
			initialTracks={boot.tracks}
			showQr={showQr}
			enableBattle={enableBattle}
			initialBattle={initialBattle}
		/>
	);
}

function Center({ children }: { children: React.ReactNode }) {
	return (
		<div className="min-h-dvh w-full bg-black flex flex-col items-center justify-center text-center px-6">
			{children}
		</div>
	);
}
