-- ─────────────────────────────────────────────────────────────────────────
--   Nightgraph · Economy externalizada + fixes piloto
--
--   1. `tenant_token_rewards` — reglas de economía por código de evento
--      ("ruleta_spin", "tinder_swipe", "vote_track_free", "jukebox_boost",
--      "livebattle_boost", …) externalizadas del código del frontend.
--      Cualquier cambio de balance se hace en BD, sin redeploy.
--
--   2. Seed para 'lapocha' con los valores actuales que vivían
--      hardcodeados en TypeScript (SPIN_REWARD=15, REWARD tinder=20,
--      BOOST_COST jukebox=50, BOOST_COST livebattle=30, etc.).
--
--   3. Fix idempotente de los `spotify_id` del seed 08b — para entornos
--      donde ya se ejecutó 08b con los valores antiguos (`pilot_lapocha_NNN`)
--      y queremos pasar al formato canónico `spotify:track:xxxx` sin
--      recrear las filas (track_votes y wallet_ledger los referencian).
--
--   Run AFTER `database/08b_seed_lapocha_data.sql`.  Idempotente.
-- ─────────────────────────────────────────────────────────────────────────


-- =========================================================================
--  1. tenant_token_rewards
-- =========================================================================

create table if not exists public.tenant_token_rewards (
	tenant_id   uuid    not null references public.tenants(id) on delete cascade,
	event_code  text    not null,
	amount      int     not null,        -- positivo gana, negativo gasta
	description text    not null,
	is_active   boolean not null default true,
	updated_at  timestamptz not null default now(),
	primary key (tenant_id, event_code)
);

create index if not exists tenant_token_rewards_active_idx
	on public.tenant_token_rewards (tenant_id)
	where is_active = true;

alter table public.tenant_token_rewards enable row level security;

drop policy if exists tenant_token_rewards_read on public.tenant_token_rewards;
create policy tenant_token_rewards_read on public.tenant_token_rewards
	for select using (tenant_id = public.current_tenant_id());

drop policy if exists tenant_token_rewards_write on public.tenant_token_rewards;
create policy tenant_token_rewards_write on public.tenant_token_rewards
	for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists tenant_token_rewards_update on public.tenant_token_rewards;
create policy tenant_token_rewards_update on public.tenant_token_rewards
	for update using (tenant_id = public.current_tenant_id())
	with check (tenant_id = public.current_tenant_id());


-- =========================================================================
--  2. Seed económico de la lapocha — valores ANTES hardcodeados
-- =========================================================================

insert into public.tenant_token_rewards
	(tenant_id, event_code, amount, description)
select t.id, v.event_code, v.amount, v.description
from public.tenants t
join (values
	('ruleta_spin',         15,  'Premio fijo por girar la ruleta'),
	('tinder_completion',   20,  'Recompensa al completar 5 swipes en Tinder Musical'),
	('tinder_vote_free',     0,  'Voto libre en Tinder Musical (sin coste)'),
	('jukebox_boost',      -50,  'Coste de Boost en Jukebox'),
	('livebattle_boost',   -30,  'Coste de Boost en Live Battle'),
	('livebattle_vote',      0,  'Voto libre en Live Battle'),
	('signup_bonus',       100,  'Regalo de bienvenida al crear perfil')
) as v(event_code, amount, description) on true
where t.slug = 'lapocha'
on conflict (tenant_id, event_code) do update
	set amount      = excluded.amount,
	    description = excluded.description,
	    is_active   = true,
	    updated_at  = now();


-- =========================================================================
--  3. Fix idempotente de spotify_id obsoletos
--     (sólo afecta a filas que aún tengan el formato sintético antiguo)
-- =========================================================================

update public.event_tracks
   set spotify_id = 'spotify:track:7vY2y8a8tBfWzMz6L5oRzo'
 where spotify_id = 'pilot_lapocha_001';

update public.event_tracks
   set spotify_id = 'spotify:track:4kFwM3lTITKzu5x7iGsXcW'
 where spotify_id = 'pilot_lapocha_002';

update public.event_tracks
   set spotify_id = 'spotify:track:5Y3yChnVa3uHfoZHk1S2pa'
 where spotify_id = 'pilot_lapocha_003';

update public.event_tracks
   set spotify_id = 'spotify:track:7yLtmYbf6QkLpqXdBhO9Eo'
 where spotify_id = 'pilot_lapocha_004';

update public.event_tracks
   set spotify_id = 'spotify:track:1z2EymPyYrIlVL08CmGqOO'
 where spotify_id = 'pilot_lapocha_005';
