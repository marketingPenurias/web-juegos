-- ═══════════════════════════════════════════════════════════════════════
-- 54 · v23 · La batalla se monta desde el catálogo (paso 2a de 3)
-- ═══════════════════════════════════════════════════════════════════════
--
-- `admin_start_battle` recibe dos `event_tracks.id`.  Con las filas
-- perezosas la mayoría de las canciones no tienen fila, así que los
-- desplegables del panel se quedarían casi vacíos y el DJ no podría montar
-- una batalla al principio de la noche — que es justo cuando la monta.
--
-- Esta versión recibe dos canciones del ALMACÉN, comprueba que las dos se
-- pueden enfrentar de verdad y materializa sus filas antes de delegar en la
-- de siempre.  Aguas abajo no cambia nada: `live_battles` sigue guardando
-- `event_tracks.id`, y la app y la tele siguen leyendo lo mismo.
--
-- ── La trampa, por tercera vez ────────────────────────────────────────
-- Materializar para enfrentar NO es curar.  Si estas dos filas contaran
-- como "la lista del DJ", montar una batalla en una fiesta sin curar
-- dejaría el repertorio de la noche en esas dos canciones.  Por eso
-- `p_curate => false`, igual que al poner una canción (migración 53).
--
-- ── Qué se valida ─────────────────────────────────────────────────────
-- Que las dos estén VISIBLES en el catálogo del evento, no sólo que existan
-- en el almacén.  Si no, el DJ podría enfrentar una canción que él mismo ha
-- vetado o que no está en su lista — y la sala no podría votarla, porque no
-- le sale en el Jukebox.
-- ═══════════════════════════════════════════════════════════════════════

begin;

create or replace function public.admin_start_battle_global(
	p_tenant_id uuid, p_actor_uid uuid, p_event_id uuid,
	p_global_a uuid, p_global_b uuid, p_minutes integer
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_visibles int; v_a uuid; v_b uuid;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;
	if p_global_a is null or p_global_b is null then
		return jsonb_build_object('ok', false, 'error', 'tracks_required');
	end if;
	if p_global_a = p_global_b then
		return jsonb_build_object('ok', false, 'error', 'tracks_must_differ');
	end if;

	-- Visibles en ESTE evento: ni vetadas, ni fuera de la lista, ni sonando.
	select count(*) into v_visibles
	from public.event_catalog(p_event_id, 100000, null) c
	where c.global_track_id in (p_global_a, p_global_b);
	if v_visibles <> 2 then
		return jsonb_build_object('ok', false, 'error', 'invalid_tracks');
	end if;

	-- Enfrentar no es elegir el repertorio: `p_curate => false`.
	v_a := public.admin_touch_event_track(p_tenant_id, p_actor_uid, p_event_id, p_global_a, false);
	v_b := public.admin_touch_event_track(p_tenant_id, p_actor_uid, p_event_id, p_global_b, false);
	if v_a is null or v_b is null then
		return jsonb_build_object('ok', false, 'error', 'invalid_tracks');
	end if;

	return public.admin_start_battle(p_tenant_id, p_actor_uid, p_event_id, v_a, v_b, p_minutes);
end; $$;

commit;
