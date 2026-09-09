-- ═══════════════════════════════════════════════════════════════════════
-- 51 · v23 · La fiesta vuelve a ser lo que el DJ ha elegido
-- ═══════════════════════════════════════════════════════════════════════
--
-- Encontrado probando el 9 de septiembre: se quitó un tema de la fiesta desde
-- el panel y en el Jukebox seguía saliendo, y dejándose pedir.  `event_catalog`
-- no filtra por la fiesta: hace un LEFT JOIN partiendo de `global_tracks`, así
-- que devuelve SIEMPRE el almacén entero del local.
--
-- No es un despiste: en V20 se dejó de clonar 759 filas por evento y
-- `event_tracks` pasó de ser "la selección de la noche" a ser "el estado de un
-- tema en una noche" (votos, si sonó).  El cambio está bien, pero al hacerlo se
-- perdió por el camino el concepto de selección — y con él, el sentido de las
-- plantillas: aplicar una añadía filas pero no acotaba nada, y "Quitar" sólo
-- borraba el estado.
--
-- La regla que se recupera:
--
--   Si la fiesta tiene canciones cargadas por el DJ → se enseñan SOLO esas.
--   Si no ha cargado nada                          → se enseña el almacén.
--
-- El segundo caso es el DJ que no prepara nada, que es el caso real la mayoría
-- de las noches: sigue funcionando igual que hasta hoy, sin que nadie tenga que
-- acordarse de encender nada.
--
-- ── La trampa, que casi la lío ────────────────────────────────────────
-- "Tiene canciones cargadas" NO puede ser "existe alguna fila en event_tracks",
-- porque `ensure_event_track` crea una fila EN CADA VOTO.  Con esa regla, una
-- fiesta vacía en la que alguien vota un tema pasaría a tener "lista de una
-- canción" y el Jukebox se quedaría con ese único tema.  De ahí `added_by`:
-- hay que distinguir lo que puso el DJ de lo que apareció por un voto.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- Quién metió la fila.  Por defecto 'dj': las que ya existen son plantillas,
-- cargas masivas y "Abrir Fiesta de Hoy", que es exactamente lo que queremos
-- tratar como selección.
alter table public.event_tracks
	add column if not exists added_by text not null default 'dj';

do $$
begin
	alter table public.event_tracks
		add constraint event_tracks_added_by_check check (added_by in ('dj', 'vote'));
exception when duplicate_object then null;
end $$;

-- Para que el EXISTS de abajo no recorra la fiesta entera.
create index if not exists event_tracks_event_added_by_idx
	on public.event_tracks (event_id, added_by);

-- ── La fila que nace de un voto se marca como tal ─────────────────────
create or replace function public.ensure_event_track(
	p_tenant_id uuid, p_event_id uuid, p_global_track_id uuid
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
	select id into v_id from public.event_tracks
	where event_id = p_event_id and global_track_id = p_global_track_id;
	if v_id is not null then return v_id; end if;

	insert into public.event_tracks
		(tenant_id, event_id, global_track_id, spotify_id, title, artist,
		 cover_image_url, genre, total_votes, is_played, added_by)
	select p_tenant_id, p_event_id, g.id, g.spotify_id, g.title, g.artist,
	       g.cover_image_url, g.genre, 0, false, 'vote'
	from public.global_tracks g
	where g.id = p_global_track_id and g.tenant_id = p_tenant_id
	on conflict (event_id, global_track_id) do nothing
	returning id into v_id;

	if v_id is null then
		select id into v_id from public.event_tracks
		where event_id = p_event_id and global_track_id = p_global_track_id;
	end if;
	return v_id;
end; $$;

-- ── El catálogo respeta la selección ──────────────────────────────────
--    MISMA firma y mismos defaults: `create or replace` con una firma distinta
--    no reemplaza, crea una sobrecarga, y eso ya nos costó una noche entera
--    (ver migración 47).
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
	  -- La selección del DJ manda; si no ha elegido nada, vale todo el almacén.
	  and (
	        et.added_by = 'dj'
	     or not exists (select 1 from public.event_tracks x
	                    where x.event_id = e.id and x.added_by = 'dj')
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
grant execute on function public.ensure_event_track(uuid, uuid, uuid) to service_role;

commit;
