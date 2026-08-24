-- V22 · La RLS asumía que una persona pertenece a UNA sola discoteca.
--
-- `current_tenant_id()` resolvía así:
--     select tenant_id from user_profiles where auth_user_id = auth.uid() limit 1
--
-- Ese `limit 1` era seguro mientras un índice único global impedía que una
-- cuenta existiera en dos salas.  Ese índice se quitó (migración 30) porque
-- impedía justo lo que el producto quiere —la misma persona jugando en varias
-- discotecas—, y al quitarlo el `limit 1` quedó ambiguo: devuelve una sala
-- CUALQUIERA de las suyas.
--
-- Consecuencia real, encontrada en el ensayo general: con perfil en `lapocha` y
-- en `prueba`, la función devolvía `lapocha`, así que estando en `prueba`
-- TODAS las políticas negaban las filas.  Se manifestó como que la TV no
-- recibía los Flash Drops por Realtime, pero afectaba a las 25 políticas.
--
-- El arreglo no es parchear la función —no puede saber de qué sala va la
-- petición— sino cambiar la semántica: de "mi única sala" a "una sala de la
-- que soy miembro".  Para quien está en una sola discoteca es EXACTAMENTE lo
-- mismo; para quien está en varias, es lo correcto.
--
-- Los permisos de staff no se tocan: siguen comprobando
-- `is_tenant_staff(tenant_id, auth.uid())` sala por sala.
--
-- Aplicado en Supabase el 2026-08-24.

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = public as $function$
	select exists (
		select 1 from user_profiles
		 where auth_user_id = auth.uid() and tenant_id = p_tenant_id
	)
$function$;
grant execute on function public.is_tenant_member(uuid) to authenticated, anon, service_role;

comment on function public.current_tenant_id() is
	'OBSOLETA para RLS: devuelve una sala cualquiera de la persona, y desde que una cuenta puede estar en varias eso es ambiguo. Usar is_tenant_member(tenant_id).';

-- ── Lectura acotada a las salas de la persona ─────────────────────────────
drop policy if exists audit_logs_read on public.audit_logs;
create policy audit_logs_read on public.audit_logs for select using (is_tenant_member(tenant_id));
drop policy if exists event_template_tracks_tenant_read on public.event_template_tracks;
create policy event_template_tracks_tenant_read on public.event_template_tracks for select using (is_tenant_member(tenant_id));
drop policy if exists event_templates_tenant_read on public.event_templates;
create policy event_templates_tenant_read on public.event_templates for select using (is_tenant_member(tenant_id));
drop policy if exists event_tracks_read on public.event_tracks;
create policy event_tracks_read on public.event_tracks for select using (is_tenant_member(tenant_id));
drop policy if exists global_tracks_tenant_read on public.global_tracks;
create policy global_tracks_tenant_read on public.global_tracks for select using (is_tenant_member(tenant_id));
drop policy if exists live_battles_tenant_read on public.live_battles;
create policy live_battles_tenant_read on public.live_battles for select using (is_tenant_member(tenant_id));
drop policy if exists product_availability_tenant_read on public.product_availability;
create policy product_availability_tenant_read on public.product_availability for select using (is_tenant_member(tenant_id));
drop policy if exists promoter_codes_read on public.promoter_codes;
create policy promoter_codes_read on public.promoter_codes for select using (is_tenant_member(tenant_id));
drop policy if exists qr_strategies_tenant_read on public.qr_strategies;
create policy qr_strategies_tenant_read on public.qr_strategies for select using (is_tenant_member(tenant_id));
drop policy if exists tenant_events_read on public.tenant_events;
create policy tenant_events_read on public.tenant_events for select using (is_tenant_member(tenant_id));
drop policy if exists tenant_products_tenant_read on public.tenant_products;
create policy tenant_products_tenant_read on public.tenant_products for select using (is_tenant_member(tenant_id));
drop policy if exists tenant_staff_read on public.tenant_staff;
create policy tenant_staff_read on public.tenant_staff for select using (is_tenant_member(tenant_id));
drop policy if exists tenant_tier_thresholds_read on public.tenant_tier_thresholds;
create policy tenant_tier_thresholds_read on public.tenant_tier_thresholds for select using (is_tenant_member(tenant_id));
drop policy if exists tenant_token_rewards_read on public.tenant_token_rewards;
create policy tenant_token_rewards_read on public.tenant_token_rewards for select using (is_tenant_member(tenant_id));
drop policy if exists tracking_campaigns_tenant_read on public.tracking_campaigns;
create policy tracking_campaigns_tenant_read on public.tracking_campaigns for select using (is_tenant_member(tenant_id));
drop policy if exists tenants_self_read on public.tenants;
create policy tenants_self_read on public.tenants for select using (is_tenant_member(id));

-- ── Las de staff: membresía + rol, sala por sala ──────────────────────────
drop policy if exists behavior_events_staff_read on public.behavior_events;
create policy behavior_events_staff_read on public.behavior_events for select
	using (is_tenant_member(tenant_id) and is_tenant_staff(tenant_id, auth.uid()));
drop policy if exists track_votes_staff_read on public.track_votes;
create policy track_votes_staff_read on public.track_votes for select
	using (is_tenant_member(tenant_id) and is_tenant_staff(tenant_id, auth.uid()));
drop policy if exists venue_visits_staff_read on public.venue_visits;
create policy venue_visits_staff_read on public.venue_visits for select
	using (is_tenant_member(tenant_id) and is_tenant_staff(tenant_id, auth.uid()));
drop policy if exists wallet_ledger_staff_read on public.wallet_ledger;
create policy wallet_ledger_staff_read on public.wallet_ledger for select
	using (is_tenant_member(tenant_id) and is_tenant_staff(tenant_id, auth.uid()));

-- ── Escritura: conservan su WITH CHECK ────────────────────────────────────
drop policy if exists tenant_tier_thresholds_update on public.tenant_tier_thresholds;
create policy tenant_tier_thresholds_update on public.tenant_tier_thresholds for update
	using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
drop policy if exists tenant_token_rewards_update on public.tenant_token_rewards;
create policy tenant_token_rewards_update on public.tenant_token_rewards for update
	using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- Las tres de INSERT solo tenían la expresión ambigua en el WITH CHECK, así que
-- un barrido que mire únicamente el USING se las deja fuera.
drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs for insert with check (is_tenant_member(tenant_id));
drop policy if exists tenant_tier_thresholds_write on public.tenant_tier_thresholds;
create policy tenant_tier_thresholds_write on public.tenant_tier_thresholds for insert with check (is_tenant_member(tenant_id));
drop policy if exists tenant_token_rewards_write on public.tenant_token_rewards;
create policy tenant_token_rewards_write on public.tenant_token_rewards for insert with check (is_tenant_member(tenant_id));
