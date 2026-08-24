-- V21 · Una cuenta de Google no podía existir en dos discotecas.
--
-- Había DOS índices únicos contradiciéndose sobre user_profiles:
--   · user_profiles_tenant_auth_unique (tenant_id, auth_user_id) — correcto:
--     un perfil por persona y sala.
--   · user_profiles_auth_user_idx (auth_user_id) — global: un perfil por
--     persona en TODO el sistema.
--
-- El segundo contradice el modelo multi-tenant entero.  Quien ya tenía cuenta
-- en La Pocha no podía darse de alta en otra sala: `/api/session` intentaba
-- crear su perfil, chocaba con el índice global y devolvía 500
-- (profile_create_failed), dejando la app con los valores por defecto — saldo
-- mock de 450, histórico 0 y sin escalera de niveles.
--
-- `api.auth-sync` ya intentaba recuperarse del 23505 releyendo el perfil, pero
-- acotado por tenant: cuando la colisión venía de OTRA sala, no encontraba nada
-- y fallaba igual.  El síntoma se atribuyó a una carrera de React StrictMode;
-- la causa real era este índice.
--
-- Ninguna consulta del código depende de la unicidad global: todas filtran por
-- (tenant_id, auth_user_id).  Verificado en tenant-resolver, api.session,
-- api.wallet, api.auth-sync y analytics-handler.
--
-- Aplicado en Supabase el 2026-08-24.
drop index if exists public.user_profiles_auth_user_idx;

comment on index public.user_profiles_tenant_auth_unique is
	'Un perfil por persona y sala. NO añadir un único global sobre auth_user_id: impediría que la misma cuenta juegue en dos discotecas.';
