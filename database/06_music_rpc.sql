-- ─────────────────────────────────────────────────────────────────────────
--   Nightgraph · Tinder Musical RPC + DJ helper view
--
--   This migration introduces the atomic vote_track() RPC.  The
--   schema doc (squema.md) defines event_tracks and track_votes but
--   leaves the vote logic open — we close it here:
--
--     - vote_track is SECURITY DEFINER, FOR UPDATE locks the track row
--       and (when boosting) the user_profiles row.
--     - It inserts into track_votes, optionally debits wallet_ledger,
--       and bumps event_tracks.total_votes in one transaction.
--     - Boosts count as +5 votes; free votes count as +1.
--     - Locked down to service_role — only the worker can invoke it.
--
--   Run AFTER `database/05_scalability_ready.sql`.
-- ─────────────────────────────────────────────────────────────────────────

-- Idempotent index: one vote per (user, track).  Backstop for the
-- application-level dedupe inside the RPC.
create unique index if not exists track_votes_unique_user_track
	on public.track_votes (track_id, user_id);

-- ── vote_track RPC ───────────────────────────────────────────────────────

create or replace function public.vote_track(
	p_tenant_id    uuid,
	p_user_id      uuid,
	p_event_id     uuid,
	p_track_id     uuid,
	p_vote_type    text default 'free',
	p_tokens_spent int  default 0
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
begin
	-- 1. Input validation
	if p_vote_type not in ('free', 'boost') then
		raise exception 'invalid_vote_type';
	end if;
	if p_tokens_spent < 0 then
		raise exception 'negative_tokens';
	end if;
	if p_vote_type = 'free' and p_tokens_spent <> 0 then
		raise exception 'free_votes_must_be_zero_tokens';
	end if;

	-- 2. Lock the track row and verify it's votable
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

	-- 3. Dedupe — application-level check (the unique index is the backstop)
	if exists (
		select 1 from public.track_votes
		where track_id = p_track_id and user_id = p_user_id
	) then
		return jsonb_build_object('ok', false, 'error', 'already_voted');
	end if;

	-- 4. If this is a boost, debit tokens atomically
	if p_vote_type = 'boost' and p_tokens_spent > 0 then
		select token_balance into v_balance
		from public.user_profiles
		where id = p_user_id and tenant_id = p_tenant_id
		for update;
		if v_balance is null then
			raise exception 'user_profile_not_found';
		end if;
		if v_balance < p_tokens_spent then
			return jsonb_build_object(
				'ok', false,
				'error', 'insufficient_funds',
				'balance', v_balance
			);
		end if;
		insert into public.wallet_ledger (
			tenant_id, user_id, amount, reason, event_id,
			metadata, campaign_type
		) values (
			p_tenant_id, p_user_id, -p_tokens_spent, 'vote_boost', p_event_id,
			jsonb_build_object('track_id', p_track_id), 'song_vote'
		);
	end if;

	-- 5. Insert the vote
	insert into public.track_votes (
		tenant_id, event_id, track_id, user_id, vote_type, tokens_spent
	) values (
		p_tenant_id, p_event_id, p_track_id, p_user_id, p_vote_type, p_tokens_spent
	)
	returning id into v_vote_id;

	-- 6. Bump total_votes (boost = +5, free = +1)
	v_delta := case when p_vote_type = 'boost' then 5 else 1 end;
	update public.event_tracks
	set total_votes = total_votes + v_delta
	where id = p_track_id
	returning total_votes into v_track.total_votes;

	-- 7. Return the new state.  If we just debited, pull the balance back.
	if p_vote_type = 'boost' then
		select token_balance into v_balance
		from public.user_profiles
		where id = p_user_id;
	end if;

	return jsonb_build_object(
		'ok', true,
		'vote_id', v_vote_id,
		'total_votes', v_track.total_votes,
		'balance', v_balance
	);
end;
$$;

-- ── Lock down the RPC ────────────────────────────────────────────────────
revoke execute on function public.vote_track(uuid, uuid, uuid, uuid, text, int)
	from public, anon, authenticated;
grant  execute on function public.vote_track(uuid, uuid, uuid, uuid, text, int)
	to service_role;

-- ── Voted-by-user helper ─────────────────────────────────────────────────
-- The Tinder UI needs to know which tracks the user has already voted
-- on so it can hide them from the deck.  This is RLS-safe under the
-- existing track_votes policies.
create or replace function public.tracks_voted_by(
	p_event_id uuid,
	p_user_id  uuid
) returns setof uuid
language sql stable
security definer
set search_path = public
as $$
	select track_id from public.track_votes
	where event_id = p_event_id and user_id = p_user_id
$$;

revoke execute on function public.tracks_voted_by(uuid, uuid)
	from public, anon, authenticated;
grant  execute on function public.tracks_voted_by(uuid, uuid)
	to service_role;

-- ── RLS on the new tables (defensive — schema doc may already have them) ─

alter table if exists public.event_tracks enable row level security;
alter table if exists public.track_votes  enable row level security;
alter table if exists public.user_rewards enable row level security;

drop policy if exists event_tracks_tenant_read  on public.event_tracks;
create policy event_tracks_tenant_read on public.event_tracks
	for select using (tenant_id = public.current_tenant_id());

drop policy if exists track_votes_tenant_read   on public.track_votes;
create policy track_votes_tenant_read on public.track_votes
	for select using (tenant_id = public.current_tenant_id());

drop policy if exists user_rewards_tenant_read  on public.user_rewards;
create policy user_rewards_tenant_read on public.user_rewards
	for select using (tenant_id = public.current_tenant_id());

-- ── Leaderboard helper view for DJ dashboard ─────────────────────────────
-- A pre-sorted projection so the DJ frontend only ever does a SELECT *.
create or replace view public.dj_leaderboard as
select
	et.id,
	et.tenant_id,
	et.event_id,
	et.title,
	et.artist,
	et.cover_image_url,
	et.total_votes,
	et.is_played,
	et.played_at,
	(
		select count(*) from public.track_votes tv
		where tv.track_id = et.id and tv.vote_type = 'boost'
	) as boost_count,
	(
		select count(*) from public.track_votes tv
		where tv.track_id = et.id and tv.vote_type = 'free'
	) as free_count
from public.event_tracks et;

comment on view public.dj_leaderboard is
	'Pre-sorted track ranking for the DJ dashboard.  ORDER BY total_votes DESC at the call site.';
