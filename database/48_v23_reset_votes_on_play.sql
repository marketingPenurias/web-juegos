-- ═══════════════════════════════════════════════════════════════════════
-- 48 · v23 · El contador del ranking vuelve a cero cuando Javi pincha
-- ═══════════════════════════════════════════════════════════════════════
--
-- El problema medido (ver docs/VOTOS.md): `admin_set_now_playing` marcaba la
-- canción como sonada pero no tocaba `total_votes`.  Como la siguiente pista
-- devuelve `is_played=false` a la anterior, la canción volvía al saco con todos
-- sus votos.  La ventana de 2h de `tv_ranking` solo la escondía un rato: en la
-- noche del 05/09, 33 de las 48 del ranking eran temas ya sonados que nadie
-- había vuelto a votar.
--
-- La idea: separar las DOS cosas que hoy son la misma columna.
--
--   · `track_votes`   → el registro.  Una fila por persona y canción.  No se
--                       toca nunca.  De aquí salen las métricas.
--   · `total_votes`   → el contador del ranking.  Se resetea al pinchar.
--
-- Lo bueno de esto es que NO hace falta romper el `UNIQUE (track_id,user_id)`.
-- Ese único sigue garantizando "un voto por persona y canción", que es lo que
-- hace que las métricas cuenten bien.  Y una canción ya sonada puede volver a
-- subir si la vota gente que todavía no la había votado — que es exactamente
-- la señal que queremos: demanda nueva, no el eco de hace tres horas.
--
-- Tres cambios que van juntos.  Por separado rompen cosas.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · Al pinchar, el contador a cero ────────────────────────────────
--
--   Se resetea `last_vote_at` también: es el desempate del ranking, y si se
--   queda con el sello viejo la canción reaparecería con ventaja al volver a
--   subir desde cero.
--
--   La excepción son las batallas.  `admin_force_close_battle` y
--   `resolve_due_battles` deciden el ganador comparando `total_votes` de las
--   dos pistas, así que poner una a cero en mitad de un duelo la haría perder
--   automáticamente.  Si el tema está en una batalla viva se pincha igual,
--   pero el contador se respeta hasta que el duelo cierre.
--
--   FIRMA IDÉNTICA a la de producción.  `create or replace` con una firma
--   distinta no reemplaza: crea una sobrecarga, y ya nos costó una noche.
create or replace function public.admin_set_now_playing(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid, p_track_id uuid
) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare v_in_battle boolean;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	-- Apagar la que sonaba SIN borrar played_at.
	update public.event_tracks set is_played = false
	where event_id = p_event_id and tenant_id = p_tenant_id
	  and id <> p_track_id and is_played = true;

	select exists (
		select 1 from public.live_battles
		where event_id = p_event_id and status = 'live'
		  and p_track_id in (track_a, track_b)
	) into v_in_battle;

	-- Marcar la nueva como sonando ahora y, salvo que esté en un duelo,
	-- devolver su contador a cero: ya ha sonado, deja de competir.
	update public.event_tracks
	set is_played   = true,
	    played_at   = now(),
	    total_votes = case when v_in_battle then total_votes else 0 end,
	    last_vote_at = case when v_in_battle then last_vote_at else null end
	where id = p_track_id and event_id = p_event_id and tenant_id = p_tenant_id;
	if not found then
		return jsonb_build_object('ok', false, 'error', 'track_not_found');
	end if;

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
	values (p_tenant_id, p_actor_uid, 'set_now_playing', 'event_tracks', p_track_id,
	        jsonb_build_object('votes_reset', not v_in_battle));

	return jsonb_build_object('ok', true, 'track_id', p_track_id, 'votes_reset', not v_in_battle);
end; $$;

-- ── 2 · La métrica deja de leer el contador ───────────────────────────
--
--   Esto es OBLIGATORIO y va en la misma migración.  `get_admin_metrics`
--   sumaba `event_tracks.total_votes`, o sea el contador del ranking y no los
--   votos.  Con el reset, el número del panel de Javi se desangraría según
--   avanzase la noche: un dato válido, sin error, y equivocado — el mismo
--   patrón que el ranking de los flash drops.
--
--   Un boost suma 5 al contador y 1 fila, así que se pondera igual para que
--   el número siga significando lo mismo.  Comprobado sobre datos reales: en
--   las 10 fiestas con votos, las dos formas de calcularlo dan idéntico.
create or replace function public.get_admin_metrics(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = 'public' as $$
declare v_votes int; v_spent int; v_checkins int; v_players int;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	select coalesce(sum(case when vote_type = 'boost' then 5 else 1 end), 0)
	into v_votes from public.track_votes
	where tenant_id = p_tenant_id and event_id = p_event_id;

	select coalesce(-sum(amount),0) into v_spent from public.wallet_ledger
	where tenant_id = p_tenant_id and amount < 0
	  and public.business_night(created_at) = public.business_night(now());

	select count(*) into v_checkins from public.venue_visits
	where tenant_id = p_tenant_id
	  and public.business_night(entry_time) = public.business_night(now());

	select count(distinct user_id) into v_players from public.track_votes
	where tenant_id = p_tenant_id and event_id = p_event_id;

	return jsonb_build_object('ok', true, 'total_votes', v_votes,
		'tokens_spent_today', v_spent, 'checkins_today', v_checkins,
		'active_players', v_players);
end; $$;

-- ── 3 · Fuera la ventana de las 2 horas ───────────────────────────────
--
--   Esa ventana existía para tapar justo este agujero: esconder un rato la
--   canción que ya había sonado, porque su contador seguía alto.  Con el
--   contador a cero sobra — el filtro `total_votes > 0` la deja fuera solo.
--
--   Y si alguien que aún no la había votado la vota, vuelve a aparecer.  Eso
--   ahora es correcto: es demanda nueva, no el eco de la que ya sonó.
create or replace function public.tv_ranking(p_event_id uuid, p_limit integer default 10)
returns table (
	id uuid, title text, artist text, cover_image_url text,
	total_votes integer, is_played boolean,
	played_at timestamptz, last_vote_at timestamptz, genre text
)
language sql stable set search_path = 'public' as $$
	select et.id, et.title, et.artist, et.cover_image_url,
	       et.total_votes, et.is_played, et.played_at, et.last_vote_at, et.genre
	from public.event_tracks et
	where et.event_id = p_event_id
	  and et.total_votes > 0
	  and et.is_played = false
	order by et.total_votes desc, et.last_vote_at asc nulls first, et.title asc
	limit greatest(1, coalesce(p_limit, 10));
$$;

commit;
