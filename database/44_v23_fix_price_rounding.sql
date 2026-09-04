-- 44 · v23 · La etiqueta del drop redondeaba el precio
--
--   Probando por la interfaz: se lanza un Chupito a 2,50 € y el drop queda
--   etiquetado «Chupito a 3€».  El cliente lee 3 € en la app y paga 2,50 —
--   a su favor, pero el precio anunciado y el real no coinciden, y con un
--   redondeo al alza sería al revés.
--
--   La culpa es de `to_char(..., 'FM999')`, que no tiene decimales.  Ahora
--   solo se enseñan cuando los hay: 3 € sigue siendo «3€», y 2,50 pasa a ser
--   «2,50€».  Con coma, que es como se escribe aquí.

create or replace function public.create_flash_drop(
	p_tenant_id uuid, p_product_id uuid, p_promo_price_eur numeric, p_minutes integer,
	p_stock integer default null, p_tier_code text default null,
	p_label text default null, p_tokens_per_euro integer default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_code text; v_id uuid; v_name text; v_list numeric; v_rate int; v_precio text;
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

	-- Decimales solo si los hay, y con coma.
	v_precio := case
		when p_promo_price_eur = trunc(p_promo_price_eur)
			then trim(to_char(p_promo_price_eur, 'FM999'))
		else replace(trim(to_char(p_promo_price_eur, 'FM999.00')), '.', ',')
	end;

	insert into product_availability (
		tenant_id, product_id, tier_code, promo_price_eur, tokens_per_euro,
		valid_from, valid_to, stock_total, kind, campaign_code, label)
	values (p_tenant_id, p_product_id, p_tier_code, p_promo_price_eur, v_rate,
		now(), now() + (p_minutes || ' minutes')::interval, p_stock, 'flash_drop', v_code,
		coalesce(p_label, v_name || ' a ' || v_precio || '€'))
	returning id into v_id;

	return jsonb_build_object('rule_id', v_id, 'campaign_code', v_code,
		'product_name', v_name, 'tokens_per_euro', v_rate,
		'cost_tokens', round((v_list - p_promo_price_eur) * v_rate),
		'ends_at', now() + (p_minutes || ' minutes')::interval, 'stock', p_stock);
end $function$;
