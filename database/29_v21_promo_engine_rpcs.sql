-- V21 · Motor de promociones — LÓGICA
--
-- Resolución del catálogo por usuario, compra con el coste calculado y Flash
-- Drops medibles.  Es la ÚNICA fuente de verdad de precios y disponibilidad:
-- ni la app ni el panel replican estas reglas.
--
--   · El coste NO se guarda, se calcula: descuento € × tasa del nivel.  Por eso
--     un producto existe una sola vez en vez de una por nivel.
--   · Una regla de `product_availability` puede sobrescribir el precio y la
--     tasa: un Flash Drop es "durante 30 minutos todos pagáis como Platino".
--   · Cada rechazo de compra lleva su SQLSTATE (NG001…NG008) para que el API
--     no tenga que adivinar el motivo leyendo el texto del mensaje.
--
-- Aplicado en Supabase el 2026-08-21.  El porqué, en docs/DISENO_PROMOCIONES.md.

la app no replica ninguna de estas reglas.

-- ── ¿Estamos dentro de la franja horaria? ─────────────────────────────────
-- Si hour_from > hour_to la ventana cruza medianoche (22 → 02 = hasta las 2 de
-- la madrugada), que es el caso NORMAL en una discoteca.
create or replace function public.in_hour_window(p_from smallint, p_to smallint, p_ts timestamptz)
returns boolean language sql immutable as $$
	select case
		when p_from is null or p_to is null then true
		when p_from > p_to then extract(hour from p_ts at time zone 'Europe/Madrid') >= p_from
		                     or extract(hour from p_ts at time zone 'Europe/Madrid') <  p_to
		else extract(hour from p_ts at time zone 'Europe/Madrid') >= p_from
		 and extract(hour from p_ts at time zone 'Europe/Madrid') <  p_to
	end
$$;

-- El catálogo tiene que enseñar el precio de la campaña, no el del nivel.
create or replace function public.describe_days(p_days smallint[])
returns text language sql immutable as $function$
	select case
		when p_days is null or array_length(p_days,1) is null then null
		when p_days @> array[2,3,4]::smallint[] and not (p_days && array[5,6,7]::smallint[])
			then 'de martes a jueves'
		when p_days @> array[5,6]::smallint[] and not (p_days && array[2,3,4]::smallint[])
			then 'viernes y sábado'
		else (select string_agg(
			case d when 1 then 'lunes' when 2 then 'martes' when 3 then 'miércoles'
			       when 4 then 'jueves' when 5 then 'viernes' when 6 then 'sábado'
			       else 'domingo' end, ', ' order by d)
		      from unnest(p_days) d)
	end
$function$;

-- Código legible y estable: FD-20260821-01.  Se lee en un dashboard sin
-- traducir uuids y sobrevive al borrado de la regla, porque se copia a
-- user_rewards en el momento del canje.
create or replace function public.next_campaign_code(p_tenant_id uuid, p_prefix text)
returns text language sql stable security definer set search_path to 'public' as $function$
	select p_prefix || '-' || to_char(business_night(now()), 'YYYYMMDD') || '-' ||
	       lpad((1 + count(*))::text, 2, '0')
	  from product_availability
	 where tenant_id = p_tenant_id
	   and campaign_code like p_prefix || '-' || to_char(business_night(now()), 'YYYYMMDD') || '-%'
$function$;

create or replace function public.get_promo_catalog(p_tenant_id uuid, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
			 order by m.promo_price_eur asc, (m.kind <> 'base') desc limit 1) nr on true
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
end $$;

