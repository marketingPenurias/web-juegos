-- ─────────────────────────────────────────────────────────────────────────
--   Nightgraph · Seed de Piloto — La Pocha
--
--   Carga el contenido REAL extraído de los PDFs de producto
--   (`.claude/skills/docs/*.pdf`) para la noche del piloto:
--
--     1. Tiers thresholds (idempotencia con migración 08).
--     2. Catálogo de productos por tier (12 SKUs cubriendo Bronce/
--        Plata/Oro/Platino con sus tokens, días y límites).
--     3. Evento activo "Piloto La Pocha — Noche de Estreno".
--     4. 5 canciones dummy asociadas al evento (Tinder Musical no
--        crashea, el DJ las puede sustituir mañana en el panel).
--
--   Idempotente: cada bloque usa `where not exists` o
--   `on conflict do nothing` para que la migración se pueda re-
--   ejecutar sin duplicar filas ni romper FK de wallet_ledger /
--   user_rewards apuntando a productos existentes.
--
--   Run AFTER `database/08_loyalty_and_tiers.sql`.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
	v_tenant uuid;
	v_event  uuid;
begin
	-- ── Resolver tenant 'lapocha' ─────────────────────────────────────
	select id into v_tenant
	from public.tenants
	where slug = 'lapocha'
	limit 1;

	if v_tenant is null then
		raise notice
			'[08b] tenant "lapocha" no encontrado — corre database/schema.sql antes.';
		return;
	end if;

	-- ─────────────────────────────────────────────────────────────────
	--  1. Catálogo de productos (extraído de los PDFs)
	--
	--     Reglas claves:
	--       · price_tokens   = coste en tokens disponibles.
	--       · reference_fiat = € que cobra el camarero (0 = GRATIS).
	--       · available_days = ISO weekday (1=Lun..7=Dom).
	--       · NULL en cualquier max_per_* = sin límite.
	--
	--     Progresión de precios (PDF "Plan de TOKENS Y DESCUENTOS"):
	--       Oro copa 6€ = 500 tokens  → Platino copa 6€ = 400 tokens.
	--       Oro copa 7€ = 700 tokens  → Platino copa 7€ = 550 tokens.
	--       Plata se inserta UN escalón por encima de Oro para preservar
	--       la sensación de "subir cuesta menos tokens" sin que pierda
	--       atractivo como primer nivel premium.
	-- ─────────────────────────────────────────────────────────────────

	with new_products(
		name, product_type, price_tokens, reference_fiat,
		min_tier_required, available_days,
		max_per_night, max_per_week, max_per_month
	) as (
		values
		-- ── BRONCE (sin min_tier — todos lo ven) ──────────────────────
		(
			'Chupito Gratis con 2 Copas',
			'reward',
			100, 0.00,
			null,
			array[2,3,4]::smallint[],   -- Mar/Mié/Jue
			1::smallint, 2::smallint, null::smallint
		),

		-- ── PLATA — primer nivel con copas reales ─────────────────────
		(
			'Copa Nacional 6€ — Plata',
			'drink',
			700, 6.00,
			'plata',
			array[2,3]::smallint[],     -- Mar/Mié
			1::smallint, 3::smallint, null::smallint
		),
		(
			'Copa Nacional 7€ — Plata',
			'drink',
			900, 7.00,
			'plata',
			array[5,6]::smallint[],     -- Vie/Sáb
			1::smallint, 3::smallint, null::smallint
		),

		-- ── ORO — usuarios fieles, mejor coste en tokens ──────────────
		(
			'Copa Nacional 6€ — Oro',
			'drink',
			500, 6.00,
			'oro',
			array[2,3]::smallint[],
			1::smallint, null::smallint, null::smallint
		),
		(
			'Copa Nacional 7€ — Oro',
			'drink',
			700, 7.00,
			'oro',
			array[5,6]::smallint[],
			1::smallint, null::smallint, null::smallint
		),
		(
			'Copa + Red Bull 8€ — Oro',
			'drink',
			950, 8.00,
			'oro',
			array[5,6]::smallint[],
			1::smallint, null::smallint, null::smallint
		),

		-- ── PLATINO — "Leyenda", límites mensuales ────────────────────
		(
			'Copa Nacional 6€ — Leyenda',
			'drink',
			400, 6.00,
			'platino',
			array[2,3]::smallint[],
			1::smallint, null::smallint, 2::smallint
		),
		(
			'Copa Nacional 7€ — Leyenda',
			'drink',
			550, 7.00,
			'platino',
			array[5,6]::smallint[],
			1::smallint, null::smallint, 2::smallint
		),
		(
			'Copa + Red Bull 8€ — Leyenda',
			'drink',
			750, 8.00,
			'platino',
			array[5,6]::smallint[],
			1::smallint, null::smallint, 1::smallint
		),
		(
			'Pack Leyenda: 3 chupitos GRATIS con 3 copas',
			'reward',
			1300, 0.00,
			'platino',
			array[2,3,4]::smallint[],   -- Mar/Mié/Jue
			1::smallint, null::smallint, 1::smallint
		),
		(
			'2× Copas Nacionales a 7€ cada una',
			'drink',
			1100, 14.00,
			'platino',
			array[5,6]::smallint[],
			1::smallint, null::smallint, 1::smallint
		),
		(
			'Reserva Prioritaria',
			'vip_access',
			1000, 0.00,
			'platino',
			array[5,6]::smallint[],
			1::smallint, null::smallint, 1::smallint
		)
	)
	insert into public.tenant_products (
		tenant_id, name, product_type, price_tokens, reference_fiat,
		is_active, min_tier_required, available_days,
		max_per_night, max_per_week, max_per_month
	)
	select
		v_tenant, p.name, p.product_type, p.price_tokens, p.reference_fiat,
		true, p.min_tier_required, p.available_days,
		p.max_per_night, p.max_per_week, p.max_per_month
	from new_products p
	where not exists (
		select 1
		from public.tenant_products existing
		where existing.tenant_id = v_tenant
		  and existing.name = p.name
	);

	-- ─────────────────────────────────────────────────────────────────
	--  2. Evento activo del piloto
	-- ─────────────────────────────────────────────────────────────────

	insert into public.tenant_events (tenant_id, name, start_time, status)
	select
		v_tenant,
		'Piloto La Pocha — Noche de Estreno',
		now(),
		'active'
	where not exists (
		select 1 from public.tenant_events
		where tenant_id = v_tenant
		  and name = 'Piloto La Pocha — Noche de Estreno'
	);

	select id into v_event
	from public.tenant_events
	where tenant_id = v_tenant
	  and name = 'Piloto La Pocha — Noche de Estreno'
	  and status = 'active'
	order by start_time desc
	limit 1;

	if v_event is null then
		raise notice '[08b] no se pudo crear/recuperar evento activo.';
		return;
	end if;

	-- ─────────────────────────────────────────────────────────────────
	--  3. Canciones dummy (5) — placeholder hasta que el DJ cargue las
	--     reales mañana desde el panel.  spotify_id sintético para evitar
	--     colisiones con un futuro import real de Spotify.
	-- ─────────────────────────────────────────────────────────────────

	with seed_tracks(spotify_id, title, artist, cover_image_url) as (
		values
		(
			'pilot_lapocha_001',
			'Tu Cara Bonita',
			'Estopa',
			'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80'
		),
		(
			'pilot_lapocha_002',
			'Zapatillas',
			'El Canto del Loco',
			'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=80'
		),
		(
			'pilot_lapocha_003',
			'Bombay',
			'El Arrebato',
			'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=600&q=80'
		),
		(
			'pilot_lapocha_004',
			'Niño Soldado',
			'Ska-P',
			'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80'
		),
		(
			'pilot_lapocha_005',
			'Insurrección',
			'El Último de la Fila',
			'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80'
		)
	)
	insert into public.event_tracks (
		tenant_id, event_id, spotify_id, title, artist,
		cover_image_url, total_votes, is_played
	)
	select
		v_tenant, v_event, t.spotify_id, t.title, t.artist,
		t.cover_image_url, 0, false
	from seed_tracks t
	where not exists (
		select 1 from public.event_tracks et
		where et.event_id = v_event
		  and et.spotify_id = t.spotify_id
	);

	raise notice '[08b] Seed La Pocha completado · tenant=% event=%',
		v_tenant, v_event;
end $$;
