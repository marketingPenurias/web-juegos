-- =========================================================================
--  20_tv_backdrop.sql — Control remoto del fondo de la TV (Sprint V1.7)
-- =========================================================================
--
--   El Staff necesita CONTROL MANUAL de la pantalla: fijar un flyer
--   ("Promo Chupitos") como fondo ÚNICO, o dejar el carrusel automático
--   de fotos del local.  Persistimos la preferencia POR EVENTO (es una
--   decisión de "esta noche") en `tenant_events.metadata.tv_backdrop`:
--
--       { "tv_backdrop": { "mode": "carousel" | "pinned", "url": <txt|null> } }
--
--   El admin la escribe (op `set_tv_backdrop`) y la TV la escucha en
--   tiempo real vía `postgres_changes` sobre `tenant_events` (por eso la
--   añadimos a la publicación supabase_realtime; los UPDATE de esta tabla
--   son raros → coste despreciable).  La RLS `tenant_events_read`
--   (tenant_id = current_tenant_id()) ya autoriza el SELECT del realtime.
--
--   Idempotente.
-- =========================================================================

-- 1. Columna metadata (jsonb) para la preferencia de pantalla (+ futuros flags).
alter table public.tenant_events
	add column if not exists metadata jsonb not null default '{}'::jsonb;

-- 2. Publicar tenant_events en Realtime (guard idempotente).
do $$
begin
	if not exists (
		select 1 from pg_publication_tables
		where pubname = 'supabase_realtime' and tablename = 'tenant_events'
	) then
		alter publication supabase_realtime add table public.tenant_events;
	end if;
end $$;
