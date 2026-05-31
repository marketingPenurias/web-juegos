-- ─────────────────────────────────────────────────────────────────────────
--   Nightgraph · 09 — Sprint V1.5 (Check-in/QR, Streak, Admin DJ, Battle sync)
--
--   Idempotente.  Run AFTER 08e_rewards_engine.sql.
--
--   Incluye los 4 "puntos ciegos" del CTO:
--     · admin_set_now_playing → exclusión mutua (is_played único por evento)
--     · streak con reset a 0 si falta una semana (Lun-Dom Europe/Madrid)
--     · hitos de racha 2/4/8 semanas (+50/+100/+300) idempotentes
--     · dedupe de tracks al volcar global → event (lo refuerza la UI)
-- ─────────────────────────────────────────────────────────────────────────


-- =========================================================================
--  1. TABLAS NUEVAS
-- =========================================================================

-- 1.1 Biblioteca global de canciones (repositorio maestro del local)
create table if not exists public.global_tracks (
	id              uuid primary key default gen_random_uuid(),
	tenant_id       uuid not null references public.tenants(id) on delete cascade,
	spotify_id      text not null,
	title           text not null,
	artist          text not null,
	cover_image_url text,
	created_at      timestamptz not null default now(),
	unique (tenant_id, spotify_id)
);
alter table public.global_tracks enable row level security;
drop policy if exists global_tracks_tenant_read on public.global_tracks;
create policy global_tracks_tenant_read on public.global_tracks
	for select using (tenant_id = public.current_tenant_id());

-- 1.2 Estrategias de QR (valor controlado desde BD, kind libre TEXT)
create table if not exists public.qr_strategies (
	id                 uuid primary key default gen_random_uuid(),
	tenant_id          uuid not null references public.tenants(id) on delete cascade,
	code               text not null,
	label              text not null default '',
	kind               text not null default 'mesa',   -- TEXT libre: mesa/vip/entrada/...
	reward_event_code  text not null,                  -- → tenant_token_rewards.event_code
	max_per_night      int  not null default 1,
	is_active          boolean not null default true,
	created_at         timestamptz not null default now(),
	unique (tenant_id, code)
);
alter table public.qr_strategies enable row level security;
drop policy if exists qr_strategies_tenant_read on public.qr_strategies;
create policy qr_strategies_tenant_read on public.qr_strategies
	for select using (tenant_id = public.current_tenant_id());

-- 1.3 Batallas en vivo (evento global server-managed, semi-automático)
create table if not exists public.live_battles (
	id           uuid primary key default gen_random_uuid(),
	tenant_id    uuid not null references public.tenants(id) on delete cascade,
	event_id     uuid not null references public.tenant_events(id) on delete cascade,
	track_a      uuid not null references public.event_tracks(id) on delete cascade,
	track_b      uuid not null references public.event_tracks(id) on delete cascade,
	status       text not null default 'live',          -- 'live' | 'closed'
	started_at   timestamptz not null default now(),
	ends_at      timestamptz not null,
	winner_track uuid references public.event_tracks(id),
	created_at   timestamptz not null default now()
);
create index if not exists live_battles_event_live_idx
	on public.live_battles (event_id) where status = 'live';
alter table public.live_battles enable row level security;
drop policy if exists live_battles_tenant_read on public.live_battles;
create policy live_battles_tenant_read on public.live_battles
	for select using (tenant_id = public.current_tenant_id());

-- 1.4 venue_visits: añadir trazabilidad del QR (additivo, no rompe nada)
alter table public.venue_visits
	add column if not exists qr_code text,
	add column if not exists source  text;


-- =========================================================================
--  2. SEED: reglas de economía para hitos de racha (Tabla 5 extendida)
-- =========================================================================

insert into public.tenant_token_rewards
	(tenant_id, event_code, amount, daily_limit, description)
