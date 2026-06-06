-- =========================================================================
--  15_event_lifecycle_templates.sql — Ciclo de vida de eventos + Plantillas
--  (Sprint V1.6.1 · DJ cockpit)
-- =========================================================================
--
--   1. AUTO-CIERRE de eventos vencidos.  Bug detectado: un evento quedaba
--      'active' indefinidamente aunque su `end_time` ya hubiese pasado (no
--      había NINGÚN mecanismo de cierre — sólo se autocerraban las batallas).
--      Solución: función `close_due_events()` + job pg_cron cada 15 min, y
--      llamadas perezosas desde el backend (bootstrap/session/tv) para que
--      el cierre sea inmediato al cargar, no sólo cada cuarto de hora.
--
--   2. PLANTILLAS de setlist: el DJ guarda el tracklist de una noche como
--      plantilla con nombre y la aplica a cualquier evento futuro (repetir
--      la misma sesión varias noches sin re-teclear).
-- =========================================================================


-- ── 1. Auto-cierre de eventos ────────────────────────────────────────────
-- Cierra (status='ended') los eventos 'active' cuyo end_time ya pasó.
-- p_tenant_id NULL → todos los tenants (lo usa el cron); con tenant →
-- cierre perezoso acotado (lo llaman bootstrap/session).
create or replace function public.close_due_events(p_tenant_id uuid default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
	update public.tenant_events
	set status = 'ended'
	where status = 'active'
	  and end_time is not null
	  and end_time < now()
	  and (p_tenant_id is null or tenant_id = p_tenant_id);
	get diagnostics v_count = row_count;
	return v_count;
end;
$$;
revoke execute on function public.close_due_events(uuid) from public, anon, authenticated;
grant  execute on function public.close_due_events(uuid) to service_role;

-- Job pg_cron cada 15 min (red de seguridad global). Idempotente.
do $$
begin
	perform cron.unschedule('close-due-events');
exception when others then
	null; -- el job aún no existía
end $$;
select cron.schedule('close-due-events', '*/15 * * * *', $$select public.close_due_events();$$);


-- ── 2. Plantillas de setlist ─────────────────────────────────────────────
create table if not exists public.event_templates (
	id          uuid primary key default gen_random_uuid(),
	tenant_id   uuid not null references public.tenants(id) on delete cascade,
	name        text not null,
	created_by  uuid,
	created_at  timestamptz not null default now()
);
create index if not exists event_templates_tenant_idx on public.event_templates (tenant_id, created_at desc);
alter table public.event_templates enable row level security;
drop policy if exists event_templates_tenant_read on public.event_templates;
create policy event_templates_tenant_read on public.event_templates
	for select using (tenant_id = public.current_tenant_id());

create table if not exists public.event_template_tracks (
	id              uuid primary key default gen_random_uuid(),
	template_id     uuid not null references public.event_templates(id) on delete cascade,
	tenant_id       uuid not null references public.tenants(id) on delete cascade,
	spotify_id      text not null,
	title           text not null,
	artist          text not null,
	cover_image_url text,
	position        int  not null default 0,
	created_at      timestamptz not null default now()
);
create index if not exists event_template_tracks_tpl_idx on public.event_template_tracks (template_id, position);
alter table public.event_template_tracks enable row level security;
drop policy if exists event_template_tracks_tenant_read on public.event_template_tracks;
create policy event_template_tracks_tenant_read on public.event_template_tracks
	for select using (tenant_id = public.current_tenant_id());

grant select on public.event_templates       to anon, authenticated;
grant select on public.event_template_tracks to anon, authenticated;

-- 2.1 Guardar el setlist ACTUAL del evento como plantilla.
create or replace function public.admin_save_template(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_name text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
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
		(template_id, tenant_id, spotify_id, title, artist, cover_image_url, position)
	select v_tpl_id, p_tenant_id, et.spotify_id, et.title, et.artist, et.cover_image_url,
	       row_number() over (order by et.total_votes desc, et.title asc)
	from public.event_tracks et
	where et.tenant_id = p_tenant_id and et.event_id = p_event_id;
	get diagnostics v_count = row_count;

	if v_count = 0 then
		delete from public.event_templates where id = v_tpl_id; -- plantilla vacía → descartar
		return jsonb_build_object('ok', false, 'error', 'event_empty');
	end if;

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
	values (p_tenant_id, p_actor_uid, 'save_template', 'event_templates', v_tpl_id,
	        jsonb_build_object('name', p_name, 'tracks', v_count));

	return jsonb_build_object('ok', true, 'template_id', v_tpl_id, 'tracks', v_count);
end;
$$;
revoke execute on function public.admin_save_template(uuid, uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.admin_save_template(uuid, uuid, uuid, text) to service_role;

-- 2.2 Aplicar una plantilla al evento (inserta los temas que falten; dedupe
--     por spotify_id para no duplicar lo ya presente).
create or replace function public.admin_apply_template(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_template_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
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
		(tenant_id, event_id, spotify_id, title, artist, cover_image_url, total_votes, is_played)
	select p_tenant_id, p_event_id, tt.spotify_id, tt.title, tt.artist, tt.cover_image_url, 0, false
	from public.event_template_tracks tt
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
$$;
revoke execute on function public.admin_apply_template(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.admin_apply_template(uuid, uuid, uuid, uuid) to service_role;

-- 2.3 Borrar plantilla (cascade borra sus tracks).
create or replace function public.admin_delete_template(
	p_tenant_id uuid, p_actor_uid uuid, p_template_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;
	delete from public.event_templates where id = p_template_id and tenant_id = p_tenant_id;
	if not found then
		return jsonb_build_object('ok', false, 'error', 'template_not_found');
	end if;
	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id)
	values (p_tenant_id, p_actor_uid, 'delete_template', 'event_templates', p_template_id);
	return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.admin_delete_template(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.admin_delete_template(uuid, uuid, uuid) to service_role;
