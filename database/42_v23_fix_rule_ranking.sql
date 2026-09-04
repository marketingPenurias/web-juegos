-- 42 · v23 · Elegir la regla por lo que paga el usuario, no por el precio en euros
--
--   El 3 de septiembre el DJ lanzó un flash drop y no apareció en la app.
--   No lo configuró mal: el sistema lo escondía.
--
--   La Copa (9 € en barra) tenía una promoción base a 7 € — dos euros de
--   descuento, cobrados a la tasa del nivel.  Su drop la dejaba en 8 €, un
--   euro de descuento, pero con tasa propia de 75 fichas/€.  Para un usuario
--   Bronce (150 fichas/€) eso era:
--
--       base  →  2 € × 150 = 300 fichas
--       drop  →  1 € ×  75 =  75 fichas     ← cuatro veces más barato
--
--   Y sin embargo ganaba la base, porque tanto `get_promo_catalog` como
--   `purchase_reward` ordenaban por `promo_price_eur asc`: 7 € gana a 8 €.
--   Se comparaba el precio en euros cuando lo que la gente paga son FICHAS,
--   y las dos ordenaciones dejan de coincidir en cuanto un drop lleva tasa
--   propia — que es justo para lo que existe la tasa propia.
--
--   Se ordena por el coste real en fichas, la misma expresión con la que
--   luego se cobra.  Las dos funciones tienen que usar el mismo criterio: si
--   discrepan, la app enseña un precio y el cobro aplica otro.
--
--   El desempate sigue favoreciendo a la campaña sobre la base: a igualdad
--   de fichas, se enseña el drop, que es lo que crea urgencia.

