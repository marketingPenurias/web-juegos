-- ─────────────────────────────────────────────────────────────────────────
--   Nightgraph · Piloto-Friday Ready (parche unificado)
--
--   Cierra 4 huecos detectados durante el piloto en producción:
--
--     1. CHECK constraint `track_votes_vote_type_check` permitía
--        sólo 'like'/'superlike'/'dislike' (legado de versiones
--        previas), pero los RPCs `vote_track` envían 'free'/'boost'.
--        Resultado: TODOS los flujos que pasan por vote_track
--        (Tinder, Jukebox, Live Battle) explotaban con 500.
--
--     2. Catálogo Bronce alineado con BRONZE.pdf:
--        - 3 chupitos (normal 2€, especial 3€, gratis con 2 copas)
--        - days expandidos a Mar-Sáb para que el piloto del viernes
--          tenga producto canjeable HOY.
--        - El "Chupito Gratis con 2 Copas" original (100 tokens, mal
--          configurado) queda desactivado.
--
--     3. Economía de tokens completa según BRONZE.pdf — premios por
--        acción real (signup +100, check-in +50, ruleta 15, tinder
--        +25, voto +10, jukebox +20, reto +40, amigo +100).  La RPC
--        / handlers leen estos values desde la BD.
--
--     4. Welcome bonus: el JIT del perfil aplica el +100 vía RPC
--        `grant_signup_bonus(p_user_id)` que devuelve el ledger id.
--        Sin esto el nuevo usuario empieza con 0 y no puede canjear
--        nada — el piloto se siente roto desde el primer login.
--
--   Run AFTER `database/08c_economy_and_fixes.sql`.  Idempotente.
-- ─────────────────────────────────────────────────────────────────────────


-- =========================================================================
--  1. Fix: CHECK constraint en track_votes.vote_type
-- =========================================================================

alter table public.track_votes
	drop constraint if exists track_votes_vote_type_check;

alter table public.track_votes
	add constraint track_votes_vote_type_check
	check (vote_type = any (array['free'::text, 'boost'::text]));


-- =========================================================================
--  2. Economía de tokens completa (BRONZE.pdf)
-- =========================================================================

do $$
declare
	v_tenant uuid;
begin
	select id into v_tenant from public.tenants where slug = 'lapocha' limit 1;
	if v_tenant is null then return; end if;

	insert into public.tenant_token_rewards
		(tenant_id, event_code, amount, description)
	select v_tenant, v.event_code, v.amount, v.description
	from (values
		('signup_bonus',       100,  'Regalo de bienvenida al registrarte'),
		('checkin_la_pocha',    50,  'Check-in en La Pocha'),
		('ruleta_spin',         15,  'Premio fijo por girar la ruleta'),
		('tinder_completion',   25,  'Recompensa al completar Tinder Musical'),
		('tinder_vote_free',     0,  'Voto libre en Tinder Musical (sin coste)'),
		('livebattle_vote',     10,  'Voto en batalla de temas'),
		('jukebox_request',     20,  'Pedir una canción al DJ (gratis)'),
		('jukebox_boost',      -50,  'Coste de Boost en Jukebox'),
		('livebattle_boost',   -30,  'Coste de Boost en Live Battle'),
		('reto_mesa',           40,  'Participar en reto de mesa'),
		('friend_referral',    100,  'Amigo registrado que invitaste')
	) as v(event_code, amount, description) on true
	on conflict (tenant_id, event_code) do update
		set amount      = excluded.amount,
			description = excluded.description,
			is_active   = true,
			updated_at  = now();
end $$;


-- =========================================================================
--  3. Catálogo Bronce alineado con BRONZE.pdf
-- =========================================================================

do $$
declare
	v_tenant uuid;
