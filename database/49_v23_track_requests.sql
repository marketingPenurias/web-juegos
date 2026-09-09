-- ═══════════════════════════════════════════════════════════════════════
-- 49 · v23 · Pedirle una canción al DJ
-- ═══════════════════════════════════════════════════════════════════════
--
-- El Jukebox sólo deja votar los temas que el DJ cargó esta noche.  Está
-- bien —es su sesión— pero deja fuera la pregunta que hace todo el mundo en
-- una discoteca: "¿puedes poner tal?".  Hasta ahora la respuesta de la app
-- era el silencio: buscabas, no salía, y parecía que la app estaba rota.
--
-- Se pide de la BIBLIOTECA de la sala, no en texto libre.  La Pocha tiene
-- 759 temas en el almacén y suele cargar ~520 en la fiesta: hay 240 canciones
-- que el DJ ya tiene y esa noche no puso.  Ahí está el hueco.
--
-- Y así el DJ recibe una canción de verdad —con su spotify_id, su género y su
-- carátula— que añade de un toque, en vez de un texto suelto que alguien
-- tiene que buscar y teclear a las tres de la mañana.
--
-- La señal que importa NO es la petición suelta, es cuánta gente pide lo
-- mismo.  "Siete personas han pedido esta" es una decisión fácil de tomar;
-- "alguien ha pedido esta" no es nada.
-- ═══════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.track_requests (
	id uuid primary key default gen_random_uuid(),
	tenant_id uuid not null references public.tenants(id) on delete cascade,
	event_id uuid not null references public.tenant_events(id) on delete cascade,
	user_id uuid not null references public.user_profiles(id) on delete cascade,
	global_track_id uuid not null references public.global_tracks(id) on delete cascade,
	status text not null default 'pending'
		check (status in ('pending', 'added', 'dismissed')),
	created_at timestamptz not null default now(),
	resolved_at timestamptz,
	-- Quién la resolvió: uid de AUTH del staff, sin foránea a
	-- user_profiles — el DJ no tiene por qué ser cliente de la sala.
	resolved_by uuid
);

-- Una persona pide una canción una vez por fiesta.  Sin esto, mantener el
-- dedo pulsado sube el contador y el DJ ve una demanda que no existe.
create unique index if not exists track_requests_unique_user_track
	on public.track_requests (event_id, user_id, global_track_id);

-- La consulta del panel: pendientes de esta fiesta, agrupadas por canción.
create index if not exists track_requests_event_status_idx
	on public.track_requests (event_id, status);

alter table public.track_requests enable row level security;

-- Cada quien ve lo suyo; el staff ve todo lo de su sala.
drop policy if exists track_requests_select on public.track_requests;
create policy track_requests_select on public.track_requests for select
	using (
		user_id = auth.uid() or public.is_tenant_staff(tenant_id, auth.uid())
	);

-- Nadie escribe a mano: se entra por `request_track`, que valida y limita.
drop policy if exists track_requests_staff_update on public.track_requests;
create policy track_requests_staff_update on public.track_requests for update
	using (public.is_tenant_staff(tenant_id, auth.uid()));


-- ── Pedir ─────────────────────────────────────────────────────────────
--
--   Rechaza lo que no tiene sentido antes de crear ruido en el panel:
--     · la canción ya está en la fiesta  → que la voten, no que la pidan
--     · ya la pidió esta persona          → el único índice lo impediría,
--                                           pero un error legible es mejor
--     · tres por noche y persona          → una lista de peticiones que es
--                                           la playlist de una sola persona
--                                           no le sirve al DJ
create or replace function public.request_track(
	p_tenant_id uuid, p_user_id uuid, p_event_id uuid, p_global_track_id uuid
) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare
	v_track record;
	v_used int;
	v_total int;
	v_limit constant int := 3;
