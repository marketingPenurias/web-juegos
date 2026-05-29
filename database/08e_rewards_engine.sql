-- ─────────────────────────────────────────────────────────────────────────
--   Nightgraph · 08e — Rewards Engine (Server-Authoritative)
--
--   Cierra las fugas de "Client-Side Trust" detectadas en la auditoría:
--
--     1. Crea `tenant_token_rewards` (NO existía en producción — las
--        migraciones 08c/08d nunca se aplicaron) y la siembra con la
--        economía oficial (Tabla 5 / BRONZE.pdf).
--
--     2. `claim_gamification_reward(p_user_id, p_event_code)` — RPC
--        maestro de INGRESOS.  Lee el premio de la BD, valida el límite
--        diario por `business_night` (timezone del tenant, Madrid) sobre
--        `wallet_ledger`, e inserta atómicamente.  El cliente NUNCA
--        decide el amount.
--
--     3. `vote_track` endurecido: el coste del boost se lee de
--        `tenant_token_rewards` server-side; el `p_tokens_spent` que
--        manda el cliente se IGNORA (se conserva en la firma por
--        compatibilidad con el handler actual).  Cierra el "boost a 0".
--
--     4. `grant_signup_bonus` — recreado aquí porque tampoco existía en
--        producción (nuevos usuarios empezaban con 0 tokens).
--
--   Idempotente.  Run AFTER el esquema base + 06_music_rpc + 08_loyalty.
-- ─────────────────────────────────────────────────────────────────────────


-- =========================================================================
--  1. tenant_token_rewards (economía externalizada + límite diario)
-- =========================================================================

create table if not exists public.tenant_token_rewards (
	tenant_id   uuid    not null references public.tenants(id) on delete cascade,
	event_code  text    not null,
	amount      int     not null,          -- > 0 gana · < 0 gasta (boost)
	daily_limit int,                        -- nº de veces/business_night. null = sin tope (gasta o se controla aparte)
	description text    not null default '',
	is_active   boolean not null default true,
	updated_at  timestamptz not null default now(),
	primary key (tenant_id, event_code)
);

-- Si la tabla ya existía sin `daily_limit` (entorno parcial), añadirla.
alter table public.tenant_token_rewards
	add column if not exists daily_limit int;

create index if not exists tenant_token_rewards_active_idx
	on public.tenant_token_rewards (tenant_id) where is_active = true;

alter table public.tenant_token_rewards enable row level security;

drop policy if exists tenant_token_rewards_read on public.tenant_token_rewards;
create policy tenant_token_rewards_read on public.tenant_token_rewards
	for select using (tenant_id = public.current_tenant_id());


-- =========================================================================
--  2. Seed económico de 'lapocha' (Tabla 5 / BRONZE.pdf)
--     amount > 0 → reclamable vía claim_gamification_reward
--     amount < 0 → coste de boost, leído por vote_track (no reclamable)
-- =========================================================================

insert into public.tenant_token_rewards
	(tenant_id, event_code, amount, daily_limit, description)
select t.id, v.event_code, v.amount, v.daily_limit, v.description
from public.tenants t
join (values
	('signup_bonus',      100, null::int, 'Regalo de bienvenida al registrarte'),
	('checkin_la_pocha',   50, 1,         'Check-in en La Pocha'),
	('ruleta_spin',        15, 1,         'Premio fijo por girar la ruleta (1/noche)'),
	('tinder_completion',  25, 1,         'Completar Tinder Musical (1/noche)'),
	('livebattle_vote',    10, 1,         'Votar en la batalla de temas (1/noche)'),
	('jukebox_request',    20, 1,         'Pedir una canción al DJ (1/noche)'),
	('reto_mesa',          40, 1,         'Participar en reto de mesa (1/noche)'),
	('friend_referral',   100, null::int, 'Amigo registrado que invitaste'),
	('tinder_vote_free',    0, null::int, 'Voto libre en Tinder Musical (sin coste)'),
	('jukebox_boost',     -50, null::int, 'Coste de Boost en Jukebox'),
	('livebattle_boost',  -30, null::int, 'Coste de Boost en Live Battle')
) as v(event_code, amount, daily_limit, description) on true
where t.slug = 'lapocha'
on conflict (tenant_id, event_code) do update
	set amount      = excluded.amount,
	    daily_limit = excluded.daily_limit,
	    description = excluded.description,
	    is_active   = true,
	    updated_at  = now();


