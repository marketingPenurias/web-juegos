-- ============================================================================
-- 23 · V19 — Presupuesto de voto del JUKEBOX
-- ============================================================================
-- Aplicado en remoto vía MCP (migraciones `v19_jukebox_vote_budget` +
-- `v19_vote_track_budget_gate`).  Este archivo es el ESPEJO del repo.
--
-- Problema: el jukebox era un grifo — votar daba +20 tokens y era ilimitado,
-- así que la gente "pedía todo" y el DJ se sentía obligado.
--
-- Modelo nuevo (solo jukebox; Tinder y Batalla NO se tocan):
--   · 5 votos gratis por noche-negocio.
--   · Cada 150 tokens gastados en promos (reason='reward_purchase') → +1 voto.
--   · Agotados: votar cuesta 15 tokens/tema (o boostear como siempre).
-- Config tuneable desde tenant_token_rewards; se desactiva jukebox_request.
-- ----------------------------------------------------------------------------

alter table public.track_votes add column if not exists context text;
create index if not exists idx_track_votes_jukebox_budget
	on public.track_votes (tenant_id, user_id, context, created_at)
	where context = 'jukebox';

update public.tenant_token_rewards
set amount = 0, is_active = false
where event_code = 'jukebox_request';

insert into public.tenant_token_rewards (tenant_id, event_code, amount, description, is_active)
select t.id, v.code, v.amt, v.descr, true
from public.tenants t
cross join (values
	('jukebox_free_per_night', 5,    'Votos gratis de jukebox por noche'),
	('jukebox_tokens_per_vote', 150, 'Tokens gastados en promos por cada voto extra ganado'),
	('jukebox_extra_vote',      -15, 'Coste en tokens de un voto extra de jukebox')
) as v(code, amt, descr)
on conflict do nothing;

-- Helper: votos de jukebox que le quedan al usuario esta noche.
CREATE OR REPLACE FUNCTION public.jukebox_votes_remaining(p_tenant_id uuid, p_user_id uuid)
 RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_free int; v_per int; v_spent int; v_earned int; v_used int;
begin
	select amount into v_free from tenant_token_rewards
	where tenant_id=p_tenant_id and event_code='jukebox_free_per_night' and is_active;
	v_free := coalesce(v_free, 5);
	select amount into v_per from tenant_token_rewards
	where tenant_id=p_tenant_id and event_code='jukebox_tokens_per_vote' and is_active;
	v_per := coalesce(nullif(v_per,0), 150);
	select coalesce(sum(-amount),0) into v_spent from wallet_ledger
	where tenant_id=p_tenant_id and user_id=p_user_id and reason='reward_purchase'
	  and public.business_night(created_at) = public.business_night(now());
	v_earned := floor(v_spent::numeric / v_per);
	select count(*) into v_used from track_votes
	where tenant_id=p_tenant_id and user_id=p_user_id and context='jukebox'
	  and vote_type='free' and tokens_spent=0
	  and public.business_night(created_at) = public.business_night(now());
	return v_free + v_earned - v_used;
end; $function$;

-- vote_track: gate de presupuesto para votos libres de jukebox (p_context)
-- con voto extra pagado (p_paid_extra).  Boost / tinder / batalla intactos.
-- (Cuerpo completo aplicado en la migración v19_vote_track_budget_gate — ver
--  esa migración; añade params p_context text, p_paid_extra boolean y devuelve
--  remaining_free / extra_cost en el jsonb.)
