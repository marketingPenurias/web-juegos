-- =========================================================================
--  13_tenant_video_bg.sql — Vídeo de fondo del Jumbotron (Sprint V1.6 · Premium)
-- =========================================================================
--
--   NOTA DE ESQUEMA (importante):
--     El brief pedía `ALTER TABLE public.tenant_theme ADD COLUMN ...`, pero
--     en este proyecto NO existe una tabla `tenant_theme`.  El theming
--     white-label vive en la columna JSONB `public.tenants.theme` (ver
--     migración 04_tenant_theme.sql, titulada "theming on the tenants
--     table") y lo carga el loader de `app/root.tsx`.
--
--     Para no romper nada y mantener la coherencia (la URL del vídeo es un
--     dato de branding tipado y largo), añadimos una COLUMNA real
--     `bg_video_url` en `public.tenants`.  El frontend la expone como
--     `tenant.bgVideoUrl`.
--
--   Las URLs apuntarán al bucket público de Storage `tenant-assets`
--   (migración/infra del Bloque 3), no a `/public`.
-- =========================================================================

alter table public.tenants
	add column if not exists bg_video_url text;

comment on column public.tenants.bg_video_url is
	'URL pública (bucket tenant-assets) del vídeo de fondo en loop del Jumbotron. NULL → fondo sólido (--jumbo-bg) como fallback.';
