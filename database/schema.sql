-- ─────────────────────────────────────────────────────────────────────────
--   La Pocha · Enterprise Multi-Tenant CRM Schema
--   Event-sourcing + cohort analysis. Optimized for 100+ req/s ingestion
--   via Cloudflare Workers + Supabase Connection Pooling (port 6543).
-- ─────────────────────────────────────────────────────────────────────────
--   Run this once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────

-- Required for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ── tenants ──────────────────────────────────────────────────────────────
create table if not exists public.tenants (
	id          uuid primary key default gen_random_uuid(),
	slug        text unique not null,
	name        text not null,
	status      text not null default 'active'
		check (status in ('active', 'paused', 'churned')),
	created_at  timestamptz not null default now()
);

-- Seed the only tenant for the MVP demo.
insert into public.tenants (slug, name, status)
values ('lapocha', 'La Pocha', 'active')
on conflict (slug) do nothing;

-- ── user_profiles ────────────────────────────────────────────────────────
create table if not exists public.user_profiles (
	id                  uuid primary key default gen_random_uuid(),
	tenant_id           uuid not null references public.tenants(id) on delete cascade,
	email               text not null,
	display_name        text,
	acquisition_source  text,
	vip_level           int  not null default 1,
	created_at          timestamptz not null default now(),
	-- One email per tenant (the same email may exist in two different venues).
	unique (tenant_id, email)
);

create index if not exists user_profiles_tenant_idx
	on public.user_profiles (tenant_id);
create index if not exists user_profiles_tenant_email_idx
	on public.user_profiles (tenant_id, email);

-- ── venue_visits ─────────────────────────────────────────────────────────
-- Drives weekly retention cohorts and dwell-time analytics.
create table if not exists public.venue_visits (
	id          uuid primary key default gen_random_uuid(),
	tenant_id   uuid not null references public.tenants(id) on delete cascade,
	user_id     uuid not null references public.user_profiles(id) on delete cascade,
	entry_time  timestamptz not null default now(),
	exit_time   timestamptz,
	created_at  timestamptz not null default now()
);

create index if not exists venue_visits_tenant_idx
	on public.venue_visits (tenant_id);
create index if not exists venue_visits_user_idx
	on public.venue_visits (user_id);
create index if not exists venue_visits_entry_idx
	on public.venue_visits (tenant_id, entry_time desc);

-- ── behavior_events ──────────────────────────────────────────────────────
-- Append-only event log. Every user action lands here.
create table if not exists public.behavior_events (
	id              bigserial primary key,
	tenant_id       uuid not null references public.tenants(id) on delete cascade,
	visit_id        uuid references public.venue_visits(id) on delete set null,
	user_id         uuid references public.user_profiles(id) on delete cascade,
	event_category  text not null,
	event_action    text not null,
	metadata        jsonb not null default '{}'::jsonb,
	created_at      timestamptz not null default now()
);

create index if not exists behavior_events_tenant_idx
	on public.behavior_events (tenant_id);
create index if not exists behavior_events_user_idx
	on public.behavior_events (user_id);
create index if not exists behavior_events_visit_idx
	on public.behavior_events (visit_id);
create index if not exists behavior_events_category_idx
	on public.behavior_events (tenant_id, event_category, created_at desc);
create index if not exists behavior_events_metadata_idx
	on public.behavior_events using gin (metadata);

-- ── wallet_ledger ────────────────────────────────────────────────────────
-- Append-only ledger of token deltas. Balance = sum(amount) per user.
create table if not exists public.wallet_ledger (
	id          bigserial primary key,
	tenant_id   uuid not null references public.tenants(id) on delete cascade,
	user_id     uuid not null references public.user_profiles(id) on delete cascade,
	amount      int  not null,
	reason      text not null,
	metadata    jsonb not null default '{}'::jsonb,
	created_at  timestamptz not null default now()
);

