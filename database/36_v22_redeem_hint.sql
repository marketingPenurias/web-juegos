-- V22 · "¿Y esto para qué me da?"
--
-- La economía se recalibró para que alguien nuevo pueda canjear algo en su
-- primera noche, pero nadie se lo dice: el check-in celebra "+50 tokens" y un
-- número suelto no significa nada para quien acaba de entrar.  Traducirlo a
-- producto es lo que convierte tokens en ganas.
--
-- Devuelve dos cosas, y con una basta para el mensaje:
--   · `affordable` — lo mejor que YA puede pedir ahora mismo.
--   · `next`       — lo más cerca que le queda, y cuántos tokens le faltan.
--
-- "Lo mejor" es lo más caro que puede permitirse, no lo más barato: si le llega
-- para la copa, decirle que le da para un chupito lo vende peor.
--
-- Aplicado en Supabase el 2026-08-24.
create or replace function public.redeem_hint(p_tenant_id uuid, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
	v_balance int;
	v_catalog jsonb;
	v_affordable jsonb;
	v_next jsonb;
begin
	select token_balance into v_balance
	  from user_profiles where id = p_user_id and tenant_id = p_tenant_id;
	if not found then return null; end if;

	-- Se reutiliza el catálogo ya resuelto: mismas reglas de nivel, día, hora,
	-- vigencia y stock que verá en el menú.  Prometer aquí algo que el menú le
	-- niegue sería peor que no decir nada.
	v_catalog := get_promo_catalog(p_tenant_id, p_user_id);

	select jsonb_build_object(
	         'name', p->>'name',
	         'promo_price_eur', (p->>'promo_price_eur')::numeric,
	         'cost_tokens', (p->>'cost_tokens')::int)
	  into v_affordable
	  from jsonb_array_elements(v_catalog->'products') p
	 where p->>'status' = 'available'
	   and (p->>'cost_tokens')::int <= v_balance
	 order by (p->>'cost_tokens')::int desc
	 limit 1;

	select jsonb_build_object(
	         'name', p->>'name',
	         'promo_price_eur', (p->>'promo_price_eur')::numeric,
	         'cost_tokens', (p->>'cost_tokens')::int,
	         'missing', (p->>'cost_tokens')::int - v_balance)
	  into v_next
	  from jsonb_array_elements(v_catalog->'products') p
	 where p->>'status' = 'available'
	   and (p->>'cost_tokens')::int > v_balance
	 order by (p->>'cost_tokens')::int asc
	 limit 1;

	return jsonb_build_object(
		'balance', v_balance,
		'affordable', v_affordable,
		'next', v_next,
		-- Si ya gastó los canjes de la noche, el mensaje correcto es otro:
		-- prometerle una copa que no puede pedir sería mentirle.
		'redemptions_left', v_catalog->'redemptions_left');
end $function$;

grant execute on function public.redeem_hint(uuid, uuid) to service_role;