begin
	select id, spotify_id, title, artist into v_track
	from public.global_tracks
	where id = p_global_track_id and tenant_id = p_tenant_id;
	if not found then
		return jsonb_build_object('ok', false, 'error', 'track_not_found');
	end if;

	if exists (
		select 1 from public.event_tracks
		where event_id = p_event_id and tenant_id = p_tenant_id
		  and spotify_id = v_track.spotify_id
	) then
		return jsonb_build_object('ok', false, 'error', 'already_in_party');
	end if;

	if exists (
		select 1 from public.track_requests
		where event_id = p_event_id and user_id = p_user_id
		  and global_track_id = p_global_track_id
	) then
		return jsonb_build_object('ok', false, 'error', 'already_requested');
	end if;

	select count(*) into v_used from public.track_requests
	where tenant_id = p_tenant_id and user_id = p_user_id
	  and public.business_night(created_at) = public.business_night(now());
	if v_used >= v_limit then
		return jsonb_build_object('ok', false, 'error', 'request_limit',
			'limit', v_limit);
	end if;

	insert into public.track_requests
		(tenant_id, event_id, user_id, global_track_id)
	values (p_tenant_id, p_event_id, p_user_id, p_global_track_id);

	select count(*) into v_total from public.track_requests
	where event_id = p_event_id and global_track_id = p_global_track_id
	  and status = 'pending';

	return jsonb_build_object('ok', true, 'title', v_track.title,
		'artist', v_track.artist, 'requests', v_total,
		'remaining', v_limit - v_used - 1);
end; $$;


-- ── Lo que ve el DJ ───────────────────────────────────────────────────
--
--   Agrupado por canción y ordenado por cuánta gente la pide.  Una fila por
--   petición sería una bandeja de entrada; esto es una decisión.
create or replace function public.get_track_requests(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid
) returns table (
	global_track_id uuid, title text, artist text, genre text,
	cover_image_url text, people int, first_asked timestamptz
)
language plpgsql stable security definer set search_path = 'public' as $$
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return;
	end if;
	return query
	select g.id, g.title, g.artist, g.genre, g.cover_image_url,
	       count(*)::int as people, min(r.created_at) as first_asked
	from public.track_requests r
	join public.global_tracks g on g.id = r.global_track_id
	where r.tenant_id = p_tenant_id and r.event_id = p_event_id
	  and r.status = 'pending'
	group by g.id, g.title, g.artist, g.genre, g.cover_image_url
	order by count(*) desc, min(r.created_at) asc;
end; $$;


-- ── Aceptarla ─────────────────────────────────────────────────────────
--
--   Copia el tema del almacén a la fiesta.  OJO al género y al
--   `global_track_id`: los cinco caminos que copiaban temas se los dejaban
--   por el camino y se arregló en la migración 45.  Este es el sexto y nace
--   con ellos puestos.
create or replace function public.admin_add_requested_track(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_global_track_id uuid
) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare v_g record; v_new uuid;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	select * into v_g from public.global_tracks
	where id = p_global_track_id and tenant_id = p_tenant_id;
	if not found then
		return jsonb_build_object('ok', false, 'error', 'track_not_found');
	end if;

	insert into public.event_tracks
		(tenant_id, event_id, spotify_id, title, artist, cover_image_url,
		 genre, global_track_id, total_votes, is_played)
	values (p_tenant_id, p_event_id, v_g.spotify_id, v_g.title, v_g.artist,
	        v_g.cover_image_url, v_g.genre, v_g.id, 0, false)
	on conflict do nothing
	returning id into v_new;

	update public.track_requests
	set status = 'added', resolved_at = now(), resolved_by = p_actor_uid
	where event_id = p_event_id and global_track_id = p_global_track_id
	  and status = 'pending';

	insert into public.audit_logs
		(tenant_id, actor_id, action, table_name, record_id, new_data)
	values (p_tenant_id, p_actor_uid, 'add_requested_track', 'event_tracks',
	        coalesce(v_new, p_global_track_id),
	        jsonb_build_object('title', v_g.title, 'artist', v_g.artist));

	return jsonb_build_object('ok', true, 'track_id', v_new,
		'title', v_g.title, 'artist', v_g.artist);
end; $$;


-- ── Descartarla ───────────────────────────────────────────────────────
create or replace function public.admin_dismiss_request(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_global_track_id uuid
) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare v_n int;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;
	update public.track_requests
	set status = 'dismissed', resolved_at = now(), resolved_by = p_actor_uid
	where event_id = p_event_id and global_track_id = p_global_track_id
	  and tenant_id = p_tenant_id and status = 'pending';
	get diagnostics v_n = row_count;
	return jsonb_build_object('ok', true, 'dismissed', v_n);
end; $$;

commit;
