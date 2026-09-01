-- 41 · v23 · Registro de exposición a campañas
--
--   Hasta ahora sabíamos quién CANJEÓ un flash drop, pero no quién lo VIO.
--   Sin eso solo se puede medir volumen ("se canjearon 40 copas"), que no
--   demuestra nada: esas copas podrían haberse bebido igual.  Para poder
--   afirmar que la app GENERA consumo hace falta comparar a quien recibió el
--   estímulo con quien no, y para eso lo primero es dejar constancia de quién
--   lo recibió.
--
--   Se registra desde `/api/catalog`, no dentro de `get_promo_catalog`: esa
--   función es STABLE (no puede escribir) y conviene que siga siéndolo, porque
--   se llama en cada apertura del menú.
--
--   Una fila por usuario, campaña y noche.  El menú se abre muchas veces por
--   noche y no queremos una fila por refresco: el índice único hace el resto.

create table if not exists public.campaign_exposures (
	id              uuid primary key default gen_random_uuid(),
	tenant_id       uuid not null references public.tenants(id) on delete cascade,
	user_id         uuid not null references public.user_profiles(id) on delete cascade,
	-- Deliberadamente SIN clave foránea: si mañana se borra una regla, el
	-- histórico del experimento no se puede ir con ella.
	availability_id uuid not null,
	campaign_code   text,
	kind            text not null,
	-- Noche de negocio (06:00→06:00), no fecha natural: una campaña de las
	-- 03:00 pertenece a la noche del sábado, no a la del domingo.
	night           date not null,
	created_at      timestamptz not null default now()
);

create unique index if not exists campaign_exposures_once
	on public.campaign_exposures (tenant_id, user_id, availability_id, night);

create index if not exists campaign_exposures_campaign_idx
	on public.campaign_exposures (tenant_id, campaign_code, night);

alter table public.campaign_exposures enable row level security;

-- Solo el personal de la sala lee sus propias exposiciones.  Nada de anon:
-- esto es dato de comportamiento por persona.
drop policy if exists campaign_exposures_staff_read on public.campaign_exposures;
create policy campaign_exposures_staff_read on public.campaign_exposures
	for select to authenticated
	using (public.is_tenant_staff(tenant_id, auth.uid()));

-- La escritura va por service_role a través de la RPC de abajo.
grant select on public.campaign_exposures to authenticated;

/**
 * log_campaign_exposure — deja constancia de que estos usuarios vieron estas
 * campañas esta noche.
 *
 *   Idempotente por diseño: se llama en cada apertura del menú y el índice
 *   único descarta las repeticiones.  Nunca falla hacia arriba — si el
 *   registro de una métrica rompiera el catálogo, el remedio sería peor.
 */
create or replace function public.log_campaign_exposure(
	p_tenant_id uuid,
	p_user_id   uuid,
	p_rules     jsonb
) returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
	v_night date := business_night(now())::date;
	v_count integer;
begin
	if p_rules is null or jsonb_array_length(p_rules) = 0 then
		return 0;
	end if;

	with inserted as (
		insert into campaign_exposures
			(tenant_id, user_id, availability_id, campaign_code, kind, night)
		select p_tenant_id, p_user_id,
		       (r->>'availability_id')::uuid,
		       nullif(r->>'campaign_code', ''),
		       coalesce(r->>'kind', 'campaign'),
		       v_night
		  from jsonb_array_elements(p_rules) r
		 where r->>'availability_id' is not null
		on conflict do nothing
		returning 1
	)
	select count(*) into v_count from inserted;

	return v_count;
end $$;

revoke all on function public.log_campaign_exposure(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.log_campaign_exposure(uuid, uuid, jsonb) to service_role;

/**
 * campaign_reach — lo que ya se puede contar en cuanto haya noches:
 * a cuánta gente llegó cada campaña y qué proporción convirtió.
 *
 *   `security_invoker` para que respete las políticas de quien consulta.  Es
 *   el patrón de `dj_leaderboard`; olvidarlo en `campaign_performance` fue un
 *   escape de datos entre salas.
 */
create or replace view public.campaign_reach
with (security_invoker = on) as
select
	e.tenant_id,
	e.night,
	e.campaign_code,
	e.kind,
	count(distinct e.user_id)                       as alcanzados,
	count(distinct r.user_id)                       as compraron,
	count(distinct r.user_id) filter
		(where r.status = 'consumed')               as consumieron,
	round(100.0 * count(distinct r.user_id)
	      / nullif(count(distinct e.user_id), 0), 1) as tasa_conversion_pct
from campaign_exposures e
left join user_rewards r
       on r.tenant_id      = e.tenant_id
      and r.user_id        = e.user_id
      and r.availability_id = e.availability_id
      and business_night(r.created_at)::date = e.night
group by e.tenant_id, e.night, e.campaign_code, e.kind;

revoke all on public.campaign_reach from anon;
grant select on public.campaign_reach to authenticated;
