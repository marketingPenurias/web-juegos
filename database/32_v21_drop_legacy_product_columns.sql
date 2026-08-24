-- V21 · Retirada del modelo viejo de disponibilidad, ya sustituido por
-- product_availability.
--
-- Se hace DESPUÉS de desplegar el frontend nuevo, no antes: hasta ese momento
-- el worker en producción todavía seleccionaba estas columnas y borrarlas
-- habría tumbado el menú.
--
-- Solo permitían UNA regla por producto, que es lo que obligaba a duplicar el
-- producto una vez por nivel (22 filas para 13 productos reales).  Ahora cada
-- combinación de nivel, días y franja horaria es una fila propia.
--
-- Verificado antes de borrar: ninguna función, vista ni política las lee, y
-- ninguna consulta del código las selecciona.
--
-- Aplicado en Supabase el 2026-08-24.
alter table public.tenant_products
	drop column if exists min_tier_required,   -- → product_availability.tier_code
	drop column if exists available_days,      -- → product_availability.days
	drop column if exists max_per_night,       -- → product_availability.max_per_night
	drop column if exists max_per_week,        -- → product_availability.max_per_week
	drop column if exists max_per_month;       -- sin equivalente: nadie lo usaba

comment on column public.tenant_products.price_tokens is
	'Coste en tokens SOLO para redemption_type = free_product (canje directo, sin descuento). Para los productos de descuento el coste se calcula: (list_price_eur - promo) × tasa del nivel. No usar como precio general.';
comment on column public.tenant_products.reference_fiat is
	'Heredada: espejo de promo_price_eur que todavía consume analytics.run_etl. El precio de barra real es list_price_eur.';
