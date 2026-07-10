-- ============================================================================
-- 21 · V17 — Ocultar en la TV las canciones ya sonadas (durante 2h)
-- ============================================================================
--
-- Aplicado en remoto vía MCP (migración `v17_keep_played_at_for_2h_hide`).
-- Este archivo es el ESPEJO para el histórico del repo.
--
-- Problema: `admin_set_now_playing` ponía is_played=false, played_at=NULL en
-- las OTRAS pistas del evento.  Al cambiar de tema, la canción anterior perdía
-- su sello temporal (played_at) y REAPARECÍA al instante en el ranking del
-- jumbotron (`/tv/dashboard`, `/tv/music`).
--
-- Solución: sólo apagamos is_played y CONSERVAMOS played_at.  La TV oculta del
-- ranking cualquier pista con is_played=true (suena ahora) o played_at en las
-- últimas 2h (recién sonada) — filtro aplicado en tv-handler.server.ts y en el
-- short-polling del Jumbotron.  El handler `stop_now_playing` ("Parar todo")
-- también deja de borrar played_at (ver admin-handler.server.ts).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_now_playing(p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_track_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
	-- Apagar la que sonaba SIN borrar played_at (queda "recién sonada" 2h).
	update public.event_tracks set is_played = false
	where event_id = p_event_id and tenant_id = p_tenant_id and id <> p_track_id and is_played = true;
	-- Marcar la nueva como sonando ahora (sella played_at = now()).
	update public.event_tracks set is_played = true, played_at = now()
	where id = p_track_id and event_id = p_event_id and tenant_id = p_tenant_id;
	if not found then return jsonb_build_object('ok', false, 'error', 'track_not_found'); end if;
	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id)
	values (p_tenant_id, p_actor_uid, 'set_now_playing', 'event_tracks', p_track_id);
	return jsonb_build_object('ok', true, 'track_id', p_track_id);
end; $function$;
