-- V22 · Cuatro políticas RLS llamaban a `is_tenant_staff()` sin que el rol
-- `authenticated` tuviera permiso para ejecutarla.
--
-- Una política que no puede evaluar su propia condición no devuelve "false":
-- lanza `42501 permission denied`.  El resultado es que las cuatro tablas
-- quedaban ILEGIBLES desde el navegador —wallet_ledger, behavior_events,
-- track_votes y venue_visits— aunque la persona fuese staff de la sala.
--
-- No se había notado porque la app siempre las lee con service_role, que se
-- salta la RLS.  Salió al conectar la TV por Realtime: Realtime SÍ evalúa la
-- política como el usuario, y por eso la pantalla no recibía nunca el aviso de
-- canje mientras los Flash Drops —cuya política solo usa `is_tenant_member`,
-- que sí tenía el grant— llegaban sin problema.
--
-- Conceder EXECUTE no da acceso a nada: la función es SECURITY DEFINER y
-- responde sí/no sobre el propio `auth.uid()` que ya se le pasa.
--
-- Aplicado en Supabase el 2026-08-24.
grant execute on function public.is_tenant_staff(uuid, uuid) to authenticated, anon;

-- `wallet_ledger` es append-only: el coste extra en WAL es despreciable y
-- Realtime necesita la fila completa para evaluar la RLS con garantías.
alter table public.wallet_ledger replica identity full;
