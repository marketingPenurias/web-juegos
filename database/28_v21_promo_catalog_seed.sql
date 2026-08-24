-- V21 · Motor de promociones — CATÁLOGO
-- Fusiona los 22 productos duplicados en 13 reales con precios de barra y
-- genera sus reglas de disponibilidad.  `seed_default_catalog` es reutilizable:
-- da de alta el catálogo de una discoteca nueva.
--
-- Aplicadas en Supabase el 2026-08-21.  El porqué de cada decisión está
-- en docs/DISENO_PROMOCIONES.md.

-- ── v21_seed_default_catalog ──
-- Catálogo por defecto de una sala: productos con precios REALES de barra y sus
-- reglas de disponibilidad por nivel.
--
-- Es una función y no un INSERT suelto porque dar de alta una discoteca nueva
-- necesita exactamente esto (onboarding en 1 clic).  Idempotente: se puede
-- reejecutar sin duplicar.

create or replace function public.seed_default_catalog(p_tenant_id uuid)
returns table (productos int, reglas int)
language plpgsql security definer set search_path = public as $$
declare
	v_prod int;
	v_rules int;
	r record;
begin
	-- ── Productos ────────────────────────────────────────────────────────────
	-- El descuento es list - promo; el coste en tokens se CALCULA con la tasa
	-- del nivel, así que aquí no hay ni un solo precio en tokens.
	-- Regla del local: si lleva Red Bull, +1 € sobre la versión normal.
	create temp table _cat (name text, ptype text, list numeric, promo numeric, ord int) on commit drop;
	insert into _cat values
		('Agua',                'drink',  3,  2,  10),
		('Chupito',             'drink',  3,  2,  20),
		('Refresco',            'drink',  4,  3,  30),
		('Chupito Especial',    'drink',  4,  2,  40),
		('Cerveza',             'drink',  5,  4,  50),
		('Vino',                'drink',  5,  4,  60),
		('Sangría',             'drink',  5,  4,  70),
		('Red Bull',            'drink',  5,  4,  80),
		('Copa',                'drink',  9,  6,  90),
		('Copa + Red Bull',     'drink', 10,  7, 100),
		('Copa Premium',        'drink', 12,  9, 110),
		('Copa Premium + Red Bull','drink',13,10, 120),
		('Botella de Vino',     'drink', 20, 14, 130);

	for r in select * from _cat loop
		update tenant_products p
		   set list_price_eur = r.list, promo_price_eur = r.promo,
		       product_type = r.ptype, redemption_type = 'discount', is_active = true
		 where p.tenant_id = p_tenant_id and p.name = r.name;
		if not found then
			insert into tenant_products (tenant_id, name, product_type, list_price_eur,
			                             promo_price_eur, redemption_type, price_tokens,
			                             reference_fiat, is_active)
			values (p_tenant_id, r.name, r.ptype, r.list, r.promo, 'discount', 0, r.promo, true);
		end if;
	end loop;

	select count(*) into v_prod from tenant_products
	 where tenant_id = p_tenant_id and redemption_type = 'discount' and is_active;

	-- ── Disponibilidad ───────────────────────────────────────────────────────
	-- REGLA DE ORO: lo barato está para TODOS y TODA la noche.  Lo que se gana
	-- subiendo de nivel es la copa en hora punta, no el derecho a existir.
	delete from product_availability
	 where tenant_id = p_tenant_id and kind = 'base';

	-- 1) Siempre, para todo el mundo (bronce incluido, a cualquier hora).
	insert into product_availability (tenant_id, product_id, tier_code, label)
	select p_tenant_id, p.id, null, 'Siempre disponible'
	  from tenant_products p
	 where p.tenant_id = p_tenant_id
	   and p.name in ('Agua','Chupito','Refresco','Cerveza','Vino','Sangría','Red Bull');

	-- 2) Chupito especial: bronce entre semana; del resto, siempre.
	insert into product_availability (tenant_id, product_id, tier_code, days, label)
	select p_tenant_id, p.id, 'bronce', array[2,3,4]::smallint[], 'Bronce · entre semana'
	  from tenant_products p where p.tenant_id = p_tenant_id and p.name = 'Chupito Especial';
	insert into product_availability (tenant_id, product_id, tier_code, label)
	select p_tenant_id, p.id, t, 'Siempre disponible'
	  from tenant_products p, unnest(array['plata','oro','platino']) t
	 where p.tenant_id = p_tenant_id and p.name = 'Chupito Especial';

	-- 3) Copa y Copa+RB: entre semana toda la noche para todos.  El fin de
	--    semana la hora de corte sube con el nivel — ahí está la ambición.
	insert into product_availability (tenant_id, product_id, tier_code, days, label)
	select p_tenant_id, p.id, t, array[2,3,4]::smallint[], 'Entre semana · toda la noche'
	  from tenant_products p, unnest(array['bronce','plata','oro','platino']) t
	 where p.tenant_id = p_tenant_id and p.name in ('Copa','Copa + Red Bull');

	insert into product_availability (tenant_id, product_id, tier_code, days, hour_from, hour_to, promo_price_eur, label)
	select p_tenant_id, p.id, v.tier, array[5,6]::smallint[], 22, v.hasta,
	       case when p.name = 'Copa' then 7 else 8 end,   -- finde: 1 € menos de dto.
	       'Fin de semana · hasta las ' || lpad(v.hasta::text,2,'0') || ':00'
	  from tenant_products p,
	       (values ('bronce',0),('plata',2),('oro',4),('platino',6)) as v(tier,hasta)
	 where p.tenant_id = p_tenant_id and p.name in ('Copa','Copa + Red Bull');

	-- 4) Premium: de Plata para arriba.
	insert into product_availability (tenant_id, product_id, tier_code, days, label)
	select p_tenant_id, p.id, 'plata', array[2,3,4]::smallint[], 'Plata · entre semana'
	  from tenant_products p
	 where p.tenant_id = p_tenant_id and p.name in ('Copa Premium','Copa Premium + Red Bull');
	insert into product_availability (tenant_id, product_id, tier_code, label)
	select p_tenant_id, p.id, t, 'Siempre disponible'
	  from tenant_products p, unnest(array['oro','platino']) t
	 where p.tenant_id = p_tenant_id and p.name in ('Copa Premium','Copa Premium + Red Bull');

	-- 5) Botella: Oro y Platino.
	insert into product_availability (tenant_id, product_id, tier_code, label)
	select p_tenant_id, p.id, t, 'Oro y Platino'
	  from tenant_products p, unnest(array['oro','platino']) t
	 where p.tenant_id = p_tenant_id and p.name = 'Botella de Vino';

	select count(*) into v_rules from product_availability where tenant_id = p_tenant_id;
	return query select v_prod, v_rules;