select t.id, v.event_code, v.amount, v.daily_limit, v.description
from public.tenants t
join (values
	('streak_milestone_2', 50,  null::int, 'Hito de racha: 2 semanas seguidas'),
	('streak_milestone_4', 100, null::int, 'Hito de racha: 4 semanas seguidas'),
	('streak_milestone_8', 300, null::int, 'Hito de racha: 8 semanas seguidas')
) as v(event_code, amount, daily_limit, description) on true
where t.slug = 'lapocha'
on conflict (tenant_id, event_code) do update
	set amount = excluded.amount, description = excluded.description,
	    is_active = true, updated_at = now();

-- Seed de QRs en zonas de ALTO TRÁFICO real (local diáfano, sin VIP/mesas).
-- Todos conceden checkin_la_pocha (+50); el daily_limit del reward asegura
-- que el premio en tokens es 1/noche aunque escanee varios QRs (las visitas
-- sí se registran todas para racha/analítica).  Idempotente.
insert into public.qr_strategies (tenant_id, code, label, kind, reward_event_code, max_per_night)
select t.id, v.code, v.label, v.kind, v.reward_event_code, v.max_per_night
from public.tenants t
join (values
	('POCHA-ENTRADA-01', 'Check-in Entrada', 'entrada', 'checkin_la_pocha', 1),
	('POCHA-BANO-01',    'Check-in Baño',    'bano',    'checkin_la_pocha', 1),
	('POCHA-BARRA-01',   'Check-in Barra',   'barra',   'checkin_la_pocha', 1)
) as v(code, label, kind, reward_event_code, max_per_night) on true
where t.slug = 'lapocha'
on conflict (tenant_id, code) do nothing;


-- =========================================================================
--  3. HELPER: ¿es staff/dj activo de este tenant?
-- =========================================================================

create or replace function public.is_tenant_staff(
	p_tenant_id uuid,
	p_auth_uid  uuid
) returns boolean
language sql stable security definer set search_path = public
as $$
	select exists (
		select 1 from public.tenant_staff
		where tenant_id = p_tenant_id
		  and user_id = p_auth_uid
		  and is_active = true
	);
