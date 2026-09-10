-- ═══════════════════════════════════════════════════════════════════════
-- 50 · v23 · Las peticiones son canciones que NO tenemos
-- ═══════════════════════════════════════════════════════════════════════
--
-- La 49 se construyó sobre una premisa equivocada mía: que el hueco estaba
-- en las canciones del almacén que el DJ no había cargado esa noche.  No lo
-- está.  Probándolo en el desplegado se ve que el Jukebox ya sirve el
-- REPERTORIO ENTERO de la sala (`event_catalog`, V20) y que al votar se crea
-- la fila del evento al vuelo.  O sea, eso ya se podía pedir.
--
-- El hueco de verdad es el que había dicho el cliente desde el principio:
-- canciones que la sala NO tiene y que podríamos meter.  Eso no se puede
-- resolver con la biblioteca, hace falta texto libre.
--
-- Qué cambia:
--   · `global_track_id` pasa a opcional y entran `title` / `artist` de texto.
--   · Se agrupa por título+artista normalizados, porque diez personas
--     escribirán la misma canción de ocho maneras distintas.
--   · Si lo que piden YA está en el almacén se rechaza y se le dice cómo
--     buscarlo: no tiene sentido pedirle al DJ algo que ya puede votar.
--
-- Nada de lo que escribe un cliente se le enseña a otro cliente: sólo al
-- staff, y con el DJ decidiendo.
-- ═══════════════════════════════════════════════════════════════════════

begin;

alter table public.track_requests
	alter column global_track_id drop not null;

alter table public.track_requests
	add column if not exists title text,
	add column if not exists artist text;

-- La clave de deduplicación deja de ser la canción del almacén y pasa a ser
-- lo que la persona ha escrito, normalizado.
drop index if exists public.track_requests_unique_user_track;

create or replace function public.normalize_request_key(p_title text, p_artist text)
returns text language sql immutable as $$
	select lower(regexp_replace(trim(coalesce(p_title,'')) || '|' || trim(coalesce(p_artist,'')),
	                            '\s+', ' ', 'g'));
$$;

create unique index if not exists track_requests_unique_user_text
	on public.track_requests (event_id, user_id, public.normalize_request_key(title, artist))
	where title is not null;

-- ── Pedir una canción que no tenemos ──────────────────────────────────
create or replace function public.request_new_track(
	p_tenant_id uuid, p_user_id uuid, p_event_id uuid,
	p_title text, p_artist text
) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare
	v_title text := trim(coalesce(p_title, ''));
	v_artist text := nullif(trim(coalesce(p_artist, '')), '');
	v_existing record;
	v_used int;
	v_total int;
	v_limit constant int := 3;
begin
	if length(v_title) < 2 or length(v_title) > 80 then
		return jsonb_build_object('ok', false, 'error', 'invalid_title');
	end if;
	if v_artist is not null and length(v_artist) > 80 then
		return jsonb_build_object('ok', false, 'error', 'invalid_artist');
	end if;

	-- Si ya la tenemos, no es una petición: es una búsqueda que no encontró.
	select title, artist into v_existing from public.global_tracks
	where tenant_id = p_tenant_id and title ilike '%' || v_title || '%'
	limit 1;
	if found then
		return jsonb_build_object('ok', false, 'error', 'already_in_library',
			'title', v_existing.title, 'artist', v_existing.artist);
	end if;

	select count(*) into v_used from public.track_requests
	where tenant_id = p_tenant_id and user_id = p_user_id
	  and public.business_night(created_at) = public.business_night(now());
	if v_used >= v_limit then
		return jsonb_build_object('ok', false, 'error', 'request_limit', 'limit', v_limit);
	end if;

	begin
		insert into public.track_requests
			(tenant_id, event_id, user_id, title, artist)
		values (p_tenant_id, p_event_id, p_user_id, v_title, v_artist);
	exception when unique_violation then
		return jsonb_build_object('ok', false, 'error', 'already_requested');
	end;

	select count(*) into v_total from public.track_requests
	where event_id = p_event_id and status = 'pending'
	  and public.normalize_request_key(title, artist)
	    = public.normalize_request_key(v_title, v_artist);

	return jsonb_build_object('ok', true, 'title', v_title, 'artist', v_artist,
		'requests', v_total, 'remaining', v_limit - v_used - 1);