end $$;

grant execute on function public.seed_default_catalog(uuid) to service_role;;

-- ── v21_merge_duplicate_products ──
-- Fusiona el catálogo duplicado.  Había 22 productos por sala para 7 reales:
-- "Copa Nacional 6€", "— Oro" y "— Plata" son EL MISMO producto repetido una vez
-- por nivel, porque el precio en tokens estaba guardado en la fila.  Ahora el
-- coste se calcula, así que sobra la duplicación.

-- El seed solo debe borrar las reglas de SUS productos, no las de items
-- heredados como la Reserva Prioritaria.
create or replace function public.seed_default_catalog(p_tenant_id uuid)
returns table (productos int, reglas int)
language plpgsql security definer set search_path = public as $$
declare v_prod int; v_rules int; r record; v_names text[];
begin
	create temp table _cat (name text, ptype text, list numeric, promo numeric, ord int) on commit drop;
	insert into _cat values
		('Agua','drink',3,2,10),('Chupito','drink',3,2,20),('Refresco','drink',4,3,30),
		('Chupito Especial','drink',4,2,40),('Cerveza','drink',5,4,50),('Vino','drink',5,4,60),
		('Sangría','drink',5,4,70),('Red Bull','drink',5,4,80),('Copa','drink',9,6,90),
		('Copa + Red Bull','drink',10,7,100),('Copa Premium','drink',12,9,110),
		('Copa Premium + Red Bull','drink',13,10,120),('Botella de Vino','drink',20,14,130);

	for r in select * from _cat loop
		update tenant_products p set list_price_eur=r.list, promo_price_eur=r.promo,
		       product_type=r.ptype, redemption_type='discount', is_active=true
		 where p.tenant_id=p_tenant_id and p.name=r.name;
		if not found then
			insert into tenant_products (tenant_id,name,product_type,list_price_eur,promo_price_eur,
			                             redemption_type,price_tokens,reference_fiat,is_active)
			values (p_tenant_id,r.name,r.ptype,r.list,r.promo,'discount',0,r.promo,true);
		end if;
	end loop;
	select array_agg(name) into v_names from _cat;
	select count(*) into v_prod from tenant_products
	 where tenant_id=p_tenant_id and name = any(v_names) and is_active;

	delete from product_availability a using tenant_products p
	 where a.product_id=p.id and a.tenant_id=p_tenant_id and a.kind='base' and p.name = any(v_names);

	insert into product_availability (tenant_id,product_id,tier_code,label)
	select p_tenant_id,p.id,null,'Siempre disponible' from tenant_products p
	 where p.tenant_id=p_tenant_id and p.name in ('Agua','Chupito','Refresco','Cerveza','Vino','Sangría','Red Bull');

	insert into product_availability (tenant_id,product_id,tier_code,days,label)
	select p_tenant_id,p.id,'bronce',array[2,3,4]::smallint[],'Bronce · entre semana'
	  from tenant_products p where p.tenant_id=p_tenant_id and p.name='Chupito Especial';
	insert into product_availability (tenant_id,product_id,tier_code,label)
	select p_tenant_id,p.id,t,'Siempre disponible' from tenant_products p, unnest(array['plata','oro','platino']) t
	 where p.tenant_id=p_tenant_id and p.name='Chupito Especial';

	insert into product_availability (tenant_id,product_id,tier_code,days,label)
	select p_tenant_id,p.id,t,array[2,3,4]::smallint[],'Entre semana · toda la noche'
	  from tenant_products p, unnest(array['bronce','plata','oro','platino']) t
	 where p.tenant_id=p_tenant_id and p.name in ('Copa','Copa + Red Bull');
	insert into product_availability (tenant_id,product_id,tier_code,days,hour_from,hour_to,promo_price_eur,label)
	select p_tenant_id,p.id,v.tier,array[5,6]::smallint[],22,v.hasta,
	       case when p.name='Copa' then 7 else 8 end,
	       'Fin de semana · hasta las '||lpad(v.hasta::text,2,'0')||':00'
	  from tenant_products p, (values ('bronce',0),('plata',2),('oro',4),('platino',6)) as v(tier,hasta)
	 where p.tenant_id=p_tenant_id and p.name in ('Copa','Copa + Red Bull');

	insert into product_availability (tenant_id,product_id,tier_code,days,label)
	select p_tenant_id,p.id,'plata',array[2,3,4]::smallint[],'Plata · entre semana' from tenant_products p
	 where p.tenant_id=p_tenant_id and p.name in ('Copa Premium','Copa Premium + Red Bull');
	insert into product_availability (tenant_id,product_id,tier_code,label)
	select p_tenant_id,p.id,t,'Siempre disponible' from tenant_products p, unnest(array['oro','platino']) t
	 where p.tenant_id=p_tenant_id and p.name in ('Copa Premium','Copa Premium + Red Bull');

	insert into product_availability (tenant_id,product_id,tier_code,label)
	select p_tenant_id,p.id,t,'Oro y Platino' from tenant_products p, unnest(array['oro','platino']) t
	 where p.tenant_id=p_tenant_id and p.name='Botella de Vino';

	select count(*) into v_rules from product_availability where tenant_id=p_tenant_id;
	return query select v_prod, v_rules;
