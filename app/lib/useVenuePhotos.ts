import { useEffect, useState } from "react";
import { getBrowserSupabase } from "./supabase.client";

/**
 * useVenuePhotos — URLs públicas de las fotos del local para la TV.
 *
 *   Las imágenes viven en el bucket PÚBLICO `tenant-assets` bajo la
 *   convención `<slug>/<archivo>` (ver database/14_storage_assets.sql).
 *   Listamos esa carpeta con el cliente del navegador (la policy
 *   `tenant_assets_public_read` permite SELECT a anon/authenticated) y
 *   resolvemos la URL pública de cada imagen.
 *
 *   Filtros:
 *     · Sólo imágenes (png/jpg/webp/gif) — los vídeos los gestiona
 *       `tenant.bgVideoUrl` aparte.
 *     · Se excluye `logo.*` (no es una foto de ambiente).
 *
 *   SSR-safe: sin cliente (servidor / sin configurar) devuelve [].
 */

const BUCKET = "tenant-assets";
const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;
const EXCLUDE_RE = /(^|\/)logo\.[a-z0-9]+$/i;

export function useVenuePhotos(slug: string | null | undefined): string[] {
	const [urls, setUrls] = useState<string[]>([]);

	useEffect(() => {
		const supabase = getBrowserSupabase();
		if (!supabase || !slug) {
			setUrls([]);
			return;
		}
		let cancelled = false;

		void (async () => {
			const { data, error } = await supabase.storage.from(BUCKET).list(slug, {
				limit: 100,
				sortBy: { column: "name", order: "asc" },
			});
			if (cancelled || error || !data) return;

			const out = data
				.filter((f) => IMAGE_RE.test(f.name) && !EXCLUDE_RE.test(f.name))
				.map(
					(f) =>
						supabase.storage
							.from(BUCKET)
							.getPublicUrl(`${slug}/${f.name}`).data.publicUrl,
				)
				.filter((u): u is string => Boolean(u));

			if (!cancelled) setUrls(out);
		})();

		return () => {
			cancelled = true;
		};
	}, [slug]);

	return urls;
}
