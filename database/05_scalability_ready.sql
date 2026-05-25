-- ─────────────────────────────────────────────────────────────────────────
-- NIGHTGRAPH · Upgrade de Arquitectura Enterprise (SaaS Multi-Tenant)
-- V2: Enfocado en Economía de Tokens (Sin tocar facturación FIAT)
-- ─────────────────────────────────────────────────────────────────────────

-- =========================================================================
-- BLOQUE 1: JERARQUÍA Y PRODUCTO
-- =========================================================================

-- ── 1. Tabla de Promotoras (Grupos Empresariales) ──────────────
create table if not exists public.promoters (
    id            uuid primary key default gen_random_uuid(),
    name          text not null,
    contact_email text,
    created_at    timestamptz not null default now()
);

-- Conectamos las discotecas (tenants) a su promotora matriz.
alter table public.tenants
    add column if not exists promoter_id uuid references public.promoters(id) on delete set null;


-- ── 2. Feature Flags (Control de módulos contratados) ──────────
alter table public.tenants
    add column if not exists features jsonb not null default '{
        "games": {
            "tinder_musical": true,
            "roulette": false,
            "flash_drops": true
        },
        "limits": {
            "max_vip_users": 100
        }
    }'::jsonb;


-- ── 3. Catálogo de Precios y Recompensas (Solo Tokens) ─────────
create table if not exists public.tenant_products (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants(id) on delete cascade,
    product_type    text not null check (product_type in ('drink', 'reward', 'game_ticket', 'vip_access')),
    name            text not null, -- ej. "Voto Musical", "Copa Gratis VIP"
    price_tokens    int not null,  -- Coste o recompensa en la economía de la app
    reference_fiat  numeric(10,2), -- MERAMENTE INFORMATIVO (ej. Para calcular cuánto le cuesta a la sala dar esta recompensa)
    is_active       boolean not null default true,
    created_at      timestamptz not null default now()
);

create index if not exists tenant_products_tenant_idx on public.tenant_products (tenant_id);

alter table public.tenant_products enable row level security;
create policy tenant_products_tenant_read on public.tenant_products
    for select using (tenant_id = public.current_tenant_id());
create policy tenant_products_tenant_write on public.tenant_products
    for insert with check (tenant_id = public.current_tenant_id());
create policy tenant_products_tenant_update on public.tenant_products
    for update using (tenant_id = public.current_tenant_id())
    with check (tenant_id = public.current_tenant_id());


-- =========================================================================
-- BLOQUE 2: OPERATIVA INTERNA Y BLINDAJE
-- =========================================================================

-- ── 4. Control de Accesos del Staff (RBAC) ─────────────────────
create table if not exists public.tenant_staff (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references public.tenants(id) on delete cascade,
    user_id     uuid not null references auth.users(id) on delete cascade,
    role        text not null check (role in ('admin', 'manager', 'door', 'bar', 'dj', 'promoter')),
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),
    unique(tenant_id, user_id)
);

create index if not exists tenant_staff_tenant_idx on public.tenant_staff (tenant_id);
alter table public.tenant_staff enable row level security;
create policy tenant_staff_read on public.tenant_staff
    for select using (tenant_id = public.current_tenant_id());


-- ── 5. Sesiones / Eventos de la Discoteca ──────────────────────
create table if not exists public.tenant_events (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references public.tenants(id) on delete cascade,
    name        text not null, -- ej. "Halloween 2026", "Viernes Techno"
    start_time  timestamptz not null,
    end_time    timestamptz,
    status      text not null check (status in ('draft', 'active', 'closed')) default 'draft',
    created_at  timestamptz not null default now()
);

create index if not exists tenant_events_tenant_idx on public.tenant_events (tenant_id);
alter table public.tenant_events enable row level security;
create policy tenant_events_read on public.tenant_events
    for select using (tenant_id = public.current_tenant_id());


-- ── 6. Red de RRPP y Afiliados (El Grafo Físico) ───────────────
create table if not exists public.promoter_codes (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references public.tenants(id) on delete cascade,
    staff_id            uuid not null references public.tenant_staff(id) on delete cascade,
    code                text not null unique, 
    commission_tokens   int default 0, 
    commission_percent  numeric(5,2) default 0.00,
    created_at          timestamptz not null default now()
);

create index if not exists promoter_codes_tenant_idx on public.promoter_codes (tenant_id);
alter table public.promoter_codes enable row level security;
create policy promoter_codes_read on public.promoter_codes
    for select using (tenant_id = public.current_tenant_id());


-- ── 7. Trazabilidad y Anti-Fraude (Audit Logs) ─────────────────
create table if not exists public.audit_logs (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references public.tenants(id) on delete cascade,
    actor_id    uuid not null references auth.users(id),
    action      text not null,
    table_name  text,
    record_id   uuid,
    old_data    jsonb,
    new_data    jsonb,
    ip_address  text,
    created_at  timestamptz not null default now()
);

create index if not exists audit_logs_tenant_idx on public.audit_logs (tenant_id);
alter table public.audit_logs enable row level security;
create policy audit_logs_read on public.audit_logs
    for select using (tenant_id = public.current_tenant_id());
create policy audit_logs_insert on public.audit_logs
    for insert with check (tenant_id = public.current_tenant_id());


-- =========================================================================
-- BLOQUE 3: EL MOTOR DE TOKENS (Snapshot e Historial)
-- =========================================================================

-- ── 8. Evolución del Wallet Ledger actual ──────────────────────
-- En lugar de crear una tabla nueva, le inyectamos memoria histórica 
-- y contexto a la tabla wallet_ledger que ya gestiona vuestros tokens.

alter table public.wallet_ledger
    add column if not exists event_id uuid references public.tenant_events(id),
    add column if not exists product_id uuid references public.tenant_products(id),
    
    -- EL SNAPSHOT: CONGELAMOS EL PRECIO Y EL NOMBRE AQUÍ
    add column if not exists product_name_at_time text, 
    add column if not exists price_tokens_at_time int,
    
    -- EL CONTEXTO: ¿POR QUÉ SE MOVIERON LOS TOKENS?
    add column if not exists promoter_code_id uuid references public.promoter_codes(id),
    add column if not exists campaign_type text; -- ej. 'flash_drop', 'tinder_musical'

-- Creamos un índice compuesto para que la ingeniera de datos 
-- pueda cargar los dashboards B2B a velocidad récord.
create index if not exists idx_wallet_ledger_analytics on public.wallet_ledger(tenant_id, event_id, created_at);