end; $$;

-- ── Lo que ve el DJ ───────────────────────────────────────────────────
--
--   Agrupado por lo que la gente ha escrito, normalizado, y ordenado por
--   cuánta gente lo pide.  Se devuelve la grafía más repetida, que suele ser
--   la más legible.
drop function if exists public.get_track_requests(uuid, uuid, uuid);
create or replace function public.get_track_requests(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid
) returns table (
	req_key text, title text, artist text, people int, first_asked timestamptz
)
language plpgsql stable security definer set search_path = 'public' as $$
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return;
	end if;
	return query
	select public.normalize_request_key(r.title, r.artist) as req_key,
	       (array_agg(r.title order by r.created_at))[1] as title,
	       (array_agg(r.artist order by r.created_at))[1] as artist,
	       count(*)::int as people,
	       min(r.created_at) as first_asked
	from public.track_requests r
	where r.tenant_id = p_tenant_id and r.event_id = p_event_id
	  and r.status = 'pending' and r.title is not null
	group by 1
	order by count(*) desc, min(r.created_at) asc;
end; $$;

-- ── El DJ la mete ─────────────────────────────────────────────────────
--
--   Entra en el almacén Y en la fiesta de esta noche, para que se pueda
--   votar ya.  Va SIN género ni carátula: nadie tiene esos datos a las tres
--   de la mañana, y el DJ los completa luego desde el almacén.  El id lleva
--   el prefijo `pedido:` justo para poder encontrarlas después.
create or replace function public.admin_accept_request(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_req_key text
) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare v_r record; v_sid text; v_gid uuid;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	select (array_agg(title order by created_at))[1] as title,
	       (array_agg(artist order by created_at))[1] as artist
	into v_r
	from public.track_requests
	where tenant_id = p_tenant_id and event_id = p_event_id and status = 'pending'
	  and public.normalize_request_key(title, artist) = p_req_key;
	if v_r.title is null then
		return jsonb_build_object('ok', false, 'error', 'request_not_found');
	end if;

	v_sid := 'pedido:' || substr(md5(p_req_key), 1, 16);

	insert into public.global_tracks (tenant_id, spotify_id, title, artist)
	values (p_tenant_id, v_sid, v_r.title, coalesce(v_r.artist, '—'))
	on conflict do nothing;
	select id into v_gid from public.global_tracks
	where tenant_id = p_tenant_id and spotify_id = v_sid;

	insert into public.event_tracks
		(tenant_id, event_id, spotify_id, title, artist, global_track_id,
		 total_votes, is_played)
	values (p_tenant_id, p_event_id, v_sid, v_r.title,
	        coalesce(v_r.artist, '—'), v_gid, 0, false)
	on conflict do nothing;

	update public.track_requests
	set status = 'added', resolved_at = now(), resolved_by = p_actor_uid
	where tenant_id = p_tenant_id and event_id = p_event_id and status = 'pending'
	  and public.normalize_request_key(title, artist) = p_req_key;

	insert into public.audit_logs
		(tenant_id, actor_id, action, table_name, record_id, new_data)
	values (p_tenant_id, p_actor_uid, 'accept_track_request', 'global_tracks',
	        v_gid, jsonb_build_object('title', v_r.title, 'artist', v_r.artist));

	return jsonb_build_object('ok', true, 'title', v_r.title, 'artist', v_r.artist);
end; $$;

create or replace function public.admin_dismiss_request(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_req_key text
) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare v_n int;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;
	update public.track_requests
	set status = 'dismissed', resolved_at = now(), resolved_by = p_actor_uid
	where tenant_id = p_tenant_id and event_id = p_event_id and status = 'pending'
	  and public.normalize_request_key(title, artist) = p_req_key;
	get diagnostics v_n = row_count;
	return jsonb_build_object('ok', true, 'dismissed', v_n);
end; $$;

-- La 49 dejó dos funciones que ya no valen para nada.
drop function if exists public.request_track(uuid, uuid, uuid, uuid);
drop function if exists public.admin_add_requested_track(uuid, uuid, uuid, uuid);
drop function if exists public.admin_dismiss_request(uuid, uuid, uuid, uuid);

commit;
