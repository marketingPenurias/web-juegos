-- ============================================================================
-- 25 · V20 FASE 2 — `tv_ranking`: regla ÚNICA de visibilidad del jumbotron
-- ============================================================================
-- Aplicado en remoto vía MCP (migración `v20_tv_ranking_visibility`).
-- Espejo para el histórico del repo.
--
-- Reglas de negocio:
--   · sólo temas CON votos (total_votes > 0) — la tele deja de listar relleno;
--   · el que suena AHORA no aparece (is_played);
--   · un tema ya sonado desaparece y vuelve SÓLO si lo re-votan
--     (last_vote_at > played_at) o si han pasado 2 h desde que sonó;
--   · empate a votos → primero el que lleva más tiempo con ellos.
--
-- Por qué en SQL y no como filtro PostgREST: `last_vote_at > played_at` compara
-- DOS COLUMNAS y PostgREST no puede expresarlo.  Además así la regla existe una
-- sola vez para el handler del servidor y para el poll de la TV (el filtro
-- equivalente en `Jumbotron.tsx` sólo cubre el hueco entre polls, porque el
-- Realtime entrega filas sueltas).
--
-- IMPORTANTE — no se pierde ningún dato: `track_votes` y `total_votes` quedan
-- intactos.  Esto decide QUÉ SE PINTA, no qué se guarda; por eso un tema que
-- reaparece conserva TODOS sus votos y las métricas siguen completas.
--
-- SECURITY INVOKER a propósito: respeta la RLS de event_tracks
-- (tenant_id = current_tenant_id()) cuando la llama el navegador como
-- `authenticated`; el worker la llama con service_role, que bypassa RLS.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tv_ranking(p_event_id uuid, p_limit integer DEFAULT 10)
 RETURNS TABLE (
	id uuid, title text, artist text, cover_image_url text,
	total_votes integer, is_played boolean,
	played_at timestamptz, last_vote_at timestamptz, genre text
 )
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
	select et.id, et.title, et.artist, et.cover_image_url,
	       et.total_votes, et.is_played, et.played_at, et.last_vote_at, et.genre
	from public.event_tracks et
	where et.event_id = p_event_id
	  and et.total_votes > 0
	  and et.is_played = false
	  and (
	        et.played_at is null
	     or (et.last_vote_at is not null and et.last_vote_at > et.played_at)
	     or et.played_at < now() - interval '2 hours'
	  )
	order by et.total_votes desc, et.last_vote_at asc nulls first, et.title asc
	limit greatest(1, coalesce(p_limit, 10));
$function$;

grant execute on function public.tv_ranking(uuid, integer) to anon, authenticated, service_role;
