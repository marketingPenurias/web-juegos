-- =========================================================================
--  14_storage_assets.sql — Bucket público de assets (Sprint V1.6 · Infra)
-- =========================================================================
--
--   Estrategia de assets: dejamos de servir el logo y el vídeo de fondo
--   desde `/public` (estático, acoplado al deploy) y los movemos a un bucket
--   PÚBLICO de Supabase Storage `tenant-assets`.  Las URLs resultantes se
--   guardan en la BD (`tenants.bg_video_url`, y a futuro un logo_url) para
--   que el frontend (app móvil + TV) sea 100% dinámico y white-label.
--
--   Convención de rutas dentro del bucket:
--     tenant-assets/<slug>/logo.<ext>
--     tenant-assets/<slug>/bg-video.mp4
--
--   Idempotente: re-ejecutar no rompe (upsert del bucket + guards de policy).
-- =========================================================================

-- Bucket público, 50 MB por archivo, imágenes + vídeo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-assets', 'tenant-assets', true, 52428800,
        array['image/png','image/jpeg','image/webp','image/svg+xml','image/gif','video/mp4','video/webm'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  -- Lectura pública (complementa el endpoint público del bucket).
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='tenant_assets_public_read'
  ) then
    create policy tenant_assets_public_read on storage.objects
      for select to anon, authenticated using (bucket_id = 'tenant-assets');
  end if;

  -- Subida cliente sólo autenticada (el panel admin sube vía service_role,
  -- que ya bypassa RLS; esta policy cubre cualquier subida desde cliente).
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='tenant_assets_auth_write'
  ) then
    create policy tenant_assets_auth_write on storage.objects
      for insert to authenticated with check (bucket_id = 'tenant-assets');
  end if;
end $$;
