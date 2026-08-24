-- V22 · FUGA: `campaign_performance` se creó sin `security_invoker`.
--
-- Una vista en Postgres se ejecuta por defecto con los permisos de su DUEÑO
-- —aquí `postgres`— y por tanto **se salta la RLS de las tablas de debajo**.
-- Como Supabase concede SELECT a `anon` sobre el esquema public, cualquiera
-- con la clave pública podía leer el rendimiento de campañas de TODAS las
-- salas: canjes, usuarios únicos, euros de descuento regalados e ingreso real
-- de barra.
--
-- `dj_leaderboard`, creada antes, ya usaba `security_invoker=on`.  Era el
-- patrón de la casa y no lo seguí al añadir esta.
--
-- Con `security_invoker=on` la vista se evalúa con los permisos de QUIEN
-- consulta, así que hereda la RLS de las tablas base.  Y se revoca además el
-- acceso a `anon` y `authenticated`: es una vista de negocio que consume el
-- panel por el servidor, no algo que deba tocar un navegador.  Cada medida por
-- separado ya bastaría; juntas, un error en una no abre la otra.
--
-- Aplicado en Supabase el 2026-08-24.
alter view public.campaign_performance set (security_invoker = on);

revoke all on public.campaign_performance from anon, authenticated;

comment on view public.campaign_performance is
	'Rendimiento por campaña (canjes, usuarios, € regalados, consumo en barra). SOLO service_role: contiene cifras de negocio de la sala. security_invoker=on para que herede la RLS de las tablas base.';
