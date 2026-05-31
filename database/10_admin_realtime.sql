-- ─────────────────────────────────────────────────────────────────────────
--   Nightgraph · 10 — Realtime para el dashboard del DJ (métricas en vivo)
--
--   El RPC `get_admin_metrics` agrega de wallet_ledger (gastos),
--   venue_visits (check-ins) y track_votes (jugadores/votos).  Para que el
--   panel /admin reaccione AL INSTANTE cuando alguien gasta tokens o entra
--   por la puerta, esas tablas deben:
--     (a) estar en la publication `supabase_realtime`, y
--     (b) permitir al STAFF leer su tenant (RLS) — Realtime entrega una
--         fila sólo si el suscriptor pasa la policy SELECT.
--
--   ASIMETRÍA intacta: estas policies son SÓLO para staff (is_tenant_staff);
--   los usuarios normales siguen con sus policies self-read y los móviles
--   NO se suscriben a estas tablas.  Idempotente.  Run AFTER 09.
-- ─────────────────────────────────────────────────────────────────────────

-- (a) Policies de lectura para STAFF (tenant-scoped) ----------------------

drop policy if exists wallet_ledger_staff_read on public.wallet_ledger;
create policy wallet_ledger_staff_read on public.wallet_ledger
	for select using (
		tenant_id = public.current_tenant_id()
		and public.is_tenant_staff(tenant_id, auth.uid())
	);

drop policy if exists venue_visits_staff_read on public.venue_visits;
create policy venue_visits_staff_read on public.venue_visits
	for select using (
		tenant_id = public.current_tenant_id()
		and public.is_tenant_staff(tenant_id, auth.uid())
	);

drop policy if exists track_votes_staff_read on public.track_votes;
create policy track_votes_staff_read on public.track_votes
	for select using (
		tenant_id = public.current_tenant_id()
		and public.is_tenant_staff(tenant_id, auth.uid())
	);

-- (b) Añadir a la publication supabase_realtime (guardado) ----------------

do $$
declare
	t text;
begin
	foreach t in array array['wallet_ledger', 'venue_visits', 'track_votes'] loop
		if not exists (
			select 1 from pg_publication_tables
			where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
		) then
			execute format('alter publication supabase_realtime add table public.%I', t);
		end if;
	end loop;
end $$;
