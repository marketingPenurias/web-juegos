-- =========================================================================
--  12_admin_cockpit.sql — Cockpit del DJ (Sprint V1.6 · Bloque B)
-- =========================================================================
--
--   1. Ampliar el CHECK de `tenant_events.status` para soportar la
--      programación de eventos futuros ('scheduled') y el cierre explícito
--      ('ended').  Antes sólo admitía ('draft','active','closed'), lo que
--      bloqueaba `create_event` (scheduled) y `update_event` (ended).
--
--   2. Reescribir `admin_start_battle` para que el DJ ELIJA las dos pistas
--      (control creativo).  Se añade una sobrecarga de 6 args con
--      `p_track_a` / `p_track_b` explícitos y validación estricta; la
--      versión antigua de 4 args (auto top-2) se conserva para compat.
-- =========================================================================


-- ── 1. CHECK de estado de eventos ────────────────────────────────────────
alter table public.tenant_events
	drop constraint if exists tenant_events_status_check;
alter table public.tenant_events
	add constraint tenant_events_status_check
	check (status in ('draft', 'active', 'closed', 'scheduled', 'ended'));


-- ── 2. Batalla con selección MANUAL de pistas ────────────────────────────
-- Sobrecarga con track_a/track_b obligatorios.  Valida:
--   · actor es staff,
--   · las dos pistas son distintas,
--   · ambas pertenecen al evento + tenant,
--   · ninguna está ya sonada (is_played),
--   · no hay otra batalla viva (autocierra las vencidas antes).
create or replace function public.admin_start_battle(
	p_tenant_id uuid,
	p_actor_uid uuid,
	p_event_id  uuid,
	p_track_a   uuid,
	p_track_b   uuid,
	p_minutes   int default 3
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
	v_battle record;
	v_valid  int;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	if p_track_a is null or p_track_b is null then
		return jsonb_build_object('ok', false, 'error', 'tracks_required');
	end if;
	if p_track_a = p_track_b then
		return jsonb_build_object('ok', false, 'error', 'tracks_must_differ');
	end if;

	-- Las dos pistas existen en ESTE evento/tenant y no están sonadas.
	select count(*) into v_valid
	from public.event_tracks
	where tenant_id = p_tenant_id
	  and event_id  = p_event_id
	  and is_played = false
	  and id in (p_track_a, p_track_b);
	if v_valid <> 2 then
		return jsonb_build_object('ok', false, 'error', 'invalid_tracks');
	end if;

	-- Cerrar batallas colgadas antes de abrir otra.
	perform public.resolve_due_battles(p_tenant_id);
	if exists (select 1 from public.live_battles
	           where event_id = p_event_id and status = 'live') then
		return jsonb_build_object('ok', false, 'error', 'battle_already_live');
	end if;

	insert into public.live_battles (tenant_id, event_id, track_a, track_b, status, started_at, ends_at)
	values (p_tenant_id, p_event_id, p_track_a, p_track_b, 'live', now(),
	        now() + make_interval(mins => greatest(1, p_minutes)))
	returning * into v_battle;

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
	values (p_tenant_id, p_actor_uid, 'start_battle', 'live_battles', v_battle.id,
	        jsonb_build_object('minutes', p_minutes, 'track_a', p_track_a, 'track_b', p_track_b, 'manual', true));

	return jsonb_build_object('ok', true, 'battle_id', v_battle.id, 'ends_at', v_battle.ends_at);
end;
$$;
revoke execute on function public.admin_start_battle(uuid, uuid, uuid, uuid, uuid, int) from public, anon, authenticated;
grant  execute on function public.admin_start_battle(uuid, uuid, uuid, uuid, uuid, int) to service_role;
