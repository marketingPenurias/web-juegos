-- ═══════════════════════════════════════════════════════════════════════
-- 52 · v23 · La selección del DJ, sin duplicar el almacén (paso 1 de 3)
-- ═══════════════════════════════════════════════════════════════════════
--
-- La 51 hizo que la fiesta signifique de verdad "lo que el DJ ha elegido".
-- Pero seguimos clonando las 759 canciones en `event_tracks` al abrir la
-- fiesta (migración 46), que es exactamente la duplicación que V20 quitó:
-- ~9.000 filas al mes por sala, y la misma canción repetida evento tras
-- evento.
--
-- La idea es la de V20 llevada también al panel: la fila se crea SÓLO cuando
-- alguien hace algo con esa canción.  El DJ ve su lista entera igual que
-- ahora, porque el panel leerá del catálogo, no de las filas.
--
-- ── "Quitar" cambia de significado ────────────────────────────────────
-- Hoy borra la fila.  Sin filas clonadas, borrar no excluye nada: el
-- catálogo devolvería la canción otra vez desde el almacén.  Así que quitar
-- pasa a ser EXCLUIR de esta noche, y eso hay que marcarlo.
--
-- ── La trampa, otra vez ───────────────────────────────────────────────
-- Una canción excluida la marca el DJ, así que su fila es `added_by='dj'`.
-- Si eso contara como "el DJ ha hecho lista", quitar UNA canción dejaría la
-- fiesta con esa única fila —excluida— y por tanto vacía.  Mismo error que
-- la trampa del voto, con otra cara.
--
-- Por eso "tiene lista" es: existe alguna fila del DJ QUE NO ESTÉ EXCLUIDA.
-- Vetar tres temas no es hacer una lista: es "suena todo menos estos tres",
-- que además es un caso real y útil.
--
-- ── Este paso es ADITIVO ──────────────────────────────────────────────
-- No cambia ningún comportamiento todavía: nada excluye nada hasta que el
-- panel use las funciones nuevas.  El orden importa — si se dejara de clonar
-- antes de tocar el panel, el DJ abriría la consola y no vería nada.
-- ═══════════════════════════════════════════════════════════════════════

begin;

alter table public.event_tracks
	add column if not exists excluded boolean not null default false;

-- El EXISTS de "¿tiene lista?" corre en cada fila del catálogo.
create index if not exists event_tracks_event_dj_active_idx
	on public.event_tracks (event_id)
	where added_by = 'dj' and excluded = false;

-- ── El catálogo, con el veto ──────────────────────────────────────────
--    MISMA firma y mismos defaults (ver migración 47: una firma distinta no
--    reemplaza, crea una sobrecarga).
create or replace function public.event_catalog(
	p_event_id uuid, p_limit integer default 1000, p_exclude_voted_by uuid default null
)
returns table (
	global_track_id uuid, event_track_id uuid, spotify_id text,
	title text, artist text, cover_image_url text, genre text,
	total_votes integer, is_played boolean
)
language sql stable set search_path to 'public'
as $$
	select g.id, et.id, g.spotify_id, g.title, g.artist, g.cover_image_url, g.genre,
	       coalesce(et.total_votes, 0), coalesce(et.is_played, false)
	from public.tenant_events e
	join public.global_tracks g on g.tenant_id = e.tenant_id
	left join public.event_tracks et on et.event_id = e.id and et.global_track_id = g.id
	where e.id = p_event_id
	  and coalesce(et.is_played, false) = false
	  -- Vetada por el DJ: fuera, elija lo que elija el resto de la regla.
	  and coalesce(et.excluded, false) = false
	  -- Y si ha hecho lista, sólo su lista.
	  and (
	        et.added_by = 'dj'
	     or not exists (select 1 from public.event_tracks x
	                    where x.event_id = e.id
	                      and x.added_by = 'dj' and x.excluded = false)
	  )
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
$$;