$$;
revoke execute on function public.is_tenant_staff(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.is_tenant_staff(uuid, uuid) to service_role;


-- =========================================================================
--  4. STREAK: semanas calendario consecutivas (Lun-Dom Europe/Madrid)
-- =========================================================================

create or replace function public.get_user_streak(
	p_user_id uuid
) returns int
language plpgsql stable security definer set search_path = public
as $$
declare
	v_weeks date[];
	v_cur   date;
	v_streak int := 0;
	v_anchor date;
	v_this_week date := date_trunc('week', (now() at time zone 'Europe/Madrid'))::date;
begin
	-- Semanas distintas (lunes de cada semana Madrid) con al menos 1 visita.
	select array_agg(distinct w order by w desc) into v_weeks
	from (
		select date_trunc('week', (entry_time at time zone 'Europe/Madrid'))::date as w
		from public.venue_visits
		where user_id = p_user_id
	) s;

	if v_weeks is null or array_length(v_weeks, 1) = 0 then
		return 0;
	end if;

	v_anchor := v_weeks[1];
	-- Diferencia en SEMANAS ISO (no días absolutos): v_this_week y v_anchor
	-- son lunes (date_trunc('week')), así que su resta en días / 7 = semanas.
	-- Racha viva si la última visita es de ESTA semana (gap 0) o de la
	-- semana pasada (gap 1, aún en periodo de gracia).  Gap >= 2 → rota.
	if ((v_this_week - v_anchor) / 7) > 1 then
		return 0;
	end if;

	-- Contar el run de semanas ISO consecutivas terminando en la más reciente
	-- (cada paso exige exactamente la semana inmediatamente anterior).
	v_cur := v_anchor;
	foreach v_anchor in array v_weeks loop
		if v_anchor = v_cur then
			v_streak := v_streak + 1;
			v_cur := v_cur - 7;          -- esperamos la semana anterior
		else
			exit;                         -- hueco → fin del run
		end if;
	end loop;

	return v_streak;
end;
$$;
revoke execute on function public.get_user_streak(uuid) from public, anon, authenticated;
grant  execute on function public.get_user_streak(uuid) to service_role;


-- =========================================================================
--  5. process_checkin — escaneo de QR → visita + recompensa + racha/hito
-- =========================================================================

create or replace function public.process_checkin(
	p_user_id  uuid,     -- user_profiles.id
	p_qr_code  text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
	v_tenant_id  uuid;
	v_qr         record;
	v_count      int;
	v_claim      jsonb;
	v_balance    int;
	v_streak     int;
	v_ms_code    text;
	v_ms_amount  int;
	v_ms_week    int := 0;
begin
	select tenant_id into v_tenant_id
	from public.user_profiles where id = p_user_id;
	if v_tenant_id is null then
		return jsonb_build_object('ok', false, 'error', 'profile_not_found');
	end if;

	-- QR válido y activo
	select * into v_qr
	from public.qr_strategies
	where tenant_id = v_tenant_id and code = p_qr_code and is_active = true;
	if not found then
		return jsonb_build_object('ok', false, 'error', 'invalid_qr');
	end if;

	-- Tope por noche para ESTE QR (business_night Madrid)
	select count(*) into v_count
	from public.venue_visits
	where user_id = p_user_id and qr_code = p_qr_code
	  and public.business_night(entry_time) = public.business_night(now());
	if v_count >= v_qr.max_per_night then
		return jsonb_build_object('ok', false, 'error', 'already_checked_in',
			'qr_label', v_qr.label);
	end if;

	-- Registrar la visita física
	insert into public.venue_visits (tenant_id, user_id, entry_time, qr_code, source)
	values (v_tenant_id, p_user_id, now(), p_qr_code, v_qr.kind);

	-- Recompensa del QR vía el motor central (respeta daily_limit del reward)
	v_claim := public.claim_gamification_reward(p_user_id, v_qr.reward_event_code, null);
	v_balance := coalesce((v_claim->>'balance')::int, 0);

	-- Racha + hito (idempotente: una sola vez por hito, de por vida)
	v_streak := public.get_user_streak(p_user_id);
	if v_streak in (2, 4, 8) then
		v_ms_code := 'streak_milestone_' || v_streak;
		if not exists (
			select 1 from public.wallet_ledger
			where user_id = p_user_id and reason = v_ms_code
		) then
			select amount into v_ms_amount
			from public.tenant_token_rewards
			where tenant_id = v_tenant_id and event_code = v_ms_code and is_active = true;
			if v_ms_amount is not null and v_ms_amount > 0 then
				insert into public.wallet_ledger (tenant_id, user_id, amount, reason, metadata)
				values (v_tenant_id, p_user_id, v_ms_amount, v_ms_code,
				        jsonb_build_object('weeks', v_streak));
				v_ms_week := v_streak;
				select token_balance into v_balance
				from public.user_profiles where id = p_user_id;
			end if;
		end if;
	end if;

	return jsonb_build_object(
		'ok', true,
		'qr_label', v_qr.label,
		'reward_amount', coalesce((v_claim->>'amount')::int, 0),
		'reward_ok', coalesce((v_claim->>'ok')::boolean, false),
		'balance', v_balance,
		'streak', v_streak,
		'milestone_week', v_ms_week,
		'milestone_amount', coalesce(v_ms_amount, 0)
	);
end;
$$;
revoke execute on function public.process_checkin(uuid, text) from public, anon, authenticated;
grant  execute on function public.process_checkin(uuid, text) to service_role;


-- =========================================================================
--  6. ADMIN RPCs (todas validan staff + escriben audit_logs)
-- =========================================================================

-- 6.1 Abrir / reutilizar la fiesta de hoy
create or replace function public.admin_open_party(
	p_tenant_id uuid,
	p_actor_uid uuid,
	p_name      text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
	v_event record;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	-- Reutilizar evento activo existente si lo hay
	select * into v_event from public.tenant_events
	where tenant_id = p_tenant_id and status = 'active'
	order by start_time desc limit 1;

	if not found then
		insert into public.tenant_events (tenant_id, name, start_time, end_time, status)
		values (
			p_tenant_id,
			coalesce(nullif(p_name, ''), 'Fiesta ' || to_char(now() at time zone 'Europe/Madrid', 'DD/MM')),
			now(), now() + interval '10 hours', 'active'
		)
		returning * into v_event;

		insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
		values (p_tenant_id, p_actor_uid, 'open_party', 'tenant_events', v_event.id,
		        jsonb_build_object('name', v_event.name));
	end if;

	return jsonb_build_object('ok', true, 'event_id', v_event.id, 'name', v_event.name,
		'status', v_event.status);
end;
$$;
revoke execute on function public.admin_open_party(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.admin_open_party(uuid, uuid, text) to service_role;

-- 6.2 Carga masiva en global_tracks (jsonb array)
create or replace function public.admin_bulk_insert_global(
	p_tenant_id uuid,
	p_actor_uid uuid,
	p_tracks    jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
	v_inserted int := 0;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	with rows as (
		select
			coalesce(x->>'spotify_id','') as spotify_id,
			coalesce(x->>'title','')      as title,
			coalesce(x->>'artist','')     as artist,
			nullif(x->>'cover_image_url','') as cover
		from jsonb_array_elements(p_tracks) as x
	),
	ins as (
		insert into public.global_tracks (tenant_id, spotify_id, title, artist, cover_image_url)
		select p_tenant_id, spotify_id, title, artist, cover
		from rows
		where spotify_id <> '' and title <> '' and artist <> ''
		on conflict (tenant_id, spotify_id) do nothing
		returning 1
	)
	select count(*) into v_inserted from ins;

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, new_data)
	values (p_tenant_id, p_actor_uid, 'bulk_insert_global', 'global_tracks',
	        jsonb_build_object('inserted', v_inserted));

	return jsonb_build_object('ok', true, 'inserted', v_inserted);
end;
$$;
revoke execute on function public.admin_bulk_insert_global(uuid, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.admin_bulk_insert_global(uuid, uuid, jsonb) to service_role;

-- 6.3 Volcar una canción global → event_tracks de la noche (con dedupe)
create or replace function public.admin_add_event_track(
	p_tenant_id uuid,
	p_actor_uid uuid,
	p_event_id  uuid,
	p_global_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
	v_g record;
	v_new_id uuid;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	select * into v_g from public.global_tracks
	where id = p_global_id and tenant_id = p_tenant_id;
	if not found then
		return jsonb_build_object('ok', false, 'error', 'track_not_found');
	end if;

	-- Dedupe: ¿ya está en la playlist de la noche?
	if exists (
		select 1 from public.event_tracks
		where event_id = p_event_id and tenant_id = p_tenant_id
		  and spotify_id = v_g.spotify_id
	) then
		return jsonb_build_object('ok', false, 'error', 'already_in_event');
	end if;

	insert into public.event_tracks
		(tenant_id, event_id, spotify_id, title, artist, cover_image_url, total_votes, is_played)
	values
		(p_tenant_id, p_event_id, v_g.spotify_id, v_g.title, v_g.artist, v_g.cover_image_url, 0, false)
	returning id into v_new_id;

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
	values (p_tenant_id, p_actor_uid, 'add_event_track', 'event_tracks', v_new_id,
	        jsonb_build_object('title', v_g.title));

	return jsonb_build_object('ok', true, 'event_track_id', v_new_id);
end;
$$;
revoke execute on function public.admin_add_event_track(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.admin_add_event_track(uuid, uuid, uuid, uuid) to service_role;

-- 6.4 Marcar "Sonando Ahora" — EXCLUSIÓN MUTUA (punto ciego #1)
create or replace function public.admin_set_now_playing(
	p_tenant_id uuid,
	p_actor_uid uuid,
	p_event_id  uuid,
	p_track_id  uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	-- Apagar cualquier otra que estuviese sonando en este evento.
	update public.event_tracks
	set is_played = false, played_at = null
	where event_id = p_event_id and tenant_id = p_tenant_id
	  and id <> p_track_id and is_played = true;

	-- Encender SOLO la elegida.
	update public.event_tracks
	set is_played = true, played_at = now()
	where id = p_track_id and event_id = p_event_id and tenant_id = p_tenant_id;
	if not found then
		return jsonb_build_object('ok', false, 'error', 'track_not_found');
	end if;

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id)
	values (p_tenant_id, p_actor_uid, 'set_now_playing', 'event_tracks', p_track_id);

	return jsonb_build_object('ok', true, 'track_id', p_track_id);
end;
$$;
revoke execute on function public.admin_set_now_playing(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.admin_set_now_playing(uuid, uuid, uuid, uuid) to service_role;

-- 6.5 Iniciar batalla (semi-automática: dura p_minutes y se autocierra)
create or replace function public.admin_start_battle(
	p_tenant_id uuid,
	p_actor_uid uuid,
	p_event_id  uuid,
	p_minutes   int default 3
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
	v_a uuid; v_b uuid; v_battle record;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	-- Cerrar batallas colgadas antes de abrir otra
	perform public.resolve_due_battles(p_tenant_id);
	if exists (select 1 from public.live_battles
	           where event_id = p_event_id and status = 'live') then
		return jsonb_build_object('ok', false, 'error', 'battle_already_live');
	end if;

	-- Top 2 por votos, no sonadas
	select id into v_a from public.event_tracks
	where event_id = p_event_id and tenant_id = p_tenant_id and is_played = false
	order by total_votes desc, title asc limit 1;
	select id into v_b from public.event_tracks
	where event_id = p_event_id and tenant_id = p_tenant_id and is_played = false
	  and id <> v_a
	order by total_votes desc, title asc limit 1;
	if v_a is null or v_b is null then
		return jsonb_build_object('ok', false, 'error', 'not_enough_tracks');
	end if;

	insert into public.live_battles (tenant_id, event_id, track_a, track_b, status, started_at, ends_at)
	values (p_tenant_id, p_event_id, v_a, v_b, 'live', now(),
	        now() + make_interval(mins => greatest(1, p_minutes)))
	returning * into v_battle;

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id, new_data)
	values (p_tenant_id, p_actor_uid, 'start_battle', 'live_battles', v_battle.id,
	        jsonb_build_object('minutes', p_minutes));

	return jsonb_build_object('ok', true, 'battle_id', v_battle.id,
		'ends_at', v_battle.ends_at);
end;
$$;
revoke execute on function public.admin_start_battle(uuid, uuid, uuid, int) from public, anon, authenticated;
grant  execute on function public.admin_start_battle(uuid, uuid, uuid, int) to service_role;

-- 6.6 Autocierre de batallas vencidas (lo invoca el poll de Admin/TV).
--     El UPDATE dispara Realtime → todas las UIs vuelven a la normalidad.
create or replace function public.resolve_due_battles(
	p_tenant_id uuid
) returns int
language plpgsql security definer set search_path = public
as $$
declare
	v_count int := 0;
	v_b record;
	v_va int; v_vb int; v_winner uuid;
begin
	for v_b in
		select * from public.live_battles
		where tenant_id = p_tenant_id and status = 'live' and ends_at <= now()
		for update
	loop
		select total_votes into v_va from public.event_tracks where id = v_b.track_a;
		select total_votes into v_vb from public.event_tracks where id = v_b.track_b;
		v_winner := case when coalesce(v_vb,0) > coalesce(v_va,0)
		                 then v_b.track_b else v_b.track_a end;
		update public.live_battles
		set status = 'closed', winner_track = v_winner
		where id = v_b.id;
		v_count := v_count + 1;
	end loop;
	return v_count;
end;
$$;
revoke execute on function public.resolve_due_battles(uuid) from public, anon, authenticated;
grant  execute on function public.resolve_due_battles(uuid) to service_role;

-- 6.6b Forzar cierre manual (plan B del DJ si el iPad/TV se apaga y el poll
--      no dispara el autocierre).  Cierra la batalla viva del evento ya.
create or replace function public.admin_force_close_battle(
	p_tenant_id uuid,
	p_actor_uid uuid,
	p_event_id  uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
	v_b record; v_va int; v_vb int; v_winner uuid;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	select * into v_b from public.live_battles
	where tenant_id = p_tenant_id and event_id = p_event_id and status = 'live'
	order by started_at desc limit 1
	for update;
	if not found then
		return jsonb_build_object('ok', false, 'error', 'no_live_battle');
	end if;

	select total_votes into v_va from public.event_tracks where id = v_b.track_a;
	select total_votes into v_vb from public.event_tracks where id = v_b.track_b;
	v_winner := case when coalesce(v_vb,0) > coalesce(v_va,0)
	                 then v_b.track_b else v_b.track_a end;

	update public.live_battles
	set status = 'closed', winner_track = v_winner, ends_at = now()
	where id = v_b.id;

	insert into public.audit_logs (tenant_id, actor_id, action, table_name, record_id)
	values (p_tenant_id, p_actor_uid, 'force_close_battle', 'live_battles', v_b.id);

	return jsonb_build_object('ok', true, 'battle_id', v_b.id, 'winner_track', v_winner);
end;
$$;
revoke execute on function public.admin_force_close_battle(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.admin_force_close_battle(uuid, uuid, uuid) to service_role;

-- 6.7 Métricas en vivo para el panel del DJ (polling, no WebSocket en móvil)
create or replace function public.get_admin_metrics(
	p_tenant_id uuid,
	p_actor_uid uuid,
	p_event_id  uuid
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
	v_votes int; v_spent int; v_checkins int; v_players int;
begin
	if not public.is_tenant_staff(p_tenant_id, p_actor_uid) then
		return jsonb_build_object('ok', false, 'error', 'forbidden');
	end if;

	select coalesce(sum(total_votes),0) into v_votes
	from public.event_tracks where event_id = p_event_id and tenant_id = p_tenant_id;

	select coalesce(-sum(amount),0) into v_spent
	from public.wallet_ledger
	where tenant_id = p_tenant_id and amount < 0
	  and public.business_night(created_at) = public.business_night(now());

	select count(*) into v_checkins
	from public.venue_visits
	where tenant_id = p_tenant_id
	  and public.business_night(entry_time) = public.business_night(now());

	select count(distinct user_id) into v_players
	from public.track_votes
	where tenant_id = p_tenant_id and event_id = p_event_id;

	return jsonb_build_object('ok', true,
		'total_votes', v_votes,
		'tokens_spent_today', v_spent,
		'checkins_today', v_checkins,
		'active_players', v_players);
end;
$$;
revoke execute on function public.get_admin_metrics(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.get_admin_metrics(uuid, uuid, uuid) to service_role;


-- =========================================================================
--  7. REALTIME quirúrgico — SOLO event_tracks + live_battles
--     (event_tracks ya estaba; behavior_events se DEJA para analítica;
--      los clientes móviles NO deben suscribirse a behavior_events.)
-- =========================================================================

do $$
begin
	if not exists (
		select 1 from pg_publication_tables
		where pubname = 'supabase_realtime' and schemaname = 'public'
		  and tablename = 'live_battles'
	) then
		alter publication supabase_realtime add table public.live_battles;
	end if;
end $$;

-- RLS para la ASIMETRÍA del dashboard: el iPad del staff se suscribe a
-- behavior_events y Realtime evalúa la política SELECT por cada fila.  Sin
-- esto sólo verían sus propios eventos (behavior_events_self_read).  Esta
-- política deja al staff ESCUCHAR todo su tenant — y SOLO el suyo
-- (current_tenant_id() deriva del JWT del propio staff) → aislamiento B2B2C.
drop policy if exists behavior_events_staff_read on public.behavior_events;
create policy behavior_events_staff_read on public.behavior_events
	for select using (
		tenant_id = public.current_tenant_id()
		and public.is_tenant_staff(tenant_id, auth.uid())
	);
