-- 46 · v23 · "Abrir Fiesta de Hoy" abría la sala sin una sola canción
--
--   El botón grande del panel —el que dice "crea y activa el evento para
--   empezar a trabajar"— creaba la fiesta ya activa y con el repertorio
--   vacío.  Sin aviso ninguno: la guarda que pusimos en `activate_event`
--   no pasa por aquí.
--
--   Es peor que el caso del 3 de septiembre, porque este es el camino corto
--   y el que va a pulsar cualquiera con prisa.  Quien abriera la app en ese
--   momento se encontraba el Jukebox y el Tinder vacíos.
--
--   El arreglo no es avisar, es que no pueda pasar: la fiesta se abre con el
--   almacén de la sala dentro.  Es lo que el botón promete y lo que tenían
--   las fiestas de julio, que llevaban las 759 canciones.
--
--   Se devuelve `tracks` para que el panel pueda decir "abierta con 759
--   canciones" — o avisar si el almacén está vacío, que es el único caso en
--   el que sigue naciendo sin repertorio.

create or replace function public.admin_open_party(
	p_tenant_id uuid, p_actor_uid uuid, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

		-- El repertorio entra con la fiesta.  Con género y con el enlace al
		-- almacén: si se pierden aquí, el panel de música del dashboard se
		-- queda ciego para toda la noche.
		insert into public.event_tracks
			(tenant_id, event_id, spotify_id, title, artist, cover_image_url,
			 genre, global_track_id, total_votes, is_played)
		select p_tenant_id, v_event.id, g.spotify_id, g.title, g.artist,
		       g.cover_image_url, g.genre, g.id, 0, false
		from public.global_tracks g
		where g.tenant_id = p_tenant_id;
		get diagnostics v_tracks = row_count;

		insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
		values (p_tenant_id, p_actor_uid, 'open_party', 'tenant_events', v_event.id,
		        jsonb_build_object('name', v_event.name, 'tracks', v_tracks));
	else
		select count(*) into v_tracks from public.event_tracks
		 where event_id = v_event.id and tenant_id = p_tenant_id;
	end if;

	return jsonb_build_object('ok', true, 'event_id', v_event.id, 'name', v_event.name,
		'status', v_event.status, 'tracks', v_tracks, 'created', v_nueva);
end; $function$;
