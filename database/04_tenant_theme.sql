-- ─────────────────────────────────────────────────────────────────────────
--   La Pocha · White-label theming on the tenants table
--
--   Each tenant carries its own `theme` JSON payload that drives the
--   frontend's CSS custom properties.  Default keys: primary, secondary,
--   accent, background.  Anything else is ignored by the client.
--
--   Run AFTER `database/03_secure_rpc.sql`.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.tenants
	add column if not exists theme jsonb not null default '{}'::jsonb;

-- Seed the demo tenant with the original "Electric Night" palette so
-- existing visuals don't change after the migration.
update public.tenants
set theme = jsonb_build_object(
	'primary',    '#7DF9FF',
	'secondary',  '#39FF14',
	'accent',     '#FFD700',
	'background', '#050505'
)
where slug = 'lapocha'
	and (theme is null or theme = '{}'::jsonb);

-- Optional: a second example tenant so the white-label flow can be
-- demoed end-to-end without leaving the SQL editor.
insert into public.tenants (slug, name, status, theme)
values (
	'kapital',
	'Kapital Madrid',
	'active',
	jsonb_build_object(
		'primary',    '#FF3CAC',
		'secondary',  '#FFD166',
		'accent',     '#7DF9FF',
		'background', '#0A0014'
	)
)
on conflict (slug) do nothing;