create index if not exists wallet_ledger_tenant_idx
	on public.wallet_ledger (tenant_id);
create index if not exists wallet_ledger_user_idx
	on public.wallet_ledger (user_id);
create index if not exists wallet_ledger_tenant_time_idx
	on public.wallet_ledger (tenant_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
--   ROW LEVEL SECURITY — enforce tenant_id isolation on every read/write
-- ─────────────────────────────────────────────────────────────────────────
-- Pattern: clients send `X-Tenant-Slug` (mapped to tenant_id by the worker)
-- or rely on JWT custom claim `tenant_id`. The worker is the only privileged
-- actor — it uses the service role key for inserts and ALWAYS sets
-- tenant_id explicitly, then RLS enforces SELECT-side isolation.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.tenants          enable row level security;
alter table public.user_profiles    enable row level security;
alter table public.venue_visits     enable row level security;
alter table public.behavior_events  enable row level security;
alter table public.wallet_ledger    enable row level security;

-- Helper: pull tenant_id from the JWT claims set by the API client.
create or replace function public.current_tenant_id() returns uuid
language sql stable as $$
	select nullif(
		current_setting('request.jwt.claims', true)::json->>'tenant_id',
		''
	)::uuid
$$;

-- ─── tenants ──────────────────────────────────────────────────────────────
drop policy if exists tenants_self_read on public.tenants;
create policy tenants_self_read on public.tenants
	for select using (id = public.current_tenant_id());

-- ─── user_profiles ────────────────────────────────────────────────────────
drop policy if exists user_profiles_tenant_read   on public.user_profiles;
drop policy if exists user_profiles_tenant_write  on public.user_profiles;
drop policy if exists user_profiles_tenant_update on public.user_profiles;

create policy user_profiles_tenant_read on public.user_profiles
	for select using (tenant_id = public.current_tenant_id());
create policy user_profiles_tenant_write on public.user_profiles
	for insert with check (tenant_id = public.current_tenant_id());
create policy user_profiles_tenant_update on public.user_profiles
	for update using (tenant_id = public.current_tenant_id())
	with check (tenant_id = public.current_tenant_id());

-- ─── venue_visits ─────────────────────────────────────────────────────────
drop policy if exists venue_visits_tenant_read   on public.venue_visits;
drop policy if exists venue_visits_tenant_write  on public.venue_visits;
drop policy if exists venue_visits_tenant_update on public.venue_visits;

create policy venue_visits_tenant_read on public.venue_visits
	for select using (tenant_id = public.current_tenant_id());
create policy venue_visits_tenant_write on public.venue_visits
	for insert with check (tenant_id = public.current_tenant_id());
create policy venue_visits_tenant_update on public.venue_visits
	for update using (tenant_id = public.current_tenant_id())
	with check (tenant_id = public.current_tenant_id());

-- ─── behavior_events ──────────────────────────────────────────────────────
drop policy if exists behavior_events_tenant_read  on public.behavior_events;
drop policy if exists behavior_events_tenant_write on public.behavior_events;

create policy behavior_events_tenant_read on public.behavior_events
	for select using (tenant_id = public.current_tenant_id());
create policy behavior_events_tenant_write on public.behavior_events
	for insert with check (tenant_id = public.current_tenant_id());

-- ─── wallet_ledger ────────────────────────────────────────────────────────
drop policy if exists wallet_ledger_tenant_read  on public.wallet_ledger;
drop policy if exists wallet_ledger_tenant_write on public.wallet_ledger;

create policy wallet_ledger_tenant_read on public.wallet_ledger
	for select using (tenant_id = public.current_tenant_id());
create policy wallet_ledger_tenant_write on public.wallet_ledger
	for insert with check (tenant_id = public.current_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────
--   PERFORMANCE — function for resolving tenant_id by slug (used by worker)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.tenant_id_by_slug(p_slug text)
returns uuid language sql stable as $$
	select id from public.tenants where slug = p_slug limit 1
$$;
