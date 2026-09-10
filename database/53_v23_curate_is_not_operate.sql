-- ═══════════════════════════════════════════════════════════════════════
-- 53 · v23 · Curar no es lo mismo que operar
-- ═══════════════════════════════════════════════════════════════════════
--
-- Fallo de la 52, encontrado antes de conectarla al panel.  `admin_touch_
-- event_track` marcaba SIEMPRE `added_by='dj'`, y `admin_set_now_playing_
-- global` la usaba para materializar la fila.  Resultado:
--
--   fiesta sin curar → el DJ marca la primera canción como sonando
--   → esa fila pasa a ser "la lista del DJ"
--   → la lista tiene UNA canción, y encima está sonando (se filtra)
--   → el catálogo devuelve CERO: Jukebox y Tinder vacíos en plena noche.
--
-- Verificado: 759 → 0 con una sola llamada.
--
-- La confusión de fondo es entre dos gestos que NO significan lo mismo:
--
--   · CURAR   — "ésta va en mi lista de esta noche".  Es una elección, y es
--               lo único que debe activar la regla de la selección.
--   · OPERAR  — ponerla, enfrentarla en una batalla, que alguien la vote.
--               Necesita una fila para tener dónde guardar el estado, pero
--               NO es una elección sobre el repertorio.
--
-- Se separan de forma que el que llama tenga que decidir: el parámetro
-- `p_curate` va SIN valor por defecto a propósito.  Un default aquí es lo
-- que provocó el fallo, porque hacía que "no pensarlo" significara "curar".
--
-- OJO al reemplazar: añadir un parámetro con default a una función que ya
-- existe deja la llamada corta AMBIGUA (42725).  Por eso se borra primero
-- la firma de 4 argumentos.  Ver migración 47.
-- ═══════════════════════════════════════════════════════════════════════

begin;

drop function if exists public.admin_touch_event_track(uuid, uuid, uuid, uuid);

create or replace function public.admin_touch_event_track(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid,
	p_global_track_id uuid, p_curate boolean
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid; v_added text;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then return null; end if;
	-- 'dj' = lo eligió el DJ.  'vote' = existe sólo para guardar estado.
	v_added := case when p_curate then 'dj' else 'vote' end;

	insert into public.event_tracks
		(tenant_id, event_id, global_track_id, spotify_id, title, artist,
		 cover_image_url, genre, total_votes, is_played, added_by)
	select p_tenant_id, p_event_id, g.id, g.spotify_id, g.title, g.artist,
	       g.cover_image_url, g.genre, 0, false, v_added
	from public.global_tracks g
	where g.id = p_global_track_id and g.tenant_id = p_tenant_id
	on conflict (event_id, global_track_id) do nothing
	returning id into v_id;

	if v_id is null then
		-- Ya existía.  Curar la asciende a elección del DJ y le quita el veto;
		-- operar NO toca cómo estaba marcada: poner una canción no puede
		-- convertirla en la lista de la noche.
		if p_curate then
			update public.event_tracks
			set added_by = 'dj', excluded = false
			where event_id = p_event_id and global_track_id = p_global_track_id
			returning id into v_id;
		else
			select id into v_id from public.event_tracks
			where event_id = p_event_id and global_track_id = p_global_track_id;
		end if;
	end if;
	return v_id;
end; $$;

-- Poner una canción es OPERAR, no elegir.
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
	v_id := public.admin_touch_event_track(
		p_tenant_id, p_actor_uid, p_event_id, p_global_track_id, false);
	if v_id is null then
		return jsonb_build_object('ok', false, 'error', 'track_not_found');
	end if;
	return public.admin_set_now_playing(p_tenant_id, p_actor_uid, p_event_id, v_id);
end; $$;

commit;