begin
	select id into v_tenant from public.tenants where slug = 'lapocha' limit 1;
	if v_tenant is null then return; end if;

	-- (a) Desactivar el "Chupito Gratis con 2 Copas" original del 08b
	--     (100 tokens / max 1 noche, 2 semana — no coincide con el PDF).
	--     Lo sustituimos con la versión correcta más abajo (300 tokens).
	update public.tenant_products
	set is_active = false
	where tenant_id = v_tenant
	  and name = 'Chupito Gratis con 2 Copas'
	  and price_tokens = 100;

	-- (b) Insertar productos Bronce reales del PDF.
	--     Days expandidos a Mar-Sáb para que el piloto del VIERNES
	--     tenga producto canjeable HOY (el PDF dice Mar-Jue, pero la
	--     dueña ha pedido "tener sentido para el piloto").
	with new_products(
		name, product_type, price_tokens, reference_fiat,
		min_tier_required, available_days,
		max_per_night, max_per_week, max_per_month
	) as (
		values
		(
			'Chupito Normal a 2€',
			'drink',
			150, 2.00,
			null,
			array[2,3,4,5,6]::smallint[],   -- Mar-Sáb
			1::smallint, 1::smallint, null::smallint
		),
		(
			'Chupito Especial a 3€',
			'drink',
			200, 3.00,
			null,
			array[2,3,4,5,6]::smallint[],
			1::smallint, 1::smallint, null::smallint
		),
		(
			'Chupito Gratis con 2 Copas',
			'reward',
			300, 0.00,
			null,
			array[2,3,5,6]::smallint[],     -- Mar/Mié + Vie/Sáb
			1::smallint, null::smallint, 2::smallint
		)
	)
	insert into public.tenant_products (
		tenant_id, name, product_type, price_tokens, reference_fiat,
		is_active, min_tier_required, available_days,
		max_per_night, max_per_week, max_per_month
	)
	select
		v_tenant, p.name, p.product_type, p.price_tokens, p.reference_fiat,
		true, p.min_tier_required, p.available_days,
		p.max_per_night, p.max_per_week, p.max_per_month
	from new_products p
	where not exists (
		select 1
		from public.tenant_products existing
		where existing.tenant_id = v_tenant
		  and existing.name = p.name
	);
end $$;


-- =========================================================================
--  4. Welcome bonus RPC — aplicado por el JIT en /api/session
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
	-- 1. Localizar el tenant del perfil.
	select tenant_id into v_tenant_id
	from public.user_profiles
	where id = p_user_id;
	if v_tenant_id is null then
		return jsonb_build_object('ok', false, 'error', 'profile_not_found');
	end if;

	-- 2. Idempotencia: si ya tiene un signup_bonus en el ledger, no doble bonus.
	if exists (
		select 1 from public.wallet_ledger
		where user_id = p_user_id
		  and reason = 'signup_bonus'
	) then
		return jsonb_build_object('ok', true, 'already_granted', true);
	end if;

	-- 3. Leer el amount configurado en tenant_token_rewards.
	select amount into v_amount
	from public.tenant_token_rewards
	where tenant_id = v_tenant_id
	  and event_code = 'signup_bonus'
	  and is_active = true;
	if v_amount is null or v_amount <= 0 then
		return jsonb_build_object('ok', true, 'skipped', true);
	end if;

	-- 4. Asentar el bonus.  El trigger `wallet_ledger_after_insert`
	--    recalcula token_balance y lifetime_earned.
	insert into public.wallet_ledger (
		tenant_id, user_id, amount, reason, metadata
	) values (
		v_tenant_id, p_user_id, v_amount, 'signup_bonus',
		jsonb_build_object('source', 'jit')
	)
	returning id into v_ledger_id;

	return jsonb_build_object(
		'ok', true,
		'amount', v_amount,
		'ledger_id', v_ledger_id
	);
end;
$$;

revoke execute on function public.grant_signup_bonus(uuid)
	from public, anon, authenticated;
grant  execute on function public.grant_signup_bonus(uuid)
	to service_role;