-- =========================================================================
--  3. claim_gamification_reward — RPC MAESTRO de ingresos
--
--     Contrato:
--       · Resuelve el tenant del perfil y bloquea la fila (FOR UPDATE)
--         para serializar reclamaciones concurrentes del mismo usuario.
--       · Lee el premio activo de tenant_token_rewards.  amount<=0 →
--         no reclamable (boosts/free).
--       · Si daily_limit NOT NULL: cuenta filas de hoy (business_night)
--         con reason=event_code.  Si alcanzado → {ok:false,
--         error:'daily_limit_reached'} + balance actual (la UI optimista
--         se corrige).
--       · Inserta +amount en wallet_ledger (el trigger materializa
--         token_balance / lifetime_earned).
--       · Devuelve SIEMPRE el balance autoritativo (éxito o fallo).
-- =========================================================================

create or replace function public.claim_gamification_reward(
	p_user_id    uuid,
	p_event_code text,
	p_event_id   uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_tenant_id  uuid;
	v_balance    int;
	v_lifetime   int;
	v_amount     int;
	v_limit      int;
	v_count      int;
	v_ledger_id  bigint;
begin
	-- 1. Perfil + lock pesimista (serializa claims concurrentes).
	select tenant_id, token_balance, lifetime_earned
	  into v_tenant_id, v_balance, v_lifetime
	from public.user_profiles
	where id = p_user_id
	for update;
	if v_tenant_id is null then
		return jsonb_build_object('ok', false, 'error', 'profile_not_found');
	end if;

	-- 2. Regla de economía (server-authoritative).
	select amount, daily_limit
	  into v_amount, v_limit
	from public.tenant_token_rewards
	where tenant_id = v_tenant_id
	  and event_code = p_event_code
	  and is_active = true;

	if v_amount is null then
		return jsonb_build_object(
			'ok', false, 'error', 'unknown_reward', 'balance', v_balance);
	end if;
	if v_amount <= 0 then
		-- boosts y votos-free no son ingresos reclamables por esta vía.
		return jsonb_build_object(
			'ok', false, 'error', 'not_claimable', 'balance', v_balance);
	end if;

	-- 3. Límite diario por noche-business (timezone Madrid via business_night).
	if v_limit is not null then
		select count(*) into v_count
		from public.wallet_ledger
		where tenant_id = v_tenant_id
		  and user_id   = p_user_id
		  and reason    = p_event_code
		  and public.business_night(created_at) = public.business_night(now());
		if v_count >= v_limit then
			return jsonb_build_object(
				'ok', false,
				'error', 'daily_limit_reached',
				'balance', v_balance,
				'limit', v_limit);
		end if;
	end if;

	-- 4. Asentar el ingreso (el trigger recalcula balance + lifetime).
	insert into public.wallet_ledger (
		tenant_id, user_id, amount, reason, event_id, metadata
	) values (
		v_tenant_id, p_user_id, v_amount, p_event_code, p_event_id,
		jsonb_build_object('source', 'claim_gamification_reward')
	)
	returning id into v_ledger_id;

	-- 5. Releer balance autoritativo.
	select token_balance, lifetime_earned
	  into v_balance, v_lifetime
	from public.user_profiles
	where id = p_user_id;

	return jsonb_build_object(
		'ok', true,
		'amount', v_amount,
		'reason', p_event_code,
		'ledger_id', v_ledger_id,
		'balance', v_balance,
		'lifetime_earned', v_lifetime);
end;
$$;

revoke execute on function public.claim_gamification_reward(uuid, text, uuid)
	from public, anon, authenticated;
grant  execute on function public.claim_gamification_reward(uuid, text, uuid)
	to service_role;


-- =========================================================================
--  4. vote_track endurecido — coste de boost server-authoritative
--
--     Misma firma (compat con music-handler.server.ts).  Diferencias:
--       · El coste del boost se RESUELVE de tenant_token_rewards según
--         p_boost_code; el p_tokens_spent del cliente se IGNORA.
--       · Cierra "boost a 0": un boost SIEMPRE cuesta lo que diga la BD.
--       · Si no hay regla de coste → trata el voto como 'free' (no cobra
--         de más; nunca regala +5 sin cobrar).
-- =========================================================================

-- IMPORTANTE: la firma antigua de 6 args (sin p_boost_code) es un
-- OVERLOAD distinto en Postgres y seguiría existiendo — y es la versión
-- vulnerable que confía en el coste del cliente.  La eliminamos para que
-- sólo quede la versión endurecida.
drop function if exists public.vote_track(uuid, uuid, uuid, uuid, text, int);

create or replace function public.vote_track(
	p_tenant_id    uuid,
	p_user_id      uuid,
	p_event_id     uuid,
	p_track_id     uuid,
	p_vote_type    text default 'free',
	p_tokens_spent int  default 0,          -- IGNORADO para boost (compat)
	p_boost_code   text default 'livebattle_boost'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_track   record;
	v_balance int;
	v_vote_id uuid;
	v_delta   int;
	v_cost    int := 0;   -- coste real (positivo) resuelto server-side
begin
	-- 1. Validación de tipo
	if p_vote_type not in ('free', 'boost') then
		raise exception 'invalid_vote_type';
	end if;

	-- 2. Lock de la pista + verificación de que es votable
	select * into v_track
	from public.event_tracks
	where id = p_track_id
	  and event_id = p_event_id
	  and tenant_id = p_tenant_id
	  and is_played = false
	for update;
	if not found then
		raise exception 'track_unavailable';
	end if;

	-- 3. Dedupe (el índice único es el backstop)
	if exists (
		select 1 from public.track_votes
		where track_id = p_track_id and user_id = p_user_id
	) then
		return jsonb_build_object('ok', false, 'error', 'already_voted');
	end if;

	-- 4. BOOST: coste SERVER-AUTHORITATIVE (ignora p_tokens_spent del cliente)
	if p_vote_type = 'boost' then
		select abs(amount) into v_cost
		from public.tenant_token_rewards
		where tenant_id = p_tenant_id
		  and event_code = p_boost_code
		  and is_active = true
		  and amount < 0;

		-- Sin regla de coste configurada → no regalamos +5; degradamos a free.
		if v_cost is null or v_cost = 0 then
			p_vote_type := 'free';
			v_cost := 0;
		else
			select token_balance into v_balance
			from public.user_profiles
			where id = p_user_id and tenant_id = p_tenant_id
			for update;
			if v_balance is null then
				raise exception 'user_profile_not_found';
			end if;
			if v_balance < v_cost then
				return jsonb_build_object(
					'ok', false, 'error', 'insufficient_funds', 'balance', v_balance);
			end if;
			insert into public.wallet_ledger (
				tenant_id, user_id, amount, reason, event_id, metadata, campaign_type
			) values (
				p_tenant_id, p_user_id, -v_cost, p_boost_code, p_event_id,
				jsonb_build_object('track_id', p_track_id), 'song_vote'
			);
		end if;
	end if;

	-- 5. Registrar el voto (tokens_spent = coste real resuelto)
	insert into public.track_votes (
		tenant_id, event_id, track_id, user_id, vote_type, tokens_spent
	) values (
		p_tenant_id, p_event_id, p_track_id, p_user_id, p_vote_type, v_cost
	)
	returning id into v_vote_id;

	-- 6. Sumar votos (boost = +5, free = +1)
	v_delta := case when p_vote_type = 'boost' then 5 else 1 end;
	update public.event_tracks
	set total_votes = total_votes + v_delta
	where id = p_track_id
	returning total_votes into v_track.total_votes;

	if p_vote_type = 'boost' then
		select token_balance into v_balance
		from public.user_profiles where id = p_user_id;
	end if;

	return jsonb_build_object(
		'ok', true,
		'vote_id', v_vote_id,
		'total_votes', v_track.total_votes,
		'vote_type', p_vote_type,
		'balance', v_balance);
end;
$$;

revoke execute on function public.vote_track(uuid, uuid, uuid, uuid, text, int, text)
	from public, anon, authenticated;
grant  execute on function public.vote_track(uuid, uuid, uuid, uuid, text, int, text)
	to service_role;


-- =========================================================================
--  5. grant_signup_bonus — recreado (no existía en producción)
-- =========================================================================

create or replace function public.grant_signup_bonus(
	p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_tenant_id uuid;
	v_amount    int;
	v_ledger_id bigint;
begin
	select tenant_id into v_tenant_id
	from public.user_profiles where id = p_user_id;
	if v_tenant_id is null then
		return jsonb_build_object('ok', false, 'error', 'profile_not_found');
	end if;

	if exists (
		select 1 from public.wallet_ledger
		where user_id = p_user_id and reason = 'signup_bonus'
	) then
		return jsonb_build_object('ok', true, 'already_granted', true);
	end if;

	select amount into v_amount
	from public.tenant_token_rewards
	where tenant_id = v_tenant_id and event_code = 'signup_bonus' and is_active = true;
	if v_amount is null or v_amount <= 0 then
		return jsonb_build_object('ok', true, 'skipped', true);
	end if;

	insert into public.wallet_ledger (tenant_id, user_id, amount, reason, metadata)
	values (v_tenant_id, p_user_id, v_amount, 'signup_bonus',
	        jsonb_build_object('source', 'jit'))
	returning id into v_ledger_id;

	return jsonb_build_object('ok', true, 'amount', v_amount, 'ledger_id', v_ledger_id);
end;
$$;

revoke execute on function public.grant_signup_bonus(uuid)
	from public, anon, authenticated;
grant  execute on function public.grant_signup_bonus(uuid) to service_role;
