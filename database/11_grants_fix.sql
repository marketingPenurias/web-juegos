-- =========================================================================
--  11_grants_fix.sql — FIX de permisos PostgREST (Sprint V1.6 · Bloque A1)
-- =========================================================================
--
--   SÍNTOMA:
--     GET /rest/v1/live_battles?...status=eq.live  → 403 Forbidden
--     (en móvil — LiveBattle — y en la TV/Jumbotron).  La batalla nunca
--     aparece aunque esté iniciada y las policies RLS sean correctas.
--
--   CAUSA RAÍZ:
--     Las tablas creadas en la migración 09 (`live_battles`, `global_tracks`,
--     `qr_strategies`) NO recibieron `GRANT SELECT` para los roles `anon` /
--     `authenticated`.  PostgREST corta con 403 *antes* de evaluar la RLS
--     (el grant de tabla es el primer gate).  Las tablas del esquema base
--     (`event_tracks`, `track_votes`, `venue_visits`) sí tienen el grant y
--     por eso esas lecturas sí funcionaban.
--
--   FIX:
--     Conceder SELECT a anon/authenticated.  La RLS sigue siendo el control
--     de acceso real por fila (tenant_id = current_tenant_id()); el grant
--     sólo desbloquea que PostgREST llegue a evaluarla.
--
--   Idempotente: GRANT es declarativo, re-ejecutarlo no rompe nada.
-- =========================================================================

grant select on public.live_battles  to anon, authenticated;
grant select on public.global_tracks to anon, authenticated;

-- `qr_strategies` se lee SÓLO server-side (service_role), nunca desde el
-- cliente, así que no necesita el grant.  Se deja documentado por si algún
-- día se expone en cliente:
-- grant select on public.qr_strategies to anon, authenticated;

-- Red de seguridad para futuras tablas del esquema public: cualquier tabla
-- nueva creada por el rol actual heredará SELECT para anon/authenticated,
-- evitando que este 403 vuelva a aparecer en la próxima migración.
alter default privileges in schema public
	grant select on tables to anon, authenticated;
