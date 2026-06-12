-- =========================================================================
--  17_user_birthdate.sql — Fecha de nacimiento del usuario (V1.7)
-- =========================================================================
--
--   Captura la fecha de nacimiento para futuras promociones (cumpleaños)
--   y control de edad (+18).  Campo opcional a nivel de columna; la
--   obligatoriedad se aplica en el onboarding (UI) antes de jugar.
--
--   El UPDATE lo hace el Worker con service_role (api.session action),
--   tomando el auth_user_id del JWT verificado — el cliente nunca decide
--   de quién es el perfil.  RLS sigue protegiendo lecturas con la
--   publishable key.
-- =========================================================================

alter table public.user_profiles
	add column if not exists birth_date date;

comment on column public.user_profiles.birth_date is
	'Fecha de nacimiento del usuario (V1.7). Capturada en onboarding; usada para promos de cumpleaños y control +18.';