create or replace function public.get_promo_catalog(p_tenant_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
	v_lifetime int; v_balance int; v_tier text; v_rate int; v_ord smallint;
	v_next_tier text; v_next_rate int; v_next_min int;
	v_max_night smallint; v_used_night int; v_dow smallint; v_out jsonb;
begin
	select lifetime_earned, token_balance into v_lifetime, v_balance
	  from user_profiles where id = p_user_id and tenant_id = p_tenant_id;
	if not found then raise exception 'Perfil no encontrado'; end if;

	v_tier := get_user_tier(p_tenant_id, v_lifetime);
	v_dow  := extract(isodow from business_night(now()))::smallint;
	select tokens_per_euro, max_redemptions_per_night, sort_order
	  into v_rate, v_max_night, v_ord
	  from tenant_tier_thresholds where tenant_id = p_tenant_id and tier_code = v_tier;
	select tier_code, tokens_per_euro, min_lifetime
	  into v_next_tier, v_next_rate, v_next_min
	  from tenant_tier_thresholds
	 where tenant_id = p_tenant_id and sort_order > v_ord order by sort_order limit 1;

	select count(*) into v_used_night from user_rewards
	 where tenant_id = p_tenant_id and user_id = p_user_id
	   and status in ('available','redeeming','consumed')
	   and business_night(created_at) = business_night(now());

	select jsonb_agg(x order by ord) into v_out from (
		select
			(case when p.redemption_type = 'free_product' then p.price_tokens
			      else round((p.list_price_eur - coalesce(nr.promo_price_eur, p.promo_price_eur))
			                 * coalesce(nr.tokens_per_euro, v_rate)) end) as ord,
			jsonb_build_object(
				'product_id', p.id, 'name', p.name, 'type', p.product_type,
				'redemption_type', p.redemption_type,
				'list_price_eur', p.list_price_eur,
				'promo_price_eur', coalesce(nr.promo_price_eur, p.promo_price_eur),
				'discount_eur', case when p.redemption_type = 'discount'
					then p.list_price_eur - coalesce(nr.promo_price_eur, p.promo_price_eur) end,
				'cost_tokens', case when p.redemption_type = 'free_product' then p.price_tokens
					else round((p.list_price_eur - coalesce(nr.promo_price_eur, p.promo_price_eur))
					           * coalesce(nr.tokens_per_euro, v_rate)) end,
				-- Con una campaña activa la tasa ya es la mejor: no se promete
				-- una rebaja extra por subir de nivel que no va a llegar.
				'cost_at_next_tier', case
					when v_next_tier is null or p.redemption_type = 'free_product'
					     or nr.tokens_per_euro is not null then null
					else round((p.list_price_eur - coalesce(nr.promo_price_eur, p.promo_price_eur)) * v_next_rate) end,
				'status', case when nr.rule_id is not null then 'available'
				               when tr.n > 0 then 'not_now' else 'locked_tier' end,
				'rule_id', nr.rule_id, 'campaign_code', nr.campaign_code,
				'kind', coalesce(nr.kind, 'base'), 'label', nr.label,
				'unlock_hint', case
					when nr.rule_id is not null then null
					when hoy.hour_from is not null then
						'Hoy de ' || lpad(hoy.hour_from::text,2,'0') || ':00 a '
						           || lpad(hoy.hour_to::text,2,'0') || ':00'
					when tr.n > 0 then 'Solo ' || coalesce((
						select describe_days(a.days) from product_availability a
						 where a.product_id = p.id and a.is_active
						   and (a.tier_code is null or a.tier_code = v_tier)
						   and a.days is not null limit 1), 'otros días')
					else (select 'Desde ' || th.display_name from product_availability a
					        join tenant_tier_thresholds th
					          on th.tenant_id = a.tenant_id and th.tier_code = a.tier_code
					       where a.product_id = p.id and a.is_active
					       order by th.sort_order limit 1) end
			) as x
		from tenant_products p
		left join lateral (
			select * from matching_rules(p_tenant_id, v_tier) m where m.product_id = p.id
			 -- Por FICHAS, no por euros: es lo que paga el usuario, y es la
			 -- misma cuenta con la que `purchase_reward` cobra después.
			 order by (case when p.redemption_type = 'free_product' then p.price_tokens
			                else round((p.list_price_eur - coalesce(m.promo_price_eur, p.promo_price_eur))
			                           * coalesce(m.tokens_per_euro, v_rate)) end) asc nulls last,
			          (m.kind <> 'base') desc
			 limit 1) nr on true
		left join lateral (
			select count(*) as n from product_availability a
			 where a.product_id = p.id and a.is_active
			   and (a.tier_code is null or a.tier_code = v_tier)) tr on true
		left join lateral (
			select a.hour_from, a.hour_to from product_availability a
			 where a.product_id = p.id and a.is_active
			   and (a.tier_code is null or a.tier_code = v_tier)
			   and a.days is not null and v_dow = any(a.days) and a.hour_from is not null
			 order by a.hour_to desc limit 1) hoy on true
		where p.tenant_id = p_tenant_id and p.is_active
	) s;

	return jsonb_build_object(
		'tier', v_tier, 'tokens_per_euro', v_rate,
		'balance', v_balance, 'lifetime', v_lifetime,
		'next_tier', v_next_tier, 'next_tier_rate', v_next_rate,
		'tokens_to_next_tier', case when v_next_min is null then null
		                            else greatest(0, v_next_min - v_lifetime) end,
		'redemptions_left', case when v_max_night is null then null
		                         else greatest(0, v_max_night - v_used_night) end,
		'products', coalesce(v_out, '[]'::jsonb));
end $function$;

-- El mismo criterio en la compra.  Si el catálogo y el cobro ordenan
-- distinto, la app enseña un precio y luego se cobra otro — y el usuario
-- ve un cargo que no había aceptado.  Solo cambia el ORDER BY.
create or replace function public.purchase_reward(
	p_tenant_id uuid, p_user_id uuid, p_product_id uuid, p_event_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
	v_product record; v_rule record;
	v_balance int; v_lifetime int; v_tier text; v_rate int; v_eff_rate int;
	v_max_night smallint; v_used_night int; v_count int;
	v_discount numeric; v_cost int; v_reward_id uuid;
begin
	select * into v_product from tenant_products
	 where id = p_product_id and tenant_id = p_tenant_id and is_active;
	if not found then
		raise exception 'Producto no encontrado o inactivo' using errcode = 'NG008';
	end if;

	select token_balance, lifetime_earned into v_balance, v_lifetime
	  from user_profiles where id = p_user_id and tenant_id = p_tenant_id for update;
	if not found then
		raise exception 'Perfil de usuario no encontrado' using errcode = 'NG002';
	end if;

	v_tier := get_user_tier(p_tenant_id, v_lifetime);
	select tokens_per_euro, max_redemptions_per_night into v_rate, v_max_night
	  from tenant_tier_thresholds where tenant_id = p_tenant_id and tier_code = v_tier;

	select * into v_rule from matching_rules(p_tenant_id, v_tier) m
	 where m.product_id = p_product_id
	 order by (case when v_product.redemption_type = 'free_product' then v_product.price_tokens
	                else round((v_product.list_price_eur
	                            - coalesce(m.promo_price_eur, v_product.promo_price_eur))
	                           * coalesce(m.tokens_per_euro, v_rate)) end) asc nulls last,
	          (m.kind <> 'base') desc
	 limit 1;
	if not found then
		-- Agotada y "no disponible" se viven de forma muy distinta: llegar
		-- tarde a un drop no es que te falte nivel.
		if exists (select 1 from product_availability a
		            where a.product_id = p_product_id and a.tenant_id = p_tenant_id
		              and a.is_active and a.stock_total is not null
		              and a.stock_used >= a.stock_total
		              and (a.valid_to is null or now() <= a.valid_to)) then
			raise exception 'Promoción agotada' using errcode = 'NG004';
		end if;
		raise exception 'Esta promoción no está disponible ahora mismo para tu nivel'
			using errcode = 'NG003';
	end if;

	if v_max_night is not null then
		select count(*) into v_used_night from user_rewards
		 where tenant_id = p_tenant_id and user_id = p_user_id
		   and status in ('available','redeeming','consumed')
		   and business_night(created_at) = business_night(now());
		if v_used_night >= v_max_night then
			raise exception '%', case when v_max_night = 1
				then 'Ya has usado tu canje de esta noche'
				else 'Ya has usado tus ' || v_max_night || ' canjes de esta noche' end
				using errcode = 'NG005';
		end if;
	end if;

	if v_rule.max_per_night is not null then
		select count(*) into v_count from user_rewards
		 where tenant_id = p_tenant_id and user_id = p_user_id and availability_id = v_rule.rule_id
		   and status in ('available','redeeming','consumed')
		   and business_night(created_at) = business_night(now());
		if v_count >= v_rule.max_per_night then
			raise exception 'Límite por noche alcanzado para esta promoción' using errcode = 'NG006';
		end if;
	end if;
	if v_rule.max_per_week is not null then
		select count(*) into v_count from user_rewards
		 where tenant_id = p_tenant_id and user_id = p_user_id and availability_id = v_rule.rule_id
		   and status in ('available','redeeming','consumed')
		   and created_at >= now() - interval '7 days';
		if v_count >= v_rule.max_per_week then
			raise exception 'Límite semanal alcanzado para esta promoción' using errcode = 'NG007';
		end if;
	end if;

	v_eff_rate := coalesce(v_rule.tokens_per_euro, v_rate);
	if v_product.redemption_type = 'free_product' then
		v_discount := 0; v_cost := v_product.price_tokens;
	else
		v_discount := v_product.list_price_eur - v_rule.promo_price_eur;
		v_cost := round(v_discount * v_eff_rate);
	end if;

	if v_balance < v_cost then
		raise exception 'Saldo insuficiente: necesitas % y tienes %', v_cost, v_balance
			using errcode = 'NG001';
	end if;

	update product_availability set stock_used = stock_used + 1
	 where id = v_rule.rule_id and (stock_total is null or stock_used < stock_total);
	if not found then
		raise exception 'Promoción agotada' using errcode = 'NG004';
	end if;

	insert into wallet_ledger (tenant_id, user_id, amount, reason, event_id,
	                           product_id, product_name_at_time, price_tokens_at_time)
	values (p_tenant_id, p_user_id, -v_cost, 'reward_purchase', p_event_id,
	        p_product_id, v_product.name, v_cost);

	insert into user_rewards (tenant_id, user_id, product_id, event_id, status,
	                          availability_id, campaign_code, discount_eur)
	values (p_tenant_id, p_user_id, p_product_id, p_event_id, 'available',
	        v_rule.rule_id, v_rule.campaign_code, v_discount)
	returning id into v_reward_id;

	return jsonb_build_object(
		'reward_id', v_reward_id, 'new_balance', v_balance - v_cost,
		'product_name', v_product.name, 'product_id', v_product.id,
		'cost_tokens', v_cost, 'discount_eur', v_discount,
		'promo_price_eur', v_rule.promo_price_eur,
		'campaign_code', v_rule.campaign_code);
end $function$;
