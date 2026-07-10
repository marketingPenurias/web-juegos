-- ============================================================================
-- 22 · V17 — Cierre AUTOMÁTICO de batallas vencidas (pg_cron)
-- ============================================================================
--
-- Aplicado en remoto vía MCP (migración `v17_cron_auto_close_due_battles`).
-- Este archivo es el ESPEJO para el histórico del repo.
--
-- Problema: el cierre de una batalla dependía de un temporizador en el cliente
-- de /admin.  Si nadie tenía /admin abierto, la batalla se quedaba en estado
-- 'live' pasado su `ends_at`: el móvil se bloqueaba como "duelo cerrado" y la
-- TV nunca proclamaba ganador.  Mala práctica (depender de una pestaña abierta).
--
-- Solución: cron cada minuto — mismo patrón que `close-due-events`.  Nadie
-- necesita tener /admin abierto para que las batallas se resuelvan.
-- ----------------------------------------------------------------------------

-- 1) resolve_due_battles: p_tenant_id NULL = TODOS los tenants (la firma sigue
--    sirviendo a la llamada tenant-scoped del temporizador de /admin).
CREATE OR REPLACE FUNCTION public.resolve_due_battles(p_tenant_id uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count int := 0; v_b record; v_va int; v_vb int; v_winner uuid;
begin
	for v_b in
		select * from public.live_battles
		where status = 'live' and ends_at <= now()
		  and (p_tenant_id is null or tenant_id = p_tenant_id)
		for update
	loop
		select total_votes into v_va from public.event_tracks where id = v_b.track_a;
		select total_votes into v_vb from public.event_tracks where id = v_b.track_b;
		-- Empate → gana track_a (misma regla que admin_force_close_battle).
		v_winner := case when coalesce(v_vb,0) > coalesce(v_va,0) then v_b.track_b else v_b.track_a end;
		update public.live_battles set status = 'closed', winner_track = v_winner where id = v_b.id;
		v_count := v_count + 1;
	end loop;
	return v_count;
end; $function$;

-- 2) Programar el cron cada minuto (idempotente).
select cron.unschedule(jobid) from cron.job where jobname = 'close-due-battles';
select cron.schedule('close-due-battles', '* * * * *', $$select public.resolve_due_battles();$$);
