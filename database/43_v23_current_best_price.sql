-- 43 · v23 · Qué oferta está ganando ahora mismo, para el panel del DJ
--
--   El 3 de septiembre se lanzó una Copa a 8 € cuando la carta ya la tenía a
--   7 €.  El panel no enseñaba el precio vigente, así que no había forma de
--   saber que ese drop no mejoraba nada.
--
--   Devuelve, para el nivel de ENTRADA —que es donde está casi todo el
--   mundo—, la regla que gana hoy en cada producto y lo que cuesta en
--   fichas.  Se calcula con el mismo criterio que `get_promo_catalog`: por
--   coste real en fichas, no por precio en euros.  Si aquí saliera otra cosa
--   que en la app, el panel mentiría.

create or replace function public.get_current_best_prices(p_tenant_id uuid)
returns table(
	product_id       uuid,
	product_name     text,
	list_price_eur   numeric,
	kind             text,
	label            text,
	promo_price_eur  numeric,
	cost_tokens      int,
	tier_code        text
)
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v_tier text; v_rate int;
begin
	-- Nivel de entrada: el que tiene casi toda la sala.
	select th.tier_code, th.tokens_per_euro into v_tier, v_rate
	  from tenant_tier_thresholds th
	 where th.tenant_id = p_tenant_id
	 order by th.sort_order limit 1;
	if v_tier is null then return; end if;

	return query
	select p.id, p.name, p.list_price_eur,
	       coalesce(nr.kind, 'base'), nr.label,
	       coalesce(nr.promo_price_eur, p.promo_price_eur),
	       (case when p.redemption_type = 'free_product' then p.price_tokens
	             else round((p.list_price_eur
	                         - coalesce(nr.promo_price_eur, p.promo_price_eur))
	                        * coalesce(nr.tokens_per_euro, v_rate)) end)::int,
	       v_tier
	from tenant_products p
	left join lateral (
		select * from matching_rules(p_tenant_id, v_tier) m where m.product_id = p.id
		 order by (case when p.redemption_type = 'free_product' then p.price_tokens
		                else round((p.list_price_eur - coalesce(m.promo_price_eur, p.promo_price_eur))
		                           * coalesce(m.tokens_per_euro, v_rate)) end) asc nulls last,
		          (m.kind <> 'base') desc
		 limit 1) nr on true
	where p.tenant_id = p_tenant_id and p.is_active
	  and p.redemption_type = 'discount'
	order by p.list_price_eur;
end $$;

revoke all on function public.get_current_best_prices(uuid) from public, anon, authenticated;
grant execute on function public.get_current_best_prices(uuid) to service_role;
