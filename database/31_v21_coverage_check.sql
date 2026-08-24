-- V21 · Comprobación de la REGLA DE ORO: ningún nivel puede quedarse sin
-- ninguna promoción en ningún tramo de la noche.  Un bronce sin nada a las
-- 00:00 es un fallo de configuración, no una decisión de producto — y es fácil
-- de provocar tocando horarios, así que el panel avisa AL GUARDAR en lugar de
-- que se descubra un sábado a las dos de la mañana.
--
-- Recorre nivel × noche × hora de apertura y devuelve solo los HUECOS.
create or replace function public.check_promo_coverage(
	p_tenant_id uuid,
	p_days smallint[] default array[2,3,4,5,6]::smallint[],
	p_hour_from smallint default 22,
	p_hours int default 8)
returns table (tier_code text, display_name text, dow smallint, hour_local smallint)
language sql stable security definer set search_path = public as $function$
	with tiers as (
		select t.tier_code, t.display_name, t.sort_order
		  from tenant_tier_thresholds t where t.tenant_id = p_tenant_id
	),
	momentos as (
		select d.dow, h.h,
		       ((date_trunc('week', now() at time zone 'Europe/Madrid')
		         + ((d.dow - 1) || ' days')::interval
		         + ((p_hour_from + h.h) || ' hours')::interval)
		        at time zone 'Europe/Madrid') as ts
		  from unnest(p_days) as d(dow),
		       generate_series(0, greatest(0, p_hours - 1)) as h(h)
	)
	select ti.tier_code, ti.display_name, m.dow,
	       (extract(hour from m.ts at time zone 'Europe/Madrid'))::smallint
	  from tiers ti
	  cross join momentos m
	 where not exists (select 1 from matching_rules(p_tenant_id, ti.tier_code, m.ts))
	 order by ti.sort_order, m.dow, m.ts
$function$;

grant execute on function public.check_promo_coverage(uuid, smallint[], smallint, int) to service_role;
