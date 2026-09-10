-- ═══════════════════════════════════════════════════════════════════════
-- 56 · v23 · Abrir la fiesta deja de clonar el almacén (paso 3 de 3)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Última pieza.  La migración 46 hacía que "Abrir Fiesta de Hoy" metiera las
-- 759 canciones en `event_tracks`, porque si no el Jukebox y el Tinder salían
-- vacíos.  Ese síntoma ya no existe: desde la 51, una fiesta sin canciones
-- del DJ significa "suena todo el almacén".
--
-- Así que la clonación pasó de ser un arreglo a ser el problema que V20
-- quería quitar: ~759 filas por noche, la misma canción repetida evento tras
-- evento, y ~9.000 filas al mes por sala.  Ahora la fiesta nace con CERO.
--
-- `tracks` sigue en la respuesta pero cambia de significado: es lo que la
-- sala va a poder votar esta noche, no cuántas filas se han creado.  Es lo
-- que el panel quiere decirle al DJ, y ahora además es verdad.
--
-- Las fiestas que ya tienen las 759 clonadas se quedan como están: se
-- comportan igual (el DJ "eligió" todo) y no merece la pena tocar histórico.
-- ═══════════════════════════════════════════════════════════════════════

begin;

create or replace function public.admin_open_party(
	p_tenant_id uuid, p_actor_uid uuid, p_name text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_event record; v_tracks int := 0; v_nueva boolean := false;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	select * into v_event from public.tenant_events
	 where tenant_id = p_tenant_id and status = 'active'
	 order by start_time desc limit 1;

	if not found then
		insert into public.tenant_events (tenant_id, name, start_time, end_time, status)
		values (p_tenant_id,
		        coalesce(nullif(p_name, ''),
		                 'Fiesta ' || to_char(now() at time zone 'Europe/Madrid', 'DD/MM')),
		        now(), now() + interval '10 hours', 'active')
		returning * into v_event;
		v_nueva := true;

		insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
		values (p_tenant_id, p_actor_uid, 'open_party', 'tenant_events', v_event.id,
		        jsonb_build_object('name', v_event.name, 'lazy', true));
	end if;

	-- Lo que la SALA va a poder votar, que es lo que el DJ quiere saber.  No
	-- son filas creadas: si no ha elegido nada, es el almacén entero.
	select count(*) into v_tracks
	from public.event_catalog(v_event.id, 100000, null);

	return jsonb_build_object('ok', true, 'event_id', v_event.id, 'name', v_event.name,
		'status', v_event.status, 'tracks', v_tracks, 'created', v_nueva);
end; $$;

commit;
