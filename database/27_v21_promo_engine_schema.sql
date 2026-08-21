-- V21 · Motor de promociones — ESQUEMA
-- Precios reales de barra, tasa tk/€ por nivel y disponibilidad configurable
-- (días, franja horaria, vigencia, stock) con campañas identificables.
--
-- Aplicadas en Supabase el 2026-08-21.  El porqué de cada decisión está
-- en docs/DISENO_PROMOCIONES.md.

-- ── v21_promo_engine_schema ──
-- V21 · FASE 1 — Motor de promociones: precios reales, tasa por nivel y
-- disponibilidad (días, franja horaria, vigencia, stock) con CAMPAÑAS MEDIBLES.
--
-- Todo ADITIVO: no se borra ni se renombra nada, así La Pocha sigue funcionando
-- con el modelo viejo mientras se migra el sandbox.
--
-- Principios (ver docs/DISENO_PROMOCIONES.md):
--   · Los tokens compran DESCUENTO, no producto.
--   · El coste en tokens NO se guarda: se CALCULA (descuento € × tasa del nivel).
--     Eso elimina de raíz los productos duplicados por nivel.
--   · El nivel modula CUÁNDO y CUÁNTAS VECES, no qué existe.

-- ── 1. Producto: precio real de barra vs precio con la app ─────────────────
-- Hoy `reference_fiat` guarda el precio YA promocionado (6 €) y se pierde el de
-- barra (9 €), así que era imposible saber cuánto descuento se ha regalado.
alter table public.tenant_products
	add column if not exists list_price_eur  numeric(6,2),
	add column if not exists promo_price_eur numeric(6,2),
	add column if not exists redemption_type text not null default 'discount';

do $$ begin
	alter table public.tenant_products
		add constraint tenant_products_redemption_type_chk
		check (redemption_type in ('discount','free_product'));
exception when duplicate_object then null; end $$;

-- ── 2. Nivel: tasa de conversión y cuántos canjes por noche ────────────────
alter table public.tenant_tier_thresholds
	add column if not exists tokens_per_euro int,
	add column if not exists max_redemptions_per_night smallint;

-- ── 3. Disponibilidad: el CUÁNDO, por producto y nivel ─────────────────────
create table if not exists public.product_availability (
	id          uuid primary key default gen_random_uuid(),
	tenant_id   uuid not null references public.tenants(id) on delete cascade,
	product_id  uuid not null references public.tenant_products(id) on delete cascade,
	-- null = aplica a TODOS los niveles
	tier_code   text,
	-- null/vacío = todos los días.  ISO dow (1=lunes … 7=domingo)
	days        smallint[],
	-- Franja horaria en hora del local.  null = toda la noche.
	-- Si hour_from > hour_to la ventana CRUZA MEDIANOCHE (22 → 2).
	hour_from   smallint check (hour_from between 0 and 23),
	hour_to     smallint check (hour_to   between 0 and 23),
	-- Vigencia: campañas temporales sin tocar el catálogo
	valid_from  timestamptz,
	valid_to    timestamptz,
	-- Límites y stock (un Flash Drop = vigencia corta + stock)
	max_per_night smallint,
	max_per_week  smallint,
	stock_total   int,
	stock_used    int not null default 0,
	-- ── CAMPAÑAS MEDIBLES ──
	-- `kind` distingue la oferta permanente de una campaña, y `campaign_code`
	-- la identifica de forma estable para poder medir su rendimiento
	-- (canjes, € de descuento, consumo generado) aunque se repita otra noche.
	kind          text not null default 'base',
	campaign_code text,
	label         text,
	is_active   boolean not null default true,
	created_at  timestamptz not null default now()
);

do $$ begin
	alter table public.product_availability
		add constraint product_availability_kind_chk
		check (kind in ('base','flash_drop','happy_hour','campaign'));
exception when duplicate_object then null; end $$;

create index if not exists idx_availability_lookup
	on public.product_availability (tenant_id, product_id, tier_code) where is_active;
create index if not exists idx_availability_campaign
	on public.product_availability (tenant_id, campaign_code) where campaign_code is not null;

-- ── 4. Atribución del canje → qué regla/campaña lo generó ──────────────────
-- Sin esto no se puede medir una campaña: se sabría que hubo canjes, pero no
-- bajo qué oferta.  Se guarda también el código para que el histórico sobreviva
-- aunque la regla se borre.
alter table public.user_rewards
	add column if not exists availability_id uuid references public.product_availability(id) on delete set null,
	add column if not exists campaign_code   text,
	add column if not exists discount_eur    numeric(6,2);

create index if not exists idx_user_rewards_campaign
	on public.user_rewards (tenant_id, campaign_code) where campaign_code is not null;

grant select, insert, update, delete on public.product_availability to service_role;;

-- ── v21_availability_price_override ──
-- El precio promocional depende de CUÁNDO, no del producto: la misma copa vale
-- 6 € entre semana y 7 € el fin de semana.  Si viviera solo en el producto
-- habría que duplicarlo otra vez, que es justo el problema que arrastrábamos.
-- El producto guarda el promo por defecto; la regla puede sobrescribirlo.
alter table public.product_availability
	add column if not exists promo_price_eur numeric(6,2);

comment on column public.tenant_products.list_price_eur  is 'Precio de barra sin promoción (referencia real del local).';
comment on column public.tenant_products.promo_price_eur is 'Precio promocional por defecto; una regla de product_availability puede sobrescribirlo.';
comment on column public.product_availability.promo_price_eur is 'Sobrescribe el promo del producto para esta franja/campaña. NULL = usa el del producto.';
comment on column public.product_availability.campaign_code is 'Identificador estable de campaña (p.ej. FD-CHUPITO-1E) para medir su rendimiento en BI.';;

-- ── v21_tier_config ──
-- Tasa de conversión y límites por nivel.  Un platino obtiene el doble de
-- descuento por el mismo esfuerzo (75 tk/€ frente a 150).
update public.tenant_tier_thresholds set
	tokens_per_euro = case tier_code
		when 'bronce' then 150 when 'plata' then 125
		when 'oro'    then 100 when 'platino' then 75 end,
	max_redemptions_per_night = case tier_code
		when 'bronce' then 1 when 'plata' then 2
		when 'oro'    then 3 when 'platino' then null end;

-- Umbrales: el salto a Plata debe ocurrir en la SEGUNDA visita, que es el
-- objetivo de negocio (que alguien nuevo quiera volver).  Con 240 tk la primera
-- noche y ~140 la segunda, 300 cae justo ahí.  Estaba en 500 = 4ª noche.
update public.tenant_tier_thresholds set min_lifetime = 300  where tier_code='plata';
update public.tenant_tier_thresholds set min_lifetime = 800  where tier_code='oro';
update public.tenant_tier_thresholds set min_lifetime = 2000 where tier_code='platino';

alter table public.tenant_tier_thresholds
	alter column tokens_per_euro set default 150;;