grant execute on function public.event_catalog(uuid, integer, uuid)
	to anon, authenticated, service_role;

-- ── Materializar por decisión del DJ ──────────────────────────────────
--    `ensure_event_track` marca 'vote' porque nace de un voto.  Ésta marca
--    'dj', que es lo que activa la regla de la lista.
create or replace function public.admin_touch_event_track(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_global_track_id uuid
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then return null; end if;

	insert into public.event_tracks
		(tenant_id, event_id, global_track_id, spotify_id, title, artist,
		 cover_image_url, genre, total_votes, is_played, added_by)
	select p_tenant_id, p_event_id, g.id, g.spotify_id, g.title, g.artist,
	       g.cover_image_url, g.genre, 0, false, 'dj'
	from public.global_tracks g
	where g.id = p_global_track_id and g.tenant_id = p_tenant_id
	on conflict (event_id, global_track_id) do nothing
	returning id into v_id;

	if v_id is null then
		-- Ya existía: si la había traído un voto, ahora la hace suya el DJ.
		update public.event_tracks
		set added_by = 'dj', excluded = false
		where event_id = p_event_id and global_track_id = p_global_track_id
		returning id into v_id;
	end if;
	return v_id;
end; $$;

-- ── Quitar = excluir de esta noche ────────────────────────────────────
create or replace function public.admin_exclude_track(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid,
	p_global_track_id uuid, p_excluded boolean default true
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	insert into public.event_tracks
		(tenant_id, event_id, global_track_id, spotify_id, title, artist,
		 cover_image_url, genre, total_votes, is_played, added_by, excluded)
	select p_tenant_id, p_event_id, g.id, g.spotify_id, g.title, g.artist,
	       g.cover_image_url, g.genre, 0, false, 'dj', p_excluded
	from public.global_tracks g
	where g.id = p_global_track_id and g.tenant_id = p_tenant_id
	on conflict (event_id, global_track_id) do nothing
	returning id into v_id;

	if v_id is null then
		update public.event_tracks set excluded = p_excluded
		where event_id = p_event_id and global_track_id = p_global_track_id
		  and tenant_id = p_tenant_id
		returning id into v_id;
	end if;

	-- Deshacer un veto tiene que dejar la canción COMO SI NADIE LA HUBIERA
	-- TOCADO, y eso es no tener fila.  Si sólo se pone `excluded=false`, la
	-- fila queda con `added_by='dj'` y sin vetar — es decir, se convierte en
	-- "la lista del DJ, de una canción", y la fiesta se vacía.  Es la misma
	-- trampa del voto por un lado que no habíamos mirado; la cazó el banco de
	-- pruebas.  Sólo se borra si la fila no guarda nada que perder.
	if not p_excluded then
		delete from public.event_tracks
		where id = v_id and total_votes = 0 and is_played = false;
	end if;
	if v_id is null then
		return jsonb_build_object('ok', false, 'error', 'track_not_found');
	end if;

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id)
	values (p_tenant_id, p_actor_uid,
	        case when p_excluded then 'exclude_track' else 'include_track' end,
	        'event_tracks', v_id);

	return jsonb_build_object('ok', true, 'track_id', v_id, 'excluded', p_excluded);
end; $$;

-- ── "Poner" desde el catálogo ─────────────────────────────────────────
--    El panel dejará de tener `event_tracks.id` a mano para las canciones
--    que nadie ha tocado, así que hace falta poder marcarlas por la del
--    almacén.  Materializa y delega en la de siempre.
create or replace function public.admin_set_now_playing_global(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_global_track_id uuid
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;
	v_id := public.admin_touch_event_track(p_tenant_id, p_actor_uid, p_event_id, p_global_track_id);
	if v_id is null then
		return jsonb_build_object('ok', false, 'error', 'track_not_found');
	end if;
	return public.admin_set_now_playing(p_tenant_id, p_actor_uid, p_event_id, v_id);
end; $$;

commit;