create or replace function public.create_flash_drop(
	p_tenant_id uuid, p_product_id uuid, p_promo_price_eur numeric,
	p_minutes int, p_stock int default null, p_tier_code text default null,
	p_label text default null, p_tokens_per_euro int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; v_name text; v_list numeric; v_rate int;
begin
	select name, list_price_eur into v_name, v_list from tenant_products
	 where id = p_product_id and tenant_id = p_tenant_id and is_active;
	if not found then raise exception 'Producto no encontrado'; end if;
	if p_minutes is null or p_minutes < 1 then raise exception 'Duración inválida'; end if;
	if p_promo_price_eur >= v_list then
		raise exception 'El precio del drop (%€) no mejora el de barra (%€)', p_promo_price_eur, v_list;
	end if;

	-- Por defecto, la tasa más baja de la casa: el drop iguala a todo el mundo
	-- por arriba durante unos minutos.
	v_rate := coalesce(p_tokens_per_euro,
		(select min(tokens_per_euro) from tenant_tier_thresholds where tenant_id = p_tenant_id));
	v_code := next_campaign_code(p_tenant_id, 'FD');

	insert into product_availability (
		tenant_id, product_id, tier_code, promo_price_eur, tokens_per_euro,
		valid_from, valid_to, stock_total, kind, campaign_code, label)
	values (p_tenant_id, p_product_id, p_tier_code, p_promo_price_eur, v_rate,
		now(), now() + (p_minutes || ' minutes')::interval, p_stock, 'flash_drop', v_code,
		coalesce(p_label, v_name || ' a ' || trim(to_char(p_promo_price_eur,'FM999')) || '€'))
	returning id into v_id;

	return jsonb_build_object('rule_id', v_id, 'campaign_code', v_code,
		'product_name', v_name, 'tokens_per_euro', v_rate,
		'cost_tokens', round((v_list - p_promo_price_eur) * v_rate),
		'ends_at', now() + (p_minutes || ' minutes')::interval, 'stock', p_stock);
end $$;

-- Cortarlo antes de tiempo (se agotó la barra, cambió el ambiente…).
-- No se borra: se desactiva, para que sus métricas sigan existiendo.
create or replace function public.end_flash_drop(p_tenant_id uuid, p_rule_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
	update product_availability set is_active = false, valid_to = least(valid_to, now())
	 where id = p_rule_id and tenant_id = p_tenant_id and kind = 'flash_drop'
	returning campaign_code into v_code;
	if not found then raise exception 'Flash drop no encontrado'; end if;
	return jsonb_build_object('campaign_code', v_code, 'ended', true);
end $$;

create or replace function public.matching_rules(
	p_tenant_id uuid, p_tier text, p_ts timestamptz default now())
returns table (
	rule_id uuid, product_id uuid, promo_price_eur numeric, tokens_per_euro int,
	kind text, campaign_code text, label text,
	max_per_night smallint, max_per_week smallint)
language sql stable security definer set search_path = public as $$
	select a.id, a.product_id, coalesce(a.promo_price_eur, p.promo_price_eur),
	       a.tokens_per_euro, a.kind, a.campaign_code, a.label,
	       a.max_per_night, a.max_per_week
	  from product_availability a
	  join tenant_products p on p.id = a.product_id
	 where a.tenant_id = p_tenant_id and a.is_active and p.is_active
	   and (a.tier_code is null or a.tier_code = p_tier)
	   and (a.days is null or array_length(a.days,1) is null
	        or extract(isodow from business_night(p_ts))::smallint = any(a.days))
	   and in_hour_window(a.hour_from, a.hour_to, p_ts)
	   and (a.valid_from is null or p_ts >= a.valid_from)
	   and (a.valid_to   is null or p_ts <= a.valid_to)
	   and (a.stock_total is null or a.stock_used < a.stock_total)
$$;

el mensaje, copy.
--
--   NG001 saldo insuficiente      NG005 límite de canjes del nivel
--   NG002 perfil no encontrado    NG006 límite de la promoción (noche)
--   NG003 no disponible ahora     NG007 límite de la promoción (semana)
--   NG004 promoción agotada       NG008 producto inexistente o inactivo
create or replace function public.purchase_reward(
	p_tenant_id uuid, p_user_id uuid, p_product_id uuid, p_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
	 order by m.promo_price_eur asc, (m.kind <> 'base') desc limit 1;
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
end $$;

-- V21 · Motor de promociones — LÓGICA
-- Resolución del catálogo por usuario, compra con coste calculado y Flash
-- Drops medibles.  Única fuente de verdad de precios y disponibilidad.
--
-- Aplicadas en Supabase el 2026-08-21.  El porqué de cada decisión está
-- en docs/DISENO_PROMOCIONES.md.

-- ── v21_promo_engine ──
-- Motor de promociones: resuelve QUÉ ve cada usuario, a QUÉ PRECIO y POR QUÉ.
-- Es la única fuente de verdad;

grant execute on function public.in_hour_window(smallint,smallint,timestamptz) to service_role, authenticated, anon;

grant execute on function public.matching_rules(uuid,text,timestamptz) to service_role;

grant execute on function public.get_promo_catalog(uuid,uuid) to service_role, authenticated;

grant execute on function public.describe_days(smallint[]) to service_role, authenticated;

grant execute on function public.create_flash_drop(uuid,uuid,numeric,int,int,text,text) to service_role;

grant execute on function public.end_flash_drop(uuid,uuid) to service_role;

grant execute on function public.next_campaign_code(uuid,text) to service_role;

grant select on public.campaign_performance to service_role;

comment on column public.product_availability.tokens_per_euro is
	'Sobrescribe la tasa del nivel durante esta campaña (75 = todos pagan como Platino). NULL = tasa del nivel.';

grant execute on function public.create_flash_drop(uuid,uuid,numeric,int,int,text,text,int) to service_role;
