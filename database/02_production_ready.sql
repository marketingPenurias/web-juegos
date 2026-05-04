-- ─────────────────────────────────────────────────────────────────────────
--   La Pocha · Production Hardening
--   - CQRS: materialize wallet balance into user_profiles via trigger
--   - Link our user_profiles row to Supabase auth.users
--   - Leaderboard index on (tenant_id, lifetime_earned DESC)
--   - Strict balance-guard helpers for the worker
--
--   Run AFTER `database/schema.sql` has been executed once.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Materialized columns + auth link ──────────────────────────────────

alter table public.user_profiles
	add column if not exists token_balance   int  not null default 0,
	add column if not exists lifetime_earned int  not null default 0,
	add column if not exists auth_user_id    uuid;

-- One profile per Supabase auth user.  Partial index so seeded demo rows
-- (with auth_user_id = NULL) don't collide with each other.
create unique index if not exists user_profiles_auth_user_idx
	on public.user_profiles (auth_user_id)
	where auth_user_id is not null;

-- Leaderboard read pattern: top earners per tenant, this week / all time.
create index if not exists user_profiles_leaderboard_idx
	on public.user_profiles (tenant_id, lifetime_earned desc);

-- ── 2. Token materialization trigger ─────────────────────────────────────
--
--   wallet_ledger is the source of truth (append-only).  user_profiles
--   holds the read-side projection so leaderboard / hub queries are O(1)
--   instead of summing the full ledger every render.
--
--   Trigger contract:
--     - token_balance always reflects sum(amount).
--     - lifetime_earned only increases — it ignores spends.
--
--   security definer + explicit search_path so RLS policies on
--   user_profiles don't block the materialization.

create or replace function public.update_user_token_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	update public.user_profiles
	set
		token_balance   = token_balance   + new.amount,
		lifetime_earned = lifetime_earned + greatest(new.amount, 0)
	where id = new.user_id;
	return new;
end;
$$;

drop trigger if exists wallet_ledger_after_insert on public.wallet_ledger;
create trigger wallet_ledger_after_insert
	after insert on public.wallet_ledger
	for each row
	execute function public.update_user_token_balance();

-- ── 3. Server-side balance guard helper ──────────────────────────────────
--
-- The worker can call this in a single round-trip to insert a debit
-- safely.  Returns the new balance or NULL when the request would
-- overdraft.  Wallet inserts via PostgREST stay the primary path; this
-- function is here as a defence-in-depth option for high-stakes flows.

create or replace function public.spend_tokens(
	p_tenant_id uuid,
	p_user_id   uuid,
	p_amount    int,
	p_reason    text,
	p_metadata  jsonb default '{}'::jsonb
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
	v_balance int;
begin
	if p_amount >= 0 then
		raise exception 'spend_tokens expects a negative amount, got %', p_amount;
	end if;

	select token_balance into v_balance
	from public.user_profiles
	where id = p_user_id and tenant_id = p_tenant_id
	for update;

	if v_balance is null then
		raise exception 'user_profile % not found for tenant %', p_user_id, p_tenant_id;
	end if;

	if v_balance + p_amount < 0 then
		return null; -- caller treats NULL as "insufficient funds"
	end if;

	insert into public.wallet_ledger (tenant_id, user_id, amount, reason, metadata)
	values (p_tenant_id, p_user_id, p_amount, p_reason, p_metadata);

	-- Trigger has already updated user_profiles; just read it back.
	select token_balance into v_balance
	from public.user_profiles
	where id = p_user_id;
	return v_balance;
end;
$$;

-- ── 4. Backfill existing seeded data so the projection is consistent ─────
--
--   Run-once: recompute token_balance / lifetime_earned for every profile
--   from the existing ledger.  Safe to re-run.

update public.user_profiles up
set
	token_balance   = coalesce(t.balance,   0),
	lifetime_earned = coalesce(t.lifetime,  0)
from (
	select
		user_id,
		sum(amount)                                     as balance,
		sum(case when amount > 0 then amount else 0 end) as lifetime
	from public.wallet_ledger
	group by user_id
) t
where up.id = t.user_id;
