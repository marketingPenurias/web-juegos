-- =========================================================================
--  16_cron_performance_index.sql — Índice parcial para el cron de cierre
--  (Sprint V1.6.1 · Performance)
-- =========================================================================
--
--   El job pg_cron `close-due-events` corre CADA MINUTO con:
--     update tenant_events set status='ended'
--     where status='active' and end_time < now();
--
--   Sin índice, cada ejecución hace un Sequential Scan de toda
--   `tenant_events` — inaceptable cuando la tabla crezca con el histórico
--   de cientos de locales.  Un índice PARCIAL (solo filas 'active') es
--   óptimo: ocupa casi nada (los activos son un puñado en todo momento) y
--   resuelve el filtro `status='active' and end_time<now()` con un range
--   scan sobre `end_time`.
-- =========================================================================

create index if not exists idx_tenant_events_active_endtime
	on public.tenant_events (end_time)
	where status = 'active';
