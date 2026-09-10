-- ═══════════════════════════════════════════════════════════════════════
-- 55 · v23 · La pista del DJ, que no es el catálogo de la sala (paso 2b)
-- ═══════════════════════════════════════════════════════════════════════
--
-- El listado del panel no puede leer de `event_catalog`, aunque lo parezca:
-- esa función sirve para la SALA y por eso esconde lo que no se puede votar
-- — lo que está sonando y lo que el DJ ha vetado.
--
-- Al DJ le hace falta justo lo contrario: verlo TODO, incluido lo que suena
-- (para pararlo o cambiarlo) y lo que vetó (para poder deshacerlo).  Son dos
-- preguntas distintas y merecen dos funciones distintas; intentar servir las
-- dos con una sola es como acabamos con `event_catalog` devolviendo el
-- almacén entero a todo el mundo.
--
-- Devuelve el almacén completo con el estado de esta noche pegado, y tres
-- banderas para que el panel pueda pintar la diferencia:
--
--   · `is_played`  → suena ahora
--   · `excluded`   → el DJ la ha vetado esta noche
--   · `in_list`    → está en su selección (y por tanto la sala la ve)
--
-- Orden: primero la que suena, luego por votos.  A las tres de la mañana lo
-- primero que busca el DJ es qué está sonando.
-- ═══════════════════════════════════════════════════════════════════════

begin;

create or replace function public.admin_event_pista(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid
) returns table (
	global_track_id uuid, event_track_id uuid, spotify_id text,
	title text, artist text, cover_image_url text, genre text,
	total_votes integer, is_played boolean,
	excluded boolean, in_list boolean, curated boolean
)
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_curated boolean;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return;
	end if;

	-- ¿Ha elegido el DJ?  Una fila suya que NO esté vetada.  Vetar tres temas
	-- no es hacer una lista: es "suena todo menos estos tres".
	select exists (
		select 1 from public.event_tracks x
		where x.event_id = p_event_id and x.added_by = 'dj' and x.excluded = false
	) into v_curated;

	return query
	select g.id, et.id, g.spotify_id,
	       coalesce(et.title, g.title), coalesce(et.artist, g.artist),
	       coalesce(et.cover_image_url, g.cover_image_url), g.genre,
	       coalesce(et.total_votes, 0), coalesce(et.is_played, false),
	       coalesce(et.excluded, false),
	       coalesce(et.added_by = 'dj' and et.excluded = false, false),
	       v_curated
	from public.tenant_events e
	join public.global_tracks g on g.tenant_id = e.tenant_id
	left join public.event_tracks et on et.event_id = e.id and et.global_track_id = g.id
	where e.id = p_event_id and e.tenant_id = p_tenant_id
	order by coalesce(et.is_played, false) desc,
	         coalesce(et.total_votes, 0) desc,
	         g.title asc;
end; $$;

-- ── Editar una canción arregla el ALMACÉN, no sólo esta noche ─────────
--
--   `update_track` escribía en `event_tracks`, así que corregir una errata
--   duraba una noche: al día siguiente volvía el título mal, porque la
--   verdad vive en `global_tracks`.  Y con filas perezosas muchas veces ni
--   siquiera hay fila que editar.
--
--   Se arregla donde toca y se refresca la caché de las noches que aún no
--   han sonado, para que el cambio se vea al momento en la app y en la tele.
create or replace function public.admin_update_global_track(
	p_tenant_id uuid, p_actor_uid uuid, p_global_track_id uuid,
	p_title text, p_artist text, p_cover text
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_title text; v_artist text; v_cover text;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	select coalesce(nullif(trim(coalesce(p_title,'')), ''), g.title),
	       coalesce(nullif(trim(coalesce(p_artist,'')), ''), g.artist),
	       nullif(trim(coalesce(p_cover, coalesce(g.cover_image_url,''))), '')
	into v_title, v_artist, v_cover
	from public.global_tracks g
	where g.id = p_global_track_id and g.tenant_id = p_tenant_id;
	if v_title is null then
		return jsonb_build_object('ok', false, 'error', 'track_not_found');
	end if;

	update public.global_tracks
	set title = v_title, artist = v_artist, cover_image_url = v_cover
	where id = p_global_track_id and tenant_id = p_tenant_id;

	-- Las filas de evento guardan una copia del texto para leer rápido, y hay
	-- que refrescarla.  Pero SÓLO en las noches que siguen abiertas.
	--
	--   · Una noche cerrada es histórico: se queda con el texto que tenía
	--     cuando sonó.  Reescribirla sería falsear lo que pasó.
	--   · Y es lo que acota la escritura.  Sin el filtro por estado, corregir
	--     una errata recorre TODAS las filas no sonadas del local, de todas
	--     las noches: hoy son 12 fiestas, con un año de historial es una
	--     escritura sin techo.  Un local tiene una o dos noches abiertas a la
	--     vez, así que el coste deja de crecer.
	update public.event_tracks et
	set title = v_title, artist = v_artist, cover_image_url = v_cover
	from public.tenant_events e
	where e.id = et.event_id
	  and et.global_track_id = p_global_track_id
	  and et.tenant_id = p_tenant_id
	  and et.is_played = false
	  and e.status in ('draft', 'scheduled', 'active');

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
	values (p_tenant_id, p_actor_uid, 'update_global_track', 'global_tracks',
	        p_global_track_id, jsonb_build_object('title', v_title, 'artist', v_artist));

	return jsonb_build_object('ok', true, 'title', v_title, 'artist', v_artist);
end; $$;

commit;
