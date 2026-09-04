-- 45 · v23 · Meter una canción en una fiesta le borraba el género
--
--   QA del circuito de música.  El almacén global tiene el género de las 759
--   canciones, al 100 %.  Pero NINGUNA de las cuatro vías que meten una
--   canción en una fiesta lo copiaba:
--
--       add_event_tracks       (handler)  · lee solo spotify_id/título/artista
--       admin_add_event_track  (RPC)      · idem
--       admin_apply_template   (RPC)      · las plantillas ni lo guardaban
--       admin_save_template    (RPC)      · lo perdía al guardar
--
--   El resultado se ve en el dato: las seis fiestas de julio tienen 759 temas
--   con género y con enlace al almacén; las dos del 3 de septiembre tienen
--   500 temas, TODOS sin género y sin enlace.  Aquellas se sembraron por otra
--   vía; estas se cargaron desde el panel.
--
--   Consecuencia: el panel de música del dashboard —desglose por género y
--   género por hora— se queda ciego para todo lo cargado desde la interfaz.
--   No es que falle: es que recibe NULL.
--
--   Se arregla en las cuatro vías y se repara lo ya perdido, que se puede
--   recuperar cruzando por `spotify_id` contra el almacén.

-- ── 1 · Que las plantillas guarden lo que hoy tiran ──────────────────────
alter table public.event_template_tracks
	add column if not exists genre           text,
	add column if not exists global_track_id uuid;

-- ── 2 · Guardar una sesión como plantilla sin perder el género ───────────
create or replace function public.admin_save_template(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_name text)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_tpl_id uuid; v_count int;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;
	if coalesce(btrim(p_name), '') = '' then
		return jsonb_build_object('ok', false, 'error', 'name_required');
	end if;

	insert into public.event_templates (tenant_id, name, created_by)
	values (p_tenant_id, left(btrim(p_name), 120), p_actor_uid)
	returning id into v_tpl_id;

	insert into public.event_template_tracks
		(template_id, tenant_id, spotify_id, title, artist, cover_image_url,
		 genre, global_track_id, position)
	select v_tpl_id, p_tenant_id, et.spotify_id, et.title, et.artist, et.cover_image_url,
	       -- Si el tema perdió el género por el camino, se recupera del almacén.
	       coalesce(et.genre, g.genre),
	       coalesce(et.global_track_id, g.id),
	       row_number() over (order by et.total_votes desc, et.title asc)
	from public.event_tracks et
	left join public.global_tracks g
	       on g.tenant_id = et.tenant_id and g.spotify_id = et.spotify_id
	where et.tenant_id = p_tenant_id and et.event_id = p_event_id;
	get diagnostics v_count = row_count;

	if v_count = 0 then
		delete from public.event_templates where id = v_tpl_id;
		return jsonb_build_object('ok', false, 'error', 'event_empty');
	end if;

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
	values (p_tenant_id, p_actor_uid, 'save_template', 'event_templates', v_tpl_id,
	        jsonb_build_object('name', p_name, 'tracks', v_count));

	return jsonb_build_object('ok', true, 'template_id', v_tpl_id, 'tracks', v_count);
end;
$function$;

-- ── 3 · Aplicar una plantilla conservando el género ──────────────────────
--   El `left join` al almacén no es redundante: las plantillas guardadas
--   ANTES de esta migración no tienen género, y así se recupera igual.
create or replace function public.admin_apply_template(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_template_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_added int;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;
	if not exists (select 1 from public.event_templates
	               where id = p_template_id and tenant_id = p_tenant_id) then
		return jsonb_build_object('ok', false, 'error', 'template_not_found');
	end if;

	insert into public.event_tracks
		(tenant_id, event_id, spotify_id, title, artist, cover_image_url,
		 genre, global_track_id, total_votes, is_played)
	select p_tenant_id, p_event_id, tt.spotify_id, tt.title, tt.artist, tt.cover_image_url,
	       coalesce(tt.genre, g.genre),
	       coalesce(tt.global_track_id, g.id),
	       0, false
	from public.event_template_tracks tt
	left join public.global_tracks g
	       on g.tenant_id = tt.tenant_id and g.spotify_id = tt.spotify_id
	where tt.template_id = p_template_id and tt.tenant_id = p_tenant_id
	  and not exists (
	      select 1 from public.event_tracks et
	      where et.event_id = p_event_id and et.tenant_id = p_tenant_id
	        and et.spotify_id = tt.spotify_id
	  )
	order by tt.position;
	get diagnostics v_added = row_count;

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
	values (p_tenant_id, p_actor_uid, 'apply_template', 'event_tracks', p_template_id,
	        jsonb_build_object('event_id', p_event_id, 'added', v_added));

	return jsonb_build_object('ok', true, 'added', v_added);
end;
$function$;

-- ── 4 · Añadir una canción suelta ────────────────────────────────────────
create or replace function public.admin_add_event_track(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_global_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_g record; v_new_id uuid;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;
	select * into v_g from public.global_tracks where id = p_global_id and tenant_id = p_tenant_id;
	if not found then return jsonb_build_object('ok', false, 'error', 'track_not_found'); end if;
	if exists (select 1 from public.event_tracks
	            where event_id = p_event_id and tenant_id = p_tenant_id
	              and spotify_id = v_g.spotify_id) then
		return jsonb_build_object('ok', false, 'error', 'already_in_event');
	end if;
	insert into public.event_tracks (tenant_id, event_id, spotify_id, title, artist,
	                                 cover_image_url, genre, global_track_id, total_votes, is_played)
	values (p_tenant_id, p_event_id, v_g.spotify_id, v_g.title, v_g.artist,
	        v_g.cover_image_url, v_g.genre, v_g.id, 0, false)
	returning id into v_new_id;
	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
	values (p_tenant_id, p_actor_uid, 'add_event_track', 'event_tracks', v_new_id,
	        jsonb_build_object('title', v_g.title));
	return jsonb_build_object('ok', true, 'event_track_id', v_new_id);
end; $function$;

-- ── 5 · Reparar lo ya perdido ────────────────────────────────────────────
--   Se cruza por `spotify_id` contra el almacén, que es de donde salieron.
--   No inventa nada: solo rellena lo que se cayó al copiar.
update public.event_tracks et
   set genre           = coalesce(et.genre, g.genre),
       global_track_id = coalesce(et.global_track_id, g.id)
  from public.global_tracks g
 where g.tenant_id = et.tenant_id
   and g.spotify_id = et.spotify_id
   and (et.genre is null or et.global_track_id is null);

update public.event_template_tracks tt
   set genre           = coalesce(tt.genre, g.genre),
       global_track_id = coalesce(tt.global_track_id, g.id)
  from public.global_tracks g
 where g.tenant_id = tt.tenant_id
   and g.spotify_id = tt.spotify_id
   and (tt.genre is null or tt.global_track_id is null);
