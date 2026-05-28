-- ─────────────────────────────────────────────────────────────────────────
--   Nightgraph · Loyalty Tiers + Product Rule Engine  (Pilot Scope)
--
--   Objetivo de la migración (recorte táctico de alcance · piloto mañana):
--
--     1. tenant_tier_thresholds   — catálogo de niveles configurable por
--        tenant (no constantes globales).
--     2. Seed mínimo para 'lapocha' (Bronce/Plata/Oro/Platino).
--     3. tenant_products          — nuevas columnas de restricción
--        (min_tier_required, available_days, max_per_*).  NULL = "sin
--        límite", para compatibilidad con productos ya seedeados.
--     4. get_user_tier(p_tenant_id, p_lifetime_earned) -> text
--        Helper puro y stable: devuelve el código de tier alcanzado por
--        un lifetime_earned dado.  Defense in depth para validación
--        server-side.
--     5. purchase_reward          — CREATE OR REPLACE sobre la firma
--        existente.  Añade validación de tier + día + límite por noche/
--        semana/mes ANTES de cobrar.  Si las columnas de restricción
--        son NULL, la regla se omite (back-compat con catálogo actual).
--
--   Fuera de alcance (Fase 2 según el Architecture Proposal aprobado):
--     - user_tier_status (downgrade temporal Platino).
--     - bootstrap_session RPC.
--     - Realtime tier-up.
--     - Triggers de behavior_events → maintenance_progress.
--
--   Run AFTER `database/07_growth_and_realtime.sql`.  Idempotente.
-- ─────────────────────────────────────────────────────────────────────────


-- =========================================================================
--  1. tenant_tier_thresholds — catálogo de niveles por tenant
-- =========================================================================

create table if not exists public.tenant_tier_thresholds (
	tenant_id      uuid     not null references public.tenants(id) on delete cascade,
	tier_code      text     not null check (tier_code in ('bronce','plata','oro','platino')),
	min_lifetime   int      not null check (min_lifetime >= 0),
	display_name   text     not null,
	color_primary  text     not null,
	color_accent   text     not null,
	badge_emoji    text,
	sort_order     smallint not null,
	primary key (tenant_id, tier_code)
);

create index if not exists tenant_tier_thresholds_tenant_idx
	on public.tenant_tier_thresholds (tenant_id, sort_order);

alter table public.tenant_tier_thresholds enable row level security;

drop policy if exists tenant_tier_thresholds_read on public.tenant_tier_thresholds;
create policy tenant_tier_thresholds_read on public.tenant_tier_thresholds
	for select using (tenant_id = public.current_tenant_id());

drop policy if exists tenant_tier_thresholds_write on public.tenant_tier_thresholds;
create policy tenant_tier_thresholds_write on public.tenant_tier_thresholds
	for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists tenant_tier_thresholds_update on public.tenant_tier_thresholds;
create policy tenant_tier_thresholds_update on public.tenant_tier_thresholds
	for update using (tenant_id = public.current_tenant_id())
	with check (tenant_id = public.current_tenant_id());


-- =========================================================================
--  2. Seed mínimo para 'lapocha'
--     Bronce(0) → Plata(500) → Oro(1500) → Platino(4000)
-- =========================================================================

insert into public.tenant_tier_thresholds
	(tenant_id, tier_code, min_lifetime, display_name,
	 color_primary, color_accent, badge_emoji, sort_order)
select
	t.id, v.tier_code, v.min_lifetime, v.display_name,
	v.color_primary, v.color_accent, v.badge_emoji, v.sort_order
from public.tenants t
join (values
	('bronce',     0, 'Bronce',  '#CD7F32', '#A0522D', '🥉', 1),
	('plata',    500, 'Plata',   '#C0C0C0', '#9CA3AF', '🥈', 2),
	('oro',     1500, 'Oro',     '#FFD700', '#FFA500', '🥇', 3),
	('platino', 4000, 'Platino', '#E5E4E2', '#7DF9FF', '💎', 4)
) as v(tier_code, min_lifetime, display_name,
       color_primary, color_accent, badge_emoji, sort_order) on true
where t.slug = 'lapocha'
on conflict (tenant_id, tier_code) do nothing;


-- =========================================================================
--  3. tenant_products — columnas de restricción
--     Todas opcionales (NULL = "sin límite") para preservar el catálogo
--     seedeado existente.  La lógica de la RPC respeta los NULLs.
-- =========================================================================

