-- ============================================================================
-- 24 · V20 FASE 0 — Grants ausentes para `service_role`  (BUG RAÍZ)
-- ============================================================================
-- Aplicado en remoto vía MCP (migración `v20_fix_service_role_grants`).
-- Espejo para el histórico del repo.
--
-- ── El bug ──────────────────────────────────────────────────────────────────
-- 7 tablas no tenían NINGÚN privilegio para `service_role`, el rol con el que el
-- worker (Cloudflare) lee vía PostgREST usando la service key.  Con ese rol se
-- bypassa RLS, pero los GRANT de tabla NO: sin SELECT, toda lectura directa
-- fallaba.  Las ESCRITURAS seguían funcionando porque van por RPCs
-- SECURITY DEFINER (se ejecutan como owner) — de ahí que el fallo pareciera
-- aleatorio e inconexo.
--
-- Agravante: el código hacía `const { data } = await supabase...`, descartando
-- el error → la UI recibía [] y mostraba "no hay nada" en vez de un fallo.
--
-- ── Síntomas que arregla ────────────────────────────────────────────────────
--   · global_tracks / event_templates / event_template_tracks
--       → "Almacén global" y "Plantillas" VACÍOS en /admin.
--   · qr_strategies
--       → /api/tv no resolvía el código del QR de entrada, el QR del jumbotron
--         caía al enlace de atribución y NADIE llegaba a /checkin.
--         Resultado: 0 venue_visits → KPI de check-ins y racha de fidelidad
--         siempre a 0, pese a haber 360 perfiles registrados.
--   · live_battles
--       → la batalla no aparecía al arrancar /admin ni la TV (sólo llegaba
--         luego por Realtime, que usa anon+RLS y sí tenía SELECT).
--   · tenant_token_rewards
--       → /api/session devolvía reward_rules: [] y el cliente caía a los
--         costes/premios hardcodeados en vez de los configurados en BD.
--   · tenant_tier_thresholds
--       → umbrales de tier no legibles por el worker.
-- ----------------------------------------------------------------------------

grant select, insert, update, delete on
	public.global_tracks,
	public.event_templates,
	public.event_template_tracks,
	public.qr_strategies,
	public.live_battles,
	public.tenant_token_rewards,
	public.tenant_tier_thresholds
to service_role;

-- Que no vuelva a ocurrir con tablas futuras creadas por el owner habitual.
alter default privileges for role postgres in schema public
	grant select, insert, update, delete on tables to service_role;

-- ── Verificación ────────────────────────────────────────────────────────────
-- select t.tablename,
--   has_table_privilege('service_role','public.'||t.tablename,'SELECT') as sr_select
-- from pg_tables t where t.schemaname='public' order by sr_select, t.tablename;
