-- V22 · El Flash Drop en la pantalla del local.
--
-- Un drop dura 15-30 minutos y solo funciona si la sala se entera.  Viviendo
-- solo en el móvil, se entera quien YA estaba mirando el teléfono — justo al
-- revés de lo que se busca: la pantalla es lo que hace que la gente lo saque.
--
-- Aplicado en Supabase el 2026-08-24.

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Enterarse en el siguiente sondeo se comería un trozo grande de la promoción.
-- Y como `stock_used` sube con cada canje, la misma suscripción da la cuenta
-- de unidades en vivo, que es la mejor prueba social que hay.
alter publication supabase_realtime add table public.product_availability;

-- Realtime necesita la fila COMPLETA en los UPDATE para poder comparar; por
-- defecto Postgres solo manda la clave primaria y el consumidor no vería
-- cambiar `stock_used`.
alter table public.product_availability replica identity full;

-- ── FUGA: la tabla se creó SIN RLS ────────────────────────────────────────
-- Todas las demás llevan lectura acotada a la sala, pero esta no, y Supabase
-- concede SELECT a `anon` por defecto sobre el esquema public.  Resultado:
-- cualquiera con la clave pública podía leer la configuración de promociones
-- COMPLETA de todas las salas — precios, franjas, campañas y stock restante.
--
-- Además hace falta para el propio banner: Realtime respeta la RLS, así que sin
-- política la pantalla no recibiría ninguna fila.
alter table public.product_availability enable row level security;

drop policy if exists product_availability_tenant_read on public.product_availability;
create policy product_availability_tenant_read
	on public.product_availability
	for select
	using (tenant_id = current_tenant_id());

comment on table public.product_availability is
	'CUÁNDO está disponible cada promoción (nivel, días, franja, vigencia, stock). Lectura acotada por RLS a la sala; toda escritura pasa por RPCs SECURITY DEFINER.';