alter table public.tenant_products
	add column if not exists min_tier_required text,    -- 'bronce'|'plata'|'oro'|'platino'|NULL
	add column if not exists available_days    smallint[], -- ISO 1=Mon..7=Sun, NULL = cualquier día
	add column if not exists max_per_night     smallint,   -- canjes máximos de ESTE producto por noche-business
	add column if not exists max_per_week      smallint,   -- rolling 7 días
	add column if not exists max_per_month     smallint;   -- rolling 30 días

-- Validamos consistencia del valor textual del tier para que un INSERT
-- erróneo no pase desapercibido y rompa la RPC en tiempo de ejecución.
do $$
begin
	if not exists (
		select 1 from pg_constraint
		where conname = 'tenant_products_min_tier_chk'
	) then
		alter table public.tenant_products
			add constraint tenant_products_min_tier_chk
			check (
				min_tier_required is null
				or min_tier_required in ('bronce','plata','oro','platino')
			);
	end if;
end $$;

-- Índice parcial: catálogo filtrado por tier en cliente "Vendedor de pisos"
-- (queries del tipo `WHERE tenant_id = ? AND min_tier_required IS NULL`).
create index if not exists tenant_products_min_tier_idx
	on public.tenant_products (tenant_id, min_tier_required)
	where is_active = true;


-- =========================================================================
--  4. business_night helper
--     "Una misma noche" = mismo bloque entre las 06:00 → 06:00 del día
--     siguiente en zona Europe/Madrid.  Sirve para que canjear a las
--     23:00 sábado y a las 02:00 domingo cuenten como la misma noche.
--
--     Multi-timezone queda como Fase 2 (cuando un tenant esté fuera de
--     Madrid añadiremos tenants.timezone y haremos override).
-- =========================================================================

create or replace function public.business_night(p_ts timestamptz)
returns date
language sql immutable as $$
	select (((p_ts at time zone 'Europe/Madrid') - interval '6 hours')::date)
$$;


-- =========================================================================
--  5. get_user_tier — helper puro
--     Devuelve el tier_code más alto cuyo min_lifetime <= lifetime
--     del usuario.  STABLE + SECURITY DEFINER para que el cliente
--     pueda invocarlo a través de RPC sin abrir SELECT directo sobre
--     tenant_tier_thresholds.
-- =========================================================================

create or replace function public.get_user_tier(
	p_tenant_id       uuid,
	p_lifetime_earned int
) returns text
language sql stable
security definer
set search_path = public
as $$
	select tier_code
	from public.tenant_tier_thresholds
	where tenant_id = p_tenant_id
	  and min_lifetime <= coalesce(p_lifetime_earned, 0)
	order by sort_order desc
	limit 1
$$;

revoke execute on function public.get_user_tier(uuid, int)
	from public, anon, authenticated;
grant  execute on function public.get_user_tier(uuid, int)
	to service_role;


-- =========================================================================
--  6. purchase_reward — CREATE OR REPLACE (firma idéntica)
--
--     Cadena de validación, en este orden (el primer fallo aborta):
--       (1) producto existe + activo + tenant correcto
--       (2) usuario existe (FOR UPDATE → TOCTOU lock)
--       (3) tier mínimo (si product.min_tier_required NOT NULL)
--       (4) día permitido en ISO weekday Europe/Madrid (si available_days NOT NULL)
--       (5) max_per_night sobre business_night (si NOT NULL)
--       (6) max_per_week rolling 7d (si NOT NULL)
--       (7) max_per_month rolling 30d (si NOT NULL)
--       (8) saldo suficiente
--
--     Mensajes de excepción cuidadosamente alineados con los
--     `msg.includes('saldo' | 'producto')` que api.rewards.ts ya
--     mapea a errores semánticos.  Mensajes nuevos viajarán como
--     `rpc_failed` con `detail`, suficiente para el piloto.
-- =========================================================================