end $$;

-- ── Renombrar los originales CON HISTORIAL para que el seed los reutilice ──
-- Si no, el seed crearía filas nuevas y los canjes ya hechos quedarían colgando
-- de un producto huérfano, falseando las métricas.
update public.tenant_products set name='Chupito'         where name='Chupito Normal a 2€';
update public.tenant_products set name='Chupito Especial' where name='Chupito Especial a 3€';
update public.tenant_products set name='Copa'             where name='Copa Nacional 6€'   and min_tier_required='platino';
update public.tenant_products set name='Copa + Red Bull'  where name='Copa + Red Bull 8€' and min_tier_required='platino' and price_tokens=750;

-- ── Borrar los duplicados ──
-- Solo se borra lo que NO tiene canjes: el historial manda sobre la limpieza.
delete from public.tenant_products p
 where (p.name like 'Copa Nacional %' or p.name like 'Copa + Red Bull %'
        or p.name like '2× Copas Nacionales%' or p.name = 'Chupito Gratis con 2 Copas')
   and not exists (select 1 from public.user_rewards r where r.product_id = p.id);

-- ── Los que no son descuento (canje directo por tokens) ──
update public.tenant_products
   set redemption_type='free_product'
 where name in ('Pack Leyenda: 3 chupitos GRATIS con 3 copas','Reserva Prioritaria');

-- Su disponibilidad se deriva del min_tier_required que ya tenían.
insert into public.product_availability (tenant_id, product_id, tier_code, days, label, kind)
select p.tenant_id, p.id, 'platino', p.available_days, 'Platino', 'base'
  from public.tenant_products p
 where p.redemption_type='free_product'
   and not exists (select 1 from public.product_availability a where a.product_id=p.id);;

-- ── v21_legacy_price_bridge ──
-- Puente temporal.  El coste real lo calcula el motor, pero la app HOY
-- desplegada todavía pinta `price_tokens` y mostraría "0 tokens" en todo el
-- menú.  Se rellena con el coste de bronce (el que ve la mayoría) para que la
-- versión en producción siga siendo coherente hasta que suba el frontend nuevo.
-- purchase_reward ya ignora esta columna, así que no hay riesgo de cobrar de
-- menos: solo afecta a lo que se pinta.
update public.tenant_products p
   set price_tokens = round((p.list_price_eur - p.promo_price_eur) * coalesce((
         select th.tokens_per_euro from public.tenant_tier_thresholds th
          where th.tenant_id = p.tenant_id and th.tier_code = 'bronce'), 150)),
       reference_fiat = p.promo_price_eur
 where p.redemption_type = 'discount' and p.list_price_eur is not null;

comment on column public.tenant_products.price_tokens is
	'OBSOLETA para redemption_type=discount: el coste lo calcula get_promo_catalog/purchase_reward (descuento × tasa del nivel). Se mantiene solo como valor de pintado para la versión anterior de la app; se eliminará cuando el frontend nuevo esté desplegado. Sigue siendo el coste real para redemption_type=free_product.';
comment on column public.tenant_products.min_tier_required is
	'OBSOLETA: la sustituye product_availability.tier_code, que permite reglas distintas por nivel y franja.';
comment on column public.tenant_products.available_days is
	'OBSOLETA: la sustituye product_availability.days.';;
