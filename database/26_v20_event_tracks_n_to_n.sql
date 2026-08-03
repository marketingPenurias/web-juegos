-- ============================================================================
-- 26 · V20 FASE 5 — `event_tracks` N-a-N con `global_tracks` (+ creación lazy)
-- ============================================================================
-- Aplicado en remoto vía MCP. Migraciones:
--   · v20_event_tracks_n_to_n_additive
--   · v20_lazy_event_tracks_and_catalog
--   · v20_event_catalog_exclude_voted
--   · v20_vote_track_by_global_single_signature
--
-- ── El problema ─────────────────────────────────────────────────────────────
-- Cada evento CLONABA el catálogo entero: 9.108 filas para 759 canciones
-- distintas (12×), repitiendo título/artista/portada/género en cada una.
-- Corregir un título obligaba a tocarlo evento por evento, y el género había que
-- duplicarlo en las dos tablas.
--
-- ── El modelo nuevo ─────────────────────────────────────────────────────────
-- `global_tracks` = el catálogo del local (la verdad).
-- `event_tracks`  = el ESTADO de un tema en UNA noche (votos, si sonó, cuándo),
--                   vinculado por `global_track_id`.
-- La fila sólo existe cuando hace falta ("lazy"): al primer voto o al inyectarla
-- el DJ.  Un evento pasa de 759 filas a las que de verdad se usan.
--
-- ── Compatibilidad ──────────────────────────────────────────────────────────
-- Paso ADITIVO: no se borra ninguna columna.  Las de texto siguen como caché de
-- lectura rápida y los eventos ya creados conservan sus filas, así que todo lo
-- existente se comporta igual.  `track_votes.track_id` sigue apuntando a
-- `event_tracks.id`: el histórico de votos y las métricas quedan intactos.
-- ----------------------------------------------------------------------------

-- 1) Vínculo + backfill (verificado: 0 huérfanos, 9.108/9.108 mapeadas)
alter table public.event_tracks
	add column if not exists global_track_id uuid references public.global_tracks(id) on delete restrict;

update public.event_tracks et
set global_track_id = g.id
from public.global_tracks g
where g.tenant_id = et.tenant_id
  and g.spotify_id = et.spotify_id
  and et.global_track_id is null;

create unique index if not exists event_tracks_event_global_unique
	on public.event_tracks (event_id, global_track_id);
create index if not exists idx_event_tracks_global
	on public.event_tracks (global_track_id);

-- 2) ensure_event_track — materializa la fila del evento si no existe.
--    Tolera carreras (dos votos simultáneos) vía ON CONFLICT + relectura.
CREATE OR REPLACE FUNCTION public.ensure_event_track(
	p_tenant_id uuid, p_event_id uuid, p_global_track_id uuid
) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
	select id into v_id from public.event_tracks
	where event_id = p_event_id and global_track_id = p_global_track_id;
	if v_id is not null then return v_id; end if;

	insert into public.event_tracks
		(tenant_id, event_id, global_track_id, spotify_id, title, artist, cover_image_url, genre, total_votes, is_played)
	select p_tenant_id, p_event_id, g.id, g.spotify_id, g.title, g.artist, g.cover_image_url, g.genre, 0, false
	from public.global_tracks g
	where g.id = p_global_track_id and g.tenant_id = p_tenant_id
	on conflict (event_id, global_track_id) do nothing
	returning id into v_id;

	if v_id is null then
		select id into v_id from public.event_tracks
		where event_id = p_event_id and global_track_id = p_global_track_id;
	end if;
	return v_id;
end; $function$;

-- 3) event_catalog — catálogo del local + estado en este evento (LEFT JOIN).
--    `p_exclude_voted_by` sirve el deck del Tinder (catálogo menos lo ya votado
--    por ese usuario): sin esto el Tinder se quedaría SIN CARTAS en un evento
--    nuevo, porque ya no hay filas clonadas.
CREATE OR REPLACE FUNCTION public.event_catalog(
	p_event_id uuid, p_limit integer DEFAULT 1000, p_exclude_voted_by uuid DEFAULT NULL
)
 RETURNS TABLE (
	global_track_id uuid, event_track_id uuid, spotify_id text,
	title text, artist text, cover_image_url text, genre text,
	total_votes integer, is_played boolean
 )
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
	select g.id, et.id, g.spotify_id, g.title, g.artist, g.cover_image_url, g.genre,
	       coalesce(et.total_votes, 0), coalesce(et.is_played, false)
	from public.tenant_events e
	join public.global_tracks g on g.tenant_id = e.tenant_id
	left join public.event_tracks et on et.event_id = e.id and et.global_track_id = g.id
	where e.id = p_event_id
	  and coalesce(et.is_played, false) = false
	  and (
	        p_exclude_voted_by is null
	     or et.id is null
	     or not exists (select 1 from public.track_votes tv
	                    where tv.track_id = et.id and tv.user_id = p_exclude_voted_by)
	  )
	order by coalesce(et.total_votes, 0) desc,
	         coalesce(et.last_vote_at, '-infinity'::timestamptz) asc,
	         g.title asc
	limit greatest(1, coalesce(p_limit, 1000));
$function$;

grant execute on function public.ensure_event_track(uuid, uuid, uuid) to service_role;
grant execute on function public.event_catalog(uuid, integer, uuid) to anon, authenticated, service_role;

-- 4) vote_track acepta `p_global_track_id` (vota por catálogo y materializa la
--    fila).  Se eliminaron las DOS sobrecargas antiguas (7 y 9 argumentos) que
--    convivían por iteraciones previas: ahora hay UNA sola firma, sin ambigüedad.
--    Cuerpo completo: ver migración `v20_vote_track_by_global_single_signature`.
