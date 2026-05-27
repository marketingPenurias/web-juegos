-- ─────────────────────────────────────────────────────────────────────────
--   Nightgraph · Universal Attribution + Realtime publication
--
--   This migration introduces two enterprise pillars:
--
--   1. tracking_campaigns — a generic "where did this user come from?"
--      ledger that subsumes promoter_codes, QR signage, social link
--      drops and in-game shares behind one uniform contract.
--
--   2. Supabase Realtime publication for event_tracks + behavior_events
--      so the TV / Jumbotron screens can subscribe over WebSockets
--      instead of polling.  Zero polling on big-screens.
--
--   Run AFTER `database/06_music_rpc.sql`.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. tracking_campaigns ────────────────────────────────────────────────

create table if not exists public.tracking_campaigns (
	id            uuid primary key default gen_random_uuid(),
	tenant_id     uuid not null references public.tenants(id) on delete cascade,
	code          text not null,
	campaign_type text not null check (
		campaign_type in ('location', 'promoter', 'game', 'social', 'paid_ads')
	),
	metadata      jsonb not null default '{}'::jsonb,
	is_active     boolean not null default true,
	created_at    timestamptz not null default now(),
	-- A code is unique per tenant — two venues can both have "BATHROOM_VIP".
	unique (tenant_id, code)
);

create index if not exists tracking_campaigns_tenant_idx
	on public.tracking_campaigns (tenant_id);
create index if not exists tracking_campaigns_code_idx
	on public.tracking_campaigns (tenant_id, code)
	where is_active = true;

alter table public.tracking_campaigns enable row level security;

drop policy if exists tracking_campaigns_tenant_read on public.tracking_campaigns;
create policy tracking_campaigns_tenant_read on public.tracking_campaigns
	for select using (tenant_id = public.current_tenant_id());

drop policy if exists tracking_campaigns_tenant_write on public.tracking_campaigns;
create policy tracking_campaigns_tenant_write on public.tracking_campaigns
	for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists tracking_campaigns_tenant_update on public.tracking_campaigns;
create policy tracking_campaigns_tenant_update on public.tracking_campaigns
	for update using (tenant_id = public.current_tenant_id())
	with check (tenant_id = public.current_tenant_id());

-- ── 2. user_profiles.acquisition_campaign_id ─────────────────────────────

alter table public.user_profiles
	add column if not exists acquisition_campaign_id uuid
	references public.tracking_campaigns(id) on delete set null;

-- Indexed so cohort reads (`WHERE acquisition_campaign_id = ?`) stay O(1).
create index if not exists user_profiles_campaign_idx
	on public.user_profiles (tenant_id, acquisition_campaign_id)
	where acquisition_campaign_id is not null;

-- ── 3. Resolver helper used by the Edge Worker /api/auth-sync ────────────
--
-- The worker invokes this with the verified user's tenant_id + the raw
-- code we read from the `ng_tracking_ref` cookie.  Returns the campaign
-- UUID, or NULL when the code doesn't match an active campaign.  We
-- could do this with a plain SELECT, but folding it into a SECURITY
-- DEFINER function lets us tighten RLS later (revoke direct SELECT and
-- only grant EXECUTE on this resolver to service_role).

create or replace function public.resolve_tracking_campaign(
	p_tenant_id uuid,
	p_code      text
) returns uuid
language sql stable
security definer
set search_path = public
as $$
	select id from public.tracking_campaigns
	where  tenant_id = p_tenant_id
	  and  is_active = true
	  and  code      = upper(trim(p_code))
	limit 1
$$;

-- Seed two example campaigns for La Pocha so the QR demo is plug-and-play.
insert into public.tracking_campaigns
	(tenant_id, code, campaign_type, metadata)
select
	t.id, v.code, v.campaign_type, v.metadata::jsonb
from public.tenants t
join (values
	('BATHROOM_VIP',  'location', '{"label":"QR baño VIP","placement":"restroom_door"}'),
	('JUAN_RRPP',     'promoter', '{"label":"WhatsApp Juan RRPP"}'),
	('TINDER_SHARE',  'game',     '{"label":"Compartir Tinder Musical"}')
) as v(code, campaign_type, metadata) on true
where t.slug = 'lapocha'
on conflict (tenant_id, code) do nothing;

-- ── 4. Supabase Realtime publication ─────────────────────────────────────
--
-- The publication `supabase_realtime` is the bridge between Postgres
-- logical replication and the Realtime broadcast service.  Tables in
-- this publication emit INSERT / UPDATE / DELETE events over the
-- WebSocket channel.  These calls are idempotent via the DO block — re-
-- running the migration won't error on "relation is already member of
-- publication".

do $$
begin
	if not exists (
		select 1 from pg_publication_tables
		where pubname = 'supabase_realtime' and tablename = 'event_tracks'
	) then
		alter publication supabase_realtime add table public.event_tracks;
	end if;
end $$;

do $$
begin
	if not exists (
		select 1 from pg_publication_tables
		where pubname = 'supabase_realtime' and tablename = 'behavior_events'
	) then
		alter publication supabase_realtime add table public.behavior_events;
	end if;
end $$;

-- ── 5. `display` role (Jumbotron) ────────────────────────────────────────
--
-- tenant_staff.role is constrained by a CHECK.  Add the new value so a
-- dedicated read-only "TV kiosk" user can authenticate and consume the
-- broadcast without holding the `admin` keys.

do $$
begin
	if not exists (
		select 1 from pg_constraint
		where conname = 'tenant_staff_role_check'
	) then
		-- Role check defined inline in the original schema — name varies
		-- between Postgres versions.  No-op when it doesn't exist.
		null;
	end if;
end $$;

alter table public.tenant_staff
	drop constraint if exists tenant_staff_role_check;

alter table public.tenant_staff
	add constraint tenant_staff_role_check check (
		role in ('admin', 'manager', 'door', 'bar', 'dj', 'promoter', 'display')
	);
