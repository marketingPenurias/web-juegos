## Table `audit_logs`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `actor_id` | `uuid` |  |
| `action` | `text` |  |
| `table_name` | `text` |  Nullable |
| `record_id` | `uuid` |  Nullable |
| `old_data` | `jsonb` |  Nullable |
| `new_data` | `jsonb` |  Nullable |
| `ip_address` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `behavior_events`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `tenant_id` | `uuid` |  |
| `visit_id` | `uuid` |  Nullable |
| `user_id` | `uuid` |  Nullable |
| `event_category` | `text` |  |
| `event_action` | `text` |  |
| `metadata` | `jsonb` |  |
| `created_at` | `timestamptz` |  |

## Table `event_tracks`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `event_id` | `uuid` |  |
| `spotify_id` | `text` |  |
| `title` | `text` |  |
| `artist` | `text` |  |
| `cover_image_url` | `text` |  Nullable |
| `total_votes` | `int4` |  |
| `is_played` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `played_at` | `timestamptz` |  Nullable |

## Table `promoter_codes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `staff_id` | `uuid` |  |
| `code` | `text` |  Unique |
| `commission_tokens` | `int4` |  Nullable |
| `commission_percent` | `numeric` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `promoters`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `contact_email` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `tenant_events`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `name` | `text` |  |
| `start_time` | `timestamptz` |  |
| `end_time` | `timestamptz` |  Nullable |
| `status` | `text` |  |
| `created_at` | `timestamptz` |  |

## Table `tenant_products`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `product_type` | `text` |  |
| `name` | `text` |  |
| `price_tokens` | `int4` |  |
| `reference_fiat` | `numeric` |  Nullable |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |

## Table `tenant_staff`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `role` | `text` |  |
| `is_active` | `bool` |  |
| `created_at` | `timestamptz` |  |

## Table `tenants`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `slug` | `text` |  Unique |
| `name` | `text` |  |
| `status` | `text` |  |
| `created_at` | `timestamptz` |  |
| `theme` | `jsonb` |  |
| `promoter_id` | `uuid` |  Nullable |
| `features` | `jsonb` |  |

## Table `track_votes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `event_id` | `uuid` |  |
| `track_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `vote_type` | `text` |  |
| `tokens_spent` | `int4` |  |
| `created_at` | `timestamptz` |  |
| `tenant_id` | `uuid` |  |

## Table `user_profiles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `email` | `text` |  |
| `display_name` | `text` |  Nullable |
| `acquisition_source` | `text` |  Nullable |
| `vip_level` | `int4` |  |
| `created_at` | `timestamptz` |  |
| `token_balance` | `int4` |  |
| `lifetime_earned` | `int4` |  |
| `auth_user_id` | `uuid` |  |

## Table `user_rewards`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `product_id` | `uuid` |  |
| `event_id` | `uuid` |  Nullable |
| `status` | `text` |  |
| `redeemed_at` | `timestamptz` |  Nullable |
| `expires_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `venue_visits`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `entry_time` | `timestamptz` |  |
| `exit_time` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `wallet_ledger`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary |
| `tenant_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `amount` | `int4` |  |
| `reason` | `text` |  |
| `metadata` | `jsonb` |  |
| `created_at` | `timestamptz` |  |
| `event_id` | `uuid` |  Nullable |
| `product_id` | `uuid` |  Nullable |
| `product_name_at_time` | `text` |  Nullable |
| `price_tokens_at_time` | `int4` |  Nullable |
| `promoter_code_id` | `uuid` |  Nullable |
| `campaign_type` | `text` |  Nullable |

-- ─────────────────────────────────────────────────────────────────────────
-- NIGHTGRAPH · Edge RPCs para el Catálogo y el Inventario
-- ─────────────────────────────────────────────────────────────────────────

-- 1. FUNCIÓN DE COMPRA ATÓMICA
-- Resta los tokens, hace la "foto" del precio y entrega la recompensa en 1 milisegundo.
create or replace function public.purchase_reward(
    p_tenant_id uuid,
    p_user_id   uuid,
    p_product_id uuid,
    p_event_id  uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    v_balance int;
    v_product record;
    v_reward_id uuid;
begin
    -- 1. Buscar el producto y verificar que está activo
    select * into v_product from public.tenant_products 
    where id = p_product_id and tenant_id = p_tenant_id and is_active = true;
    
    if not found then
        raise exception 'Producto no encontrado o inactivo';
    end if;

    -- 2. Bloquear la fila del usuario para evitar compras dobles simultáneas (TOCTOU)
    select token_balance into v_balance from public.user_profiles
    where id = p_user_id and tenant_id = p_tenant_id
    for update;

    -- 3. Verificar fondos
    if v_balance < v_product.price_tokens then
        raise exception 'Saldo insuficiente';
    end if;

    -- 4. Registrar en el Ledger (con Snapshot del precio y nombre)
    insert into public.wallet_ledger (
        tenant_id, user_id, amount, reason, event_id, product_id, 
        product_name_at_time, price_tokens_at_time
    ) values (
        p_tenant_id, p_user_id, -(v_product.price_tokens), 'reward_purchase', p_event_id, p_product_id,
        v_product.name, v_product.price_tokens
    );

    -- 5. Entregar la recompensa en el bolsillo del usuario
    insert into public.user_rewards (tenant_id, user_id, product_id, event_id, status)
    values (p_tenant_id, p_user_id, p_product_id, p_event_id, 'available')
    returning id into v_reward_id;

    -- Devolvemos el ID del ticket y el saldo restante
    return jsonb_build_object('reward_id', v_reward_id, 'new_balance', v_balance - v_product.price_tokens);
end;
$$;


-- 2. FUNCIÓN DE CANJE (El Reloj de 5 minutos)
create or replace function public.start_reward_redemption(
    p_tenant_id uuid,
    p_user_id   uuid,
    p_reward_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    v_reward record;
begin
    -- Actualizamos solo si pertenece al usuario y está 'available'
    update public.user_rewards
    set 
        status = 'redeeming',
        redeemed_at = now(),
        expires_at = now() + interval '5 minutes'
    where id = p_reward_id 
      and user_id = p_user_id 
      and tenant_id = p_tenant_id 
      and status = 'available'
    returning id, expires_at into v_reward;

    if not found then
        raise exception 'Recompensa no válida, ya canjeada o expirada';
    end if;

    return jsonb_build_object('success', true, 'expires_at', v_reward.expires_at);
end;
$$;

-- 3. BLINDAJE DE SEGURIDAD (Revocar acceso público)
-- Solo el Cloudflare Worker con service_role puede ejecutar estas operaciones
revoke execute on function public.purchase_reward from public, anon, authenticated;
grant execute on function public.purchase_reward to service_role;

revoke execute on function public.start_reward_redemption from public, anon, authenticated;
grant execute on function public.start_reward_redemption to service_role;