create or replace function public.purchase_reward(
	p_tenant_id  uuid,
	p_user_id    uuid,
	p_product_id uuid,
	p_event_id   uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_product       record;
	v_balance       int;
	v_lifetime      int;
	v_user_tier     text;
	v_user_ord      smallint;
	v_req_ord       smallint;
	v_iso_dow       smallint;
	v_count         int;
	v_reward_id     uuid;
begin
	-- (1) Producto
	select * into v_product
	from public.tenant_products
	where id = p_product_id
	  and tenant_id = p_tenant_id
	  and is_active = true;
	if not found then
		raise exception 'Producto no encontrado o inactivo';
	end if;

	-- (2) Usuario + lock pesimista para evitar dobles compras simultáneas
	select token_balance, lifetime_earned
	  into v_balance, v_lifetime
	from public.user_profiles
	where id = p_user_id and tenant_id = p_tenant_id
	for update;
	if not found then
		raise exception 'Perfil de usuario no encontrado';
	end if;

	-- (3) Tier mínimo
	if v_product.min_tier_required is not null then
		v_user_tier := public.get_user_tier(p_tenant_id, v_lifetime);

		select sort_order into v_user_ord
		from public.tenant_tier_thresholds
		where tenant_id = p_tenant_id and tier_code = v_user_tier;

		select sort_order into v_req_ord
		from public.tenant_tier_thresholds
		where tenant_id = p_tenant_id and tier_code = v_product.min_tier_required;

		if v_user_ord is null or v_req_ord is null or v_user_ord < v_req_ord then
			raise exception
				'Nivel insuficiente: requiere %, tienes %',
				v_product.min_tier_required, coalesce(v_user_tier, 'ninguno');
		end if;
	end if;

	-- (4) Día permitido
	if v_product.available_days is not null
	   and array_length(v_product.available_days, 1) > 0 then
		v_iso_dow := extract(isodow from (now() at time zone 'Europe/Madrid'))::smallint;
		if not (v_iso_dow = any(v_product.available_days)) then
			raise exception 'Producto no disponible hoy (ISO dow = %)', v_iso_dow;
		end if;
	end if;

	-- (5) Límite por noche-business
	if v_product.max_per_night is not null then
		select count(*) into v_count
		from public.user_rewards
		where tenant_id   = p_tenant_id
		  and user_id     = p_user_id
		  and product_id  = p_product_id
		  and status      in ('available','redeeming','consumed')
		  and public.business_night(created_at) = public.business_night(now());
		if v_count >= v_product.max_per_night then
			raise exception
				'Límite por noche alcanzado (% de %)',
				v_count, v_product.max_per_night;
		end if;
	end if;

	-- (6) Límite semanal (rolling 7d)
	if v_product.max_per_week is not null then
		select count(*) into v_count
		from public.user_rewards
		where tenant_id   = p_tenant_id
		  and user_id     = p_user_id
		  and product_id  = p_product_id
		  and status      in ('available','redeeming','consumed')
		  and created_at  >= now() - interval '7 days';
		if v_count >= v_product.max_per_week then
			raise exception
				'Límite semanal alcanzado (% de %)',
				v_count, v_product.max_per_week;
		end if;
	end if;

	-- (7) Límite mensual (rolling 30d)
	if v_product.max_per_month is not null then
		select count(*) into v_count
		from public.user_rewards
		where tenant_id   = p_tenant_id
		  and user_id     = p_user_id
		  and product_id  = p_product_id
		  and status      in ('available','redeeming','consumed')
		  and created_at  >= now() - interval '30 days';
		if v_count >= v_product.max_per_month then
			raise exception
				'Límite mensual alcanzado (% de %)',
				v_count, v_product.max_per_month;
		end if;
	end if;

	-- (8) Saldo
	if v_balance < v_product.price_tokens then
		raise exception 'Saldo insuficiente';
	end if;

	-- (9) Asiento contable con snapshot precio+nombre
	insert into public.wallet_ledger (
		tenant_id, user_id, amount, reason, event_id, product_id,
		product_name_at_time, price_tokens_at_time
	) values (
		p_tenant_id, p_user_id, -(v_product.price_tokens), 'reward_purchase',
		p_event_id, p_product_id,
		v_product.name, v_product.price_tokens
	);

	-- (10) Emitir reward — el trigger sobre wallet_ledger ya recalculó
	--      token_balance, pero devolvemos el computed para que el
	--      cliente no tenga que releer.
	insert into public.user_rewards (tenant_id, user_id, product_id, event_id, status)
	values (p_tenant_id, p_user_id, p_product_id, p_event_id, 'available')
	returning id into v_reward_id;

	return jsonb_build_object(
		'reward_id',    v_reward_id,
		'new_balance',  v_balance - v_product.price_tokens,
		'product_name', v_product.name,
		'product_id',   v_product.id
	);
end;
$$;

-- Re-aplicar lockdown — CREATE OR REPLACE conserva los GRANT existentes
-- en la mayoría de versiones de Postgres, pero somos defensivos.
revoke execute on function public.purchase_reward(uuid, uuid, uuid, uuid)
	from public, anon, authenticated;
grant  execute on function public.purchase_reward(uuid, uuid, uuid, uuid)
	to service_role;


-- =========================================================================
--  Idempotencia
--  Esta migración puede re-ejecutarse de forma segura:
--    · CREATE TABLE / ALTER TABLE con IF NOT EXISTS
--    · INSERT seed con ON CONFLICT DO NOTHING
--    · Funciones con CREATE OR REPLACE
--    · CHECK constraint protegido por DO $$ ... pg_constraint exists $$
-- =========================================================================
