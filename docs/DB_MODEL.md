# Modelo de Base de Datos · NightGraph / La Pocha

**Snapshot de la configuración** (no de los datos) de la BD Supabase/Postgres 17,
generado desde la BD en vivo el **24/07/2026**. Es la referencia completa del
modelo: tablas, columnas, claves, índices, RLS, políticas, triggers, funciones,
realtime, cron y extensiones.

> **Regenerar:** este documento se produce introspectando la BD (proyecto
> `cfxpwsexxwcxogwuykue`) con consultas a `information_schema` / `pg_catalog`
> (`pg_get_functiondef`, `pg_policies`, `pg_indexes`, `pg_constraint`, `cron.job`,
> `pg_publication_tables`). Pídeme "regenera DB_MODEL.md" tras cambios de esquema.

## Índice
1. [Convenciones del modelo](#1-convenciones)
2. [Tablas](#2-tablas) · 3. [Índices](#3-índices) · 4. [RLS y políticas](#4-rls-y-políticas)
5. [Triggers](#5-triggers) · 6. [Funciones / RPCs](#6-funciones--rpcs)
7. [Realtime](#7-realtime) · 8. [Cron](#8-cron-pg_cron) · 9. [Extensiones](#9-extensiones) · 10. [Deuda / notas](#10-deuda-técnica--notas)

---

## product_availability (V21)

El **CUÁNDO** de cada promoción: una fila por producto × nivel × ventana.
Sustituye a `tenant_products.min_tier_required` / `available_days`, que solo
permitían una regla por producto y obligaban a duplicarlo una vez por nivel.

| Columna | Para qué |
|---|---|
| `tier_code` | `null` = todos los niveles |
| `days` smallint[] | ISO dow; se compara contra `business_night()`, no contra el reloj |
| `hour_from` / `hour_to` | `from > to` = la ventana **cruza medianoche** (22→02) |
| `valid_from` / `valid_to` | vigencia — es lo que hace temporal a una campaña |
| `stock_total` / `stock_used` | unidades; se descuenta de forma atómica al comprar |
| `promo_price_eur` | sobrescribe el precio del producto en esta ventana |
| `tokens_per_euro` | sobrescribe la **tasa del nivel** (un drop = todos pagan como Platino) |
| `kind` | `base` \| `flash_drop` \| `happy_hour` \| `campaign` |
| `campaign_code` | identidad estable de la campaña (`FD-20260821-01`) para medirla |

**Funciones**: `matching_rules()` (reglas vigentes para un nivel e instante),
`get_promo_catalog()` (el menú resuelto para un usuario), `purchase_reward()`
(compra; SQLSTATE NG001–NG008 por motivo de rechazo), `create_flash_drop()` /
`end_flash_drop()`, `seed_default_catalog()` (alta de catálogo de una sala nueva).
**Vista**: `campaign_performance` — canjes, usuarios, € regalados, tasa de
consumo en barra e ingreso real por `campaign_code`.

> El coste en tokens **no se almacena**: es `(list_price_eur − promo) × tasa`.
> Por eso un producto existe una sola vez y no una por nivel.

## 1. Convenciones

- **Multi-tenant:** casi todo cuelga de `tenants(id)` vía `tenant_id` con FK
  `ON DELETE CASCADE`. La app real es el tenant `lapocha`.
- **Identidad:** los usuarios finales son filas de `user_profiles` ligadas a
  `auth.users` por `auth_user_id` (Google OAuth). El perfil se crea **JIT** en el
  primer login (`/api/session`) o en el primer check-in (`resolveOrCreateTenantProfile`).
- **RLS:** **todas** las tablas de `public` tienen RLS activo. Las políticas son
  casi todo **SELECT** (lectura acotada por tenant/propietario/staff). **No hay
  políticas de INSERT/UPDATE/DELETE para usuarios**: toda escritura pasa por RPCs
  `SECURITY DEFINER` llamadas con la **service key** desde el worker (Cloudflare).
  → El cliente nunca escribe directo; el servidor es la autoridad.
- **`current_tenant_id()`** = tenant del perfil del `auth.uid()` actual. Es la base
  de casi todas las políticas RLS.
- **`is_tenant_staff(tenant, uid)`** = ¿el usuario es staff activo del local?
- **`business_night(ts)`** = la "noche-negocio": `(ts en Europe/Madrid) − 6h`
  truncado a fecha. Una noche va de **06:00 a 06:00**. Se usa para límites diarios,
  descuentos por día y KPIs (el sábado a las 03:00 sigue siendo "sábado").
- **Dinero (tokens):** `user_profiles.token_balance` / `lifetime_earned` son
  **derivados**: un trigger sobre `wallet_ledger` los recalcula de forma
  **incremental** en cada INSERT. Nunca se editan a mano desde `anon`/`authenticated`
  (lo bloquea `protect_profile_money`). El `wallet_ledger` es la fuente de verdad.
- **Sin ENUMs:** los estados se validan con `CHECK` sobre columnas `text`.

---

## 2. Tablas

23 tablas en `public`, todas con **RLS = on**. Agrupadas por dominio.

### 2.1 Núcleo multi-tenant

**`tenants`** (PK `id`) — un local/discoteca.
- `id uuid` · `slug text` (UNIQUE) · `name text` · `status text` default `active`
  (CHECK `active|paused|churned`) · `theme jsonb` · `promoter_id uuid`→promoters
  (SET NULL) · `features jsonb` (juegos/limites) · `bg_video_url text` · `created_at`

**`tenant_staff`** (PK `id`, UNIQUE `(tenant_id,user_id)`) — roles del personal.
- `tenant_id`→tenants · `user_id uuid`→`auth.users` · `role text`
  (CHECK `admin|manager|door|bar|dj|promoter|display`) · `is_active bool` · `created_at`

**`user_profiles`** (PK `id`, UNIQUE `(tenant_id,auth_user_id)` y `(tenant_id,email)`)
- `id uuid` · `tenant_id`→tenants · `email text` · `display_name` · `acquisition_source`
  · `vip_level int` d1 · `token_balance int` d0 · `lifetime_earned int` d0
  · `auth_user_id uuid` (→auth.users) · `acquisition_campaign_id`→tracking_campaigns
  · `birth_date date` (+18 gate) · `created_at`

### 2.2 Eventos y música

**`tenant_events`** (PK `id`) — una fiesta/noche.
- `tenant_id` · `name` · `start_time` · `end_time` · `status text` default `draft`
  (CHECK `draft|active|closed|scheduled|ended`) · `metadata jsonb` (incluye
  `tv_backdrop`: modo, url, showRanking/showBattle/showNowPlaying de la TV) · `created_at`

**`global_tracks`** (PK `id`, UNIQUE `(tenant_id,spotify_id)`) — catálogo permanente del local.
- `tenant_id` · `spotify_id` · `title` · `artist` · `cover_image_url` · **`genre text`** (V18) · `created_at`

**`event_tracks`** (PK `id`, UNIQUE `(event_id,spotify_id)`) — canciones **copiadas** a un evento.
- `tenant_id` · `event_id`→tenant_events · `spotify_id` · `title` · `artist` · `cover_image_url`
  · `total_votes int` d0 · `is_played bool` d false · `played_at timestamptz` (sello para
  ocultar 2h de la TV) · **`genre text`** (V18) · **`last_vote_at timestamptz`** (desempate V18) · `created_at`
  > ⚠️ Hoy cada evento **duplica** el catálogo (759 filas/evento). Deuda pendiente: pasar a N-a-N contra `global_tracks`.

**`track_votes`** (PK `id`, UNIQUE `(event_id,track_id,user_id)`) — un voto por canción por usuario.
- `tenant_id` · `event_id` · `track_id`→event_tracks · `user_id`→user_profiles
  · `vote_type text` (CHECK `free|boost`) · `tokens_spent int` d0
  · **`context text`** (V19: `jukebox`/`livebattle`/… para el presupuesto de jukebox) · `created_at`

**`live_battles`** (PK `id`) — duelo de 2 temas.
- `tenant_id` · `event_id` · `track_a`/`track_b`/`winner_track`→event_tracks
  · `status text` default `live` · `started_at` · `ends_at` · `created_at`

**`event_templates`** (PK `id`) + **`event_template_tracks`** (PK `id`) — setlists guardados y sus pistas (`position`).

### 2.3 Economía

**`wallet_ledger`** (PK `id bigint`) — **libro contable de tokens (fuente de verdad)**.
- `tenant_id` · `user_id`→user_profiles · `amount int` (+ingreso / −gasto) · `reason text`
  · `metadata jsonb` · `event_id` · `product_id`→tenant_products · `product_name_at_time`
  · `price_tokens_at_time` · `promoter_code_id`→promoter_codes · `campaign_type` · `created_at`

**`tenant_token_rewards`** (PK `(tenant_id,event_code)`) — **economía configurable**.
- `amount int` (+premio / −coste) · `description` · `is_active bool` · `daily_limit int` · `updated_at`
- Códigos actuales (lapocha): `signup_bonus +100`, `checkin_la_pocha +50`,
  `streak_milestone_2/4/8 +50/+100/+300`, `friend_referral +100`, `tinder_completion +25`,
  `ruleta_spin +15`, `livebattle_vote +10`, `reto_mesa +40`, `tinder_vote_free 0`,
  `livebattle_boost −30`, `jukebox_boost −50`, **`jukebox_extra_vote −15`**,
  **`jukebox_free_per_night 5`**, **`jukebox_tokens_per_vote 150`** (V19).
  `jukebox_request` quedó **inactivo** (votar ya no da tokens).

**`tenant_products`** (PK `id`) — catálogo de copas/premios canjeables.
- `product_type text` (CHECK `drink|reward|game_ticket|vip_access`) · `name` · `price_tokens int`
  · `reference_fiat numeric` · `is_active` · `min_tier_required text` (CHECK tiers)
  · `available_days smallint[]` (ISO dow permitidos) · `max_per_night/week/month smallint` · `created_at`

**`user_rewards`** (PK `id`) — recompensa comprada / ticket.
- `user_id` · `product_id`→tenant_products · `event_id` · `status text` default `available`
  (CHECK `available|redeeming|consumed|expired`) · `redeemed_at` · `expires_at` · `created_at`

**`tenant_tier_thresholds`** (PK `(tenant_id,tier_code)`) — niveles de fidelidad.
- `tier_code text` (CHECK `bronce|plata|oro|platino`) · `min_lifetime int` · `display_name`
  · `color_primary/accent` · `badge_emoji` · `sort_order smallint`

### 2.4 Fidelidad / check-in

**`qr_strategies`** (PK `id`, UNIQUE `(tenant_id,code)`) — QRs físicos.
- `code text` · `label` · `kind text` default `mesa` · `reward_event_code text`
  · `max_per_night int` d1 · `is_active`. Activos (lapocha): `POCHA-ENTRADA-01`,
  `POCHA-BANO-01`, `POCHA-BARRA-01` → todos premian `checkin_la_pocha`.

**`venue_visits`** (PK `id`) — cada escaneo/entrada. **Alimenta el KPI de check-ins y la racha semanal.**
- `user_id` · `entry_time` · `exit_time` · `qr_code` · `source` · `created_at`

### 2.5 Growth / analítica

**`tracking_campaigns`** (PK `id`, UNIQUE `(tenant_id,code)`) — atribución (`campaign_type` CHECK `location|promoter|game|social|paid_ads`).
**`promoters`** (PK `id`) · **`promoter_codes`** (PK `id`, `code` UNIQUE) — RRPP y sus comisiones.
**`behavior_events`** (PK `id bigint`) — telemetría de comportamiento (categoría/acción/metadata). La consume el ETL de analytics.
**`audit_logs`** (PK `id`) — traza de acciones de staff (las RPCs `admin_*` escriben aquí).

---

## 3. Índices

Además de los PK/UNIQUE. Los más relevantes por rendimiento:

- `event_tracks`: `idx_event_tracks_rank_tiebreak (event_id, is_played, total_votes DESC, last_vote_at)`
  (ranking + desempate V18), `idx_event_tracks_deck/ranking`, `idx_event_tracks_tenant`.
- `global_tracks`: `idx_global_tracks_genre (tenant_id, genre)` (filtro por género V18).
- `track_votes`: `idx_track_votes_jukebox_budget (tenant_id,user_id,context,created_at) WHERE context='jukebox'`
  (presupuesto V19), `idx_track_votes_user (event_id,user_id)`, UNIQUE `(event_id,track_id,user_id)` y `(track_id,user_id)`.
- `live_battles`: `live_battles_event_live_idx (event_id) WHERE status='live'`.
- `tenant_events`: `idx_tenant_events_active_endtime (end_time) WHERE status='active'` (cron de cierre).
- `user_profiles`: `user_profiles_leaderboard_idx (tenant_id, lifetime_earned DESC)`, `user_profiles_auth_user_idx (auth_user_id) UNIQUE`.
- `wallet_ledger`: `wallet_ledger_tenant_time_idx (tenant_id, created_at DESC)`, `idx_wallet_ledger_analytics (tenant_id, event_id, created_at)`.
- `venue_visits`: `venue_visits_entry_idx (tenant_id, entry_time DESC)`, `venue_visits_user_idx`.
- `tenant_products`: `tenant_products_min_tier_idx (tenant_id, min_tier_required) WHERE is_active`.
- Casi todas las tablas tienen además `*_tenant_idx (tenant_id)`.

---

## 4. RLS y políticas

**Todas** las tablas tienen RLS on. Patrón general (solo lectura; las escrituras van por RPCs service-key):

| Tabla | Política (cmd) | Regla (`USING` / `WITH CHECK`) |
|---|---|---|
| `tenants` | SELECT | `id = current_tenant_id()` |
| `user_profiles` | SELECT / UPDATE | `auth_user_id = auth.uid()` (solo tu perfil) |
| `event_tracks`, `tenant_events`, `live_battles`, `global_tracks`, `event_templates`, `event_template_tracks`, `tenant_products`, `tenant_staff`, `qr_strategies`, `tracking_campaigns`, `promoter_codes` | SELECT | `tenant_id = current_tenant_id()` |
| `global_tracks`, `event_templates`, `event_template_tracks` | SELECT (extra) | Solo `admin` activo del tenant (`tenant_staff … role='admin'`) |
| `track_votes` | SELECT | `auth.uid() = user_id` **o** staff del tenant |
| `wallet_ledger` | SELECT | tu `user_id` **o** staff del tenant |
| `venue_visits`, `behavior_events` | SELECT | tu perfil **o** staff del tenant |
| `user_rewards` | SELECT | `auth.uid() = user_id` |
| `audit_logs` | SELECT / INSERT | `tenant_id = current_tenant_id()` |
| `tenant_tier_thresholds`, `tenant_token_rewards` | SELECT / INSERT / UPDATE | `tenant_id = current_tenant_id()` |

> Nota: las políticas usan rol `public` (aplican a `anon`+`authenticated`). Como el
> cliente nunca hace INSERT/UPDATE directo (salvo `user_profiles` self-update y config
> de tier/rewards), la escritura real vive en las RPCs de §6.

---

## 5. Triggers

- **`user_profiles` · `protect_profile_money_trigger`** (BEFORE UPDATE →
  `protect_profile_money()`): si el rol es `anon`/`authenticated`, revierte cualquier
  cambio a `token_balance`, `lifetime_earned`, `vip_level`, `tenant_id`,
  `auth_user_id`, `acquisition_campaign_id`. (La service key **no** está afectada.)
- **`wallet_ledger` · `wallet_ledger_after_insert`** (AFTER INSERT →
  `update_user_token_balance()`): `token_balance += amount`,
  `lifetime_earned += greatest(amount,0)`. **Incremental** (no recalcula desde cero).

---

## 6. Funciones / RPCs

Todas `SECURITY DEFINER` salvo indicado. `search_path='public'`.

### 6.1 Helpers de identidad / tiempo

```sql
-- INVOKER, IMMUTABLE — la "noche-negocio" (06:00→06:00, Europe/Madrid)
CREATE OR REPLACE FUNCTION public.business_night(p_ts timestamptz) RETURNS date
 LANGUAGE sql IMMUTABLE AS $$
  select (((p_ts at time zone 'Europe/Madrid') - interval '6 hours')::date)
$$;

-- tenant del auth.uid() actual (base de las políticas RLS)
CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT tenant_id FROM public.user_profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- ¿staff activo del local?
CREATE OR REPLACE FUNCTION public.is_tenant_staff(p_tenant_id uuid, p_auth_uid uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  select exists (select 1 from public.tenant_staff
    where tenant_id = p_tenant_id and user_id = p_auth_uid and is_active = true);
$$;

-- tier del usuario según lifetime_earned (bronce→platino)
CREATE OR REPLACE FUNCTION public.get_user_tier(p_tenant_id uuid, p_lifetime_earned integer) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  select tier_code from public.tenant_tier_thresholds
  where tenant_id = p_tenant_id and min_lifetime <= coalesce(p_lifetime_earned, 0)
  order by sort_order desc limit 1
$$;

-- INVOKER — id de tenant por slug
CREATE OR REPLACE FUNCTION public.tenant_id_by_slug(p_slug text) RETURNS uuid
 LANGUAGE sql STABLE AS $$ select id from public.tenants where slug = p_slug limit 1 $$;

-- INVOKER — id de campaña de atribución por código (normaliza a UPPER/trim)
CREATE OR REPLACE FUNCTION public.resolve_tracking_campaign(p_tenant_id uuid, p_code text) RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  select id from public.tracking_campaigns
  where tenant_id = p_tenant_id and is_active = true and code = upper(trim(p_code)) limit 1
$$;
```

### 6.2 Triggers (cuerpos)

```sql
CREATE OR REPLACE FUNCTION public.update_user_token_balance() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
begin
  update public.user_profiles
  set token_balance = token_balance + new.amount,
      lifetime_earned = lifetime_earned + greatest(new.amount, 0)
  where id = new.user_id;
  return new;
end; $$;

CREATE OR REPLACE FUNCTION public.protect_profile_money() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    NEW.token_balance = OLD.token_balance;
    NEW.lifetime_earned = OLD.lifetime_earned;
    NEW.vip_level = OLD.vip_level;
    NEW.tenant_id = OLD.tenant_id;
    NEW.auth_user_id = OLD.auth_user_id;
    NEW.acquisition_campaign_id = OLD.acquisition_campaign_id;
  END IF;
  RETURN NEW;
END; $$;
```

### 6.3 Economía / recompensas

```sql
-- Ingreso gamificado (server-authoritative): valida regla, límite diario por
-- noche-negocio y asienta en wallet_ledger. Usado por process_checkin y /api/rewards.
CREATE OR REPLACE FUNCTION public.claim_gamification_reward(p_user_id uuid, p_event_code text, p_event_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
declare v_tenant_id uuid; v_balance int; v_lifetime int; v_amount int; v_limit int; v_count int; v_ledger_id bigint;
begin
  select tenant_id, token_balance, lifetime_earned into v_tenant_id, v_balance, v_lifetime
  from public.user_profiles where id = p_user_id for update;
  if v_tenant_id is null then return jsonb_build_object('ok', false, 'error', 'profile_not_found'); end if;

  select amount, daily_limit into v_amount, v_limit from public.tenant_token_rewards
  where tenant_id = v_tenant_id and event_code = p_event_code and is_active = true;
  if v_amount is null then return jsonb_build_object('ok', false, 'error', 'unknown_reward', 'balance', v_balance); end if;
  if v_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'not_claimable', 'balance', v_balance); end if;

  if v_limit is not null then
    select count(*) into v_count from public.wallet_ledger
    where tenant_id = v_tenant_id and user_id = p_user_id and reason = p_event_code
      and public.business_night(created_at) = public.business_night(now());
    if v_count >= v_limit then
      return jsonb_build_object('ok', false, 'error', 'daily_limit_reached', 'balance', v_balance, 'limit', v_limit);
    end if;
  end if;

  insert into public.wallet_ledger (tenant_id, user_id, amount, reason, event_id, metadata)
  values (v_tenant_id, p_user_id, v_amount, p_event_code, p_event_id, jsonb_build_object('source','claim_gamification_reward'))
  returning id into v_ledger_id;
  select token_balance, lifetime_earned into v_balance, v_lifetime from public.user_profiles where id = p_user_id;
  return jsonb_build_object('ok', true, 'amount', v_amount, 'reason', p_event_code, 'ledger_id', v_ledger_id, 'balance', v_balance, 'lifetime_earned', v_lifetime);
end; $$;

-- Bono de bienvenida (idempotente por reason='signup_bonus').
CREATE OR REPLACE FUNCTION public.grant_signup_bonus(p_user_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
declare v_tenant_id uuid; v_amount int; v_ledger_id bigint;
begin
  select tenant_id into v_tenant_id from public.user_profiles where id = p_user_id;
  if v_tenant_id is null then return jsonb_build_object('ok', false, 'error', 'profile_not_found'); end if;
  if exists (select 1 from public.wallet_ledger where user_id = p_user_id and reason = 'signup_bonus') then
    return jsonb_build_object('ok', true, 'already_granted', true);
  end if;
  select amount into v_amount from public.tenant_token_rewards
  where tenant_id = v_tenant_id and event_code = 'signup_bonus' and is_active = true;
  if v_amount is null or v_amount <= 0 then return jsonb_build_object('ok', true, 'skipped', true); end if;
  insert into public.wallet_ledger (tenant_id, user_id, amount, reason, metadata)
  values (v_tenant_id, p_user_id, v_amount, 'signup_bonus', jsonb_build_object('source','jit'))
  returning id into v_ledger_id;
  return jsonb_build_object('ok', true, 'amount', v_amount, 'ledger_id', v_ledger_id);
end; $$;

-- Gasto genérico (amount NEGATIVO). Devuelve NULL = saldo insuficiente.
CREATE OR REPLACE FUNCTION public.spend_tokens(p_tenant_id uuid, p_user_id uuid, p_amount integer, p_reason text, p_metadata jsonb DEFAULT '{}') RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
declare v_balance int;
begin
  if p_amount >= 0 then raise exception 'spend_tokens expects a negative amount, got %', p_amount; end if;
  select token_balance into v_balance from public.user_profiles where id = p_user_id and tenant_id = p_tenant_id for update;
  if v_balance is null then raise exception 'user_profile % not found for tenant %', p_user_id, p_tenant_id; end if;
  if v_balance + p_amount < 0 then return null; end if;
  insert into public.wallet_ledger (tenant_id, user_id, amount, reason, metadata)
  values (p_tenant_id, p_user_id, p_amount, p_reason, p_metadata);
  select token_balance into v_balance from public.user_profiles where id = p_user_id;
  return v_balance;
end; $$;

-- Compra de producto/copa. Valida tier, DÍA PERMITIDO (por business_night, fix V18),
-- límites noche/semana/mes y saldo; asienta gasto y emite user_rewards 'available'.
CREATE OR REPLACE FUNCTION public.purchase_reward(p_tenant_id uuid, p_user_id uuid, p_product_id uuid, p_event_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
declare v_product record; v_balance int; v_lifetime int; v_user_tier text; v_user_ord smallint; v_req_ord smallint; v_iso_dow smallint; v_count int; v_reward_id uuid;
begin
  select * into v_product from public.tenant_products where id = p_product_id and tenant_id = p_tenant_id and is_active = true;
  if not found then raise exception 'Producto no encontrado o inactivo'; end if;
  select token_balance, lifetime_earned into v_balance, v_lifetime from public.user_profiles where id = p_user_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'Perfil de usuario no encontrado'; end if;
  if v_product.min_tier_required is not null then
    v_user_tier := public.get_user_tier(p_tenant_id, v_lifetime);
    select sort_order into v_user_ord from public.tenant_tier_thresholds where tenant_id = p_tenant_id and tier_code = v_user_tier;
    select sort_order into v_req_ord  from public.tenant_tier_thresholds where tenant_id = p_tenant_id and tier_code = v_product.min_tier_required;
    if v_user_ord is null or v_req_ord is null or v_user_ord < v_req_ord then
      raise exception 'Nivel insuficiente: requiere %, tienes %', v_product.min_tier_required, coalesce(v_user_tier,'ninguno');
    end if;
  end if;
  if v_product.available_days is not null and array_length(v_product.available_days,1) > 0 then
    v_iso_dow := extract(isodow from public.business_night(now()))::smallint;   -- FIX V18: noche-negocio, no reloj
    if not (v_iso_dow = any(v_product.available_days)) then raise exception 'Producto no disponible hoy (ISO dow = %)', v_iso_dow; end if;
  end if;
  -- max_per_night (por business_night), max_per_week (7d), max_per_month (30d): raise si excede.
  -- … [tres bloques de conteo sobre user_rewards con status in ('available','redeeming','consumed')] …
  if v_balance < v_product.price_tokens then raise exception 'Saldo insuficiente'; end if;
  insert into public.wallet_ledger (tenant_id, user_id, amount, reason, event_id, product_id, product_name_at_time, price_tokens_at_time)
  values (p_tenant_id, p_user_id, -(v_product.price_tokens), 'reward_purchase', p_event_id, p_product_id, v_product.name, v_product.price_tokens);
  insert into public.user_rewards (tenant_id, user_id, product_id, event_id, status)
  values (p_tenant_id, p_user_id, p_product_id, p_event_id, 'available') returning id into v_reward_id;
  return jsonb_build_object('reward_id', v_reward_id, 'new_balance', v_balance - v_product.price_tokens, 'product_name', v_product.name, 'product_id', v_product.id);
end; $$;

-- Canje de ticket: available → redeeming (5 min de ventana).
CREATE OR REPLACE FUNCTION public.start_reward_redemption(p_tenant_id uuid, p_user_id uuid, p_reward_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
declare v_reward record;
begin
  update public.user_rewards set status='redeeming', redeemed_at=now(), expires_at=now()+interval '5 minutes'
  where id=p_reward_id and user_id=p_user_id and tenant_id=p_tenant_id and status='available'
  returning id, expires_at into v_reward;
  if not found then raise exception 'Recompensa no válida, ya canjeada o expirada'; end if;
  return jsonb_build_object('success', true, 'expires_at', v_reward.expires_at);
end; $$;

-- Cierre anti-fraude del ticket: redeeming → consumed (idempotente).
CREATE OR REPLACE FUNCTION public.complete_redemption(p_tenant_id uuid, p_user_id uuid, p_reward_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
declare v_status text; v_now timestamptz := now();
begin
  select status into v_status from public.user_rewards where id=p_reward_id and tenant_id=p_tenant_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'reward_not_found'); end if;
  if v_status = 'consumed'  then return jsonb_build_object('ok', false, 'error', 'already_consumed', 'reward_id', p_reward_id); end if;
  if v_status <> 'redeeming' then return jsonb_build_object('ok', false, 'error', 'not_redeeming', 'status', v_status); end if;
  update public.user_rewards set status='consumed', redeemed_at=v_now where id=p_reward_id and status='redeeming';
  if not found then return jsonb_build_object('ok', false, 'error', 'already_consumed', 'reward_id', p_reward_id); end if;
  return jsonb_build_object('ok', true, 'reward_id', p_reward_id, 'consumed_at', v_now);
end; $$;
```

### 6.4 Música — votos / jukebox / batallas

```sql
-- Votos gratis de jukebox que le quedan al usuario ESTA noche (V19).
--   base 5 (jukebox_free_per_night) + floor(gasto en promos / 150) − usados hoy.
CREATE OR REPLACE FUNCTION public.jukebox_votes_remaining(p_tenant_id uuid, p_user_id uuid) RETURNS integer
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $$
declare v_free int; v_per int; v_spent int; v_earned int; v_used int;
begin
  select amount into v_free from tenant_token_rewards where tenant_id=p_tenant_id and event_code='jukebox_free_per_night' and is_active;
  v_free := coalesce(v_free, 5);
  select amount into v_per  from tenant_token_rewards where tenant_id=p_tenant_id and event_code='jukebox_tokens_per_vote' and is_active;
  v_per := coalesce(nullif(v_per,0), 150);
  select coalesce(sum(-amount),0) into v_spent from wallet_ledger
  where tenant_id=p_tenant_id and user_id=p_user_id and reason='reward_purchase'
    and public.business_night(created_at) = public.business_night(now());
  v_earned := floor(v_spent::numeric / v_per);
  select count(*) into v_used from track_votes
  where tenant_id=p_tenant_id and user_id=p_user_id and context='jukebox' and vote_type='free' and tokens_spent=0
    and public.business_night(created_at) = public.business_night(now());
  return v_free + v_earned - v_used;
end; $$;

-- VOTAR (jukebox / tinder / batalla). vote_type free|boost. boost: coste server
-- desde tenant_token_rewards[p_boost_code] (jukebox_boost −50 / livebattle_boost −30),
-- +5 votos. free: +1. Dedupe por (track,user).
-- Presupuesto V19: SÓLO cuando p_context='jukebox' y free. Si no quedan gratis y
-- p_paid_extra=false → {ok:false,error:'no_free_votes',extra_cost}. Con p_paid_extra=true
-- cobra jukebox_extra_vote (−15). Sella last_vote_at (desempate). Devuelve remaining_free.
CREATE OR REPLACE FUNCTION public.vote_track(
  p_tenant_id uuid, p_user_id uuid, p_event_id uuid, p_track_id uuid,
  p_vote_type text DEFAULT 'free', p_tokens_spent integer DEFAULT 0,
  p_boost_code text DEFAULT 'livebattle_boost',
  p_context text DEFAULT NULL, p_paid_extra boolean DEFAULT false) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
declare v_track record; v_balance int; v_vote_id uuid; v_delta int; v_cost int := 0;
        v_is_jukebox_free boolean; v_remaining int; v_extra_cost int;
begin
  if p_vote_type not in ('free','boost') then raise exception 'invalid_vote_type'; end if;
  select * into v_track from public.event_tracks
  where id=p_track_id and event_id=p_event_id and tenant_id=p_tenant_id and is_played=false for update;
  if not found then raise exception 'track_unavailable'; end if;
  if exists (select 1 from public.track_votes where track_id=p_track_id and user_id=p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'already_voted'); end if;

  v_is_jukebox_free := (p_context='jukebox' and p_vote_type='free');
  if v_is_jukebox_free then
    v_remaining := public.jukebox_votes_remaining(p_tenant_id, p_user_id);
    if v_remaining <= 0 then
      select coalesce(abs(amount),15) into v_extra_cost from public.tenant_token_rewards
      where tenant_id=p_tenant_id and event_code='jukebox_extra_vote' and is_active;
      v_extra_cost := coalesce(v_extra_cost, 15);
      if not p_paid_extra then
        return jsonb_build_object('ok', false, 'error', 'no_free_votes', 'extra_cost', v_extra_cost, 'remaining_free', 0);
      end if;
      select token_balance into v_balance from public.user_profiles where id=p_user_id and tenant_id=p_tenant_id for update;
      if v_balance is null then raise exception 'user_profile_not_found'; end if;
      if v_balance < v_extra_cost then return jsonb_build_object('ok', false, 'error', 'insufficient_funds', 'balance', v_balance); end if;
      insert into public.wallet_ledger (tenant_id,user_id,amount,reason,event_id,metadata,campaign_type)
      values (p_tenant_id,p_user_id,-v_extra_cost,'jukebox_extra_vote',p_event_id,jsonb_build_object('track_id',p_track_id),'song_vote');
      v_cost := v_extra_cost;
    end if;
  end if;

  if p_vote_type='boost' then
    select abs(amount) into v_cost from public.tenant_token_rewards
    where tenant_id=p_tenant_id and event_code=p_boost_code and is_active=true and amount<0;
    if v_cost is null or v_cost=0 then p_vote_type:='free'; v_cost:=0;
    else
      select token_balance into v_balance from public.user_profiles where id=p_user_id and tenant_id=p_tenant_id for update;
      if v_balance is null then raise exception 'user_profile_not_found'; end if;
      if v_balance < v_cost then return jsonb_build_object('ok', false, 'error', 'insufficient_funds', 'balance', v_balance); end if;
      insert into public.wallet_ledger (tenant_id,user_id,amount,reason,event_id,metadata,campaign_type)
      values (p_tenant_id,p_user_id,-v_cost,p_boost_code,p_event_id,jsonb_build_object('track_id',p_track_id),'song_vote');
    end if;
  end if;

  insert into public.track_votes (tenant_id,event_id,track_id,user_id,vote_type,tokens_spent,context)
  values (p_tenant_id,p_event_id,p_track_id,p_user_id,p_vote_type,v_cost,p_context) returning id into v_vote_id;
  v_delta := case when p_vote_type='boost' then 5 else 1 end;
  update public.event_tracks set total_votes=total_votes+v_delta, last_vote_at=now()
  where id=p_track_id returning total_votes into v_track.total_votes;
  if v_cost > 0 then select token_balance into v_balance from public.user_profiles where id=p_user_id; end if;
  v_remaining := case when p_context='jukebox' then public.jukebox_votes_remaining(p_tenant_id,p_user_id) else null end;
  return jsonb_build_object('ok', true, 'vote_id', v_vote_id, 'total_votes', v_track.total_votes,
    'vote_type', p_vote_type, 'balance', v_balance, 'tokens_spent', v_cost, 'remaining_free', v_remaining);
end; $$;
```

**Batallas** (`admin_start_battle` overloaded: auto-pick top-2 o manual con `track_a/track_b`;
`admin_force_close_battle` cierra la viva y proclama ganador; `resolve_due_battles` cierra
todas las vencidas — la llama el cron cada minuto). Empate → gana `track_a`. Ganador por `total_votes`.

```sql
-- Cierra batallas vencidas (ends_at<=now, status='live'). p_tenant_id NULL = todos (cron).
CREATE OR REPLACE FUNCTION public.resolve_due_battles(p_tenant_id uuid DEFAULT NULL) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
declare v_count int := 0; v_b record; v_va int; v_vb int; v_winner uuid;
begin
  for v_b in select * from public.live_battles where status='live' and ends_at<=now()
             and (p_tenant_id is null or tenant_id=p_tenant_id) for update loop
    select total_votes into v_va from public.event_tracks where id=v_b.track_a;
    select total_votes into v_vb from public.event_tracks where id=v_b.track_b;
    v_winner := case when coalesce(v_vb,0) > coalesce(v_va,0) then v_b.track_b else v_b.track_a end;
    update public.live_battles set status='closed', winner_track=v_winner where id=v_b.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;
```

### 6.5 Panel DJ / Staff (todas validan `is_tenant_staff` y escriben en `audit_logs`)

- `admin_open_party(tenant, actor, name?)` → crea/devuelve la fiesta activa (10h).
- `admin_set_now_playing(tenant, actor, event, track)` → marca "sonando"; **conserva
  `played_at`** de la anterior (para ocultarla 2h en la TV, fix V17).
- `admin_add_event_track` / `admin_bulk_insert_global` → catálogo → evento (dedupe por spotify_id).
- `admin_save_template` / `admin_apply_template` / `admin_delete_template` → plantillas de setlist.
- `admin_start_battle` (×2) / `admin_force_close_battle` → batallas.
- `get_admin_metrics(tenant, actor, event)` → `{total_votes, tokens_spent_today,
  checkins_today, active_players}` (todo por `business_night`).

### 6.6 Check-in / fidelidad

```sql
-- Procesa un escaneo de QR: valida QR, registra venue_visits, concede recompensa
-- (claim_gamification_reward, respeta max_per_night), calcula racha semanal y, en
-- hitos 2/4/8 semanas, paga streak_milestone_N (una vez).
CREATE OR REPLACE FUNCTION public.process_checkin(p_user_id uuid, p_qr_code text) RETURNS jsonb …
  -- (cuerpo completo en la BD; ver §6.3 claim_gamification_reward + get_user_streak)

-- Racha en SEMANAS consecutivas con visita (venue_visits, Europe/Madrid).
CREATE OR REPLACE FUNCTION public.get_user_streak(p_user_id uuid) RETURNS integer …
```

### 6.7 Mantenimiento (cron)

```sql
-- Cierra eventos vencidos (active + end_time<now → ended). p_tenant_id NULL = todos.
CREATE OR REPLACE FUNCTION public.close_due_events(p_tenant_id uuid DEFAULT NULL) RETURNS integer …
```

### 6.8 Analítica (schema `analytics` + espejos `public.ng_get_*`)

Funciones de **reporting** (TABLE, SECURITY DEFINER) — no lógica de negocio, se
consultan para dashboards. Cuerpos completos en la BD (largas consultas de agregación):

- `analytics.run_etl()` — ETL cada 5 min (procesa `behavior_events`).
- `get_live_vibe(tenant)` — flujo de tokens por minuto/ubicación.
- `get_token_economy(tenant)` — emitidos/quemados, ingresos/coste €.
- `get_cohort_retention(tenant)` / `get_event_cohort_retention(tenant)` — retención por cohorte/evento.
- `get_graph_penetration(tenant)` — referidos / LTV / viralidad.
- Espejos ejecutables por RPC: `public.ng_get_live_vibe`, `ng_get_token_economy`,
  `ng_get_cohort_retention`, `ng_get_event_cohort_retention`, `ng_get_graph_penetration`.

---

## 7. Realtime

Publicación `supabase_realtime` incluye (INSERT/UPDATE/DELETE):
`behavior_events`, `event_tracks`, `live_battles`, `tenant_events`, `track_votes`,
`venue_visits`, `wallet_ledger`.

> Nota app: el cliente móvil **no** consume el UPDATE de `event_tracks` (fan-out) →
> usa short-polling. La TV y `/admin` sí escuchan realtime + fallback por polling.

---

## 8. Cron (pg_cron)

| Job | Schedule | Comando |
|---|---|---|
| `nightgraph-analytics-etl` | `*/5 * * * *` | `SELECT analytics.run_etl()` |
| `close-due-events` | `* * * * *` | `select public.close_due_events();` |
| `close-due-battles` | `* * * * *` | `select public.resolve_due_battles();` |

---

## 9. Extensiones

`pg_cron 1.6.4` · `pg_stat_statements 1.11` · `pgcrypto 1.3` · `supabase_vault 0.3.1`
· `uuid-ossp 1.1` (+ `plpgsql`).

---

## 10. Deuda técnica / notas

- **`vote_track` duplicada:** existen 2 overloads (la vieja de 7 args y la nueva de
  9 con `p_context`/`p_paid_extra`). La app llama la de 9. La de 7 es residual — se
  puede `DROP` cuando se confirme que nada la usa.
- **`admin_start_battle` duplicada:** overload auto (top-2) y manual (track_a/track_b).
  El panel usa la manual.
- **`event_tracks` duplica el catálogo por evento** (759 filas/evento). Pendiente:
  modelo N-a-N contra `global_tracks` (elimina duplicación de título/artista/genre).
- **`genre` vive en `global_tracks` y `event_tracks`** (duplicado por lo anterior).
  Con el refactor N-a-N quedaría solo en `global_tracks`.
- Avisos del linter de seguridad (no bloqueantes): varias funciones `SECURITY DEFINER`
  sin `search_path` fijo (las `analytics.*`), y ejecutables por `anon`; bucket público
  `tenant-assets` listable. Ver advisors de Supabase para el detalle.
