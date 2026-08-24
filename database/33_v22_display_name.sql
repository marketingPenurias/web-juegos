-- V22 · Nombre de usuario elegido por la persona.
--
-- El ranking iba lleno de "Jefe #7": 315 de 361 perfiles de La Pocha no tenían
-- nombre, porque había DOS rutas de alta y solo una lo rellenaba
-- (`api.auth-sync` sí, el alta perezosa de `api.session` no).  Y los 46 que sí
-- lo tenían era el trozo del correo, que nadie había elegido.
--
-- El nombre se pinta en el ranking y en la TV de la sala, así que es único por
-- discoteca, se valida en el servidor y se acota en longitud y caracteres.
--
-- Aplicado en Supabase el 2026-08-24.

-- ── Normalización ─────────────────────────────────────────────────────────
-- Recorta y colapsa espacios: "  Álvaro   D " → "Álvaro D".  Sin esto,
-- "Alvaro" y "Alvaro " serían distintos y la unicidad no valdría nada.
create or replace function public.normalize_display_name(p_name text)
returns text language sql immutable as $function$
	select nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '')
$function$;

create unique index if not exists user_profiles_tenant_display_name_unique
	on public.user_profiles (tenant_id, lower(display_name))
	where display_name is not null;

-- ── Cambiar el nombre ─────────────────────────────────────────────────────
--   NG101 nombre inválido · NG102 nombre ya cogido · NG002 perfil no existe
create or replace function public.set_display_name(
	p_tenant_id uuid, p_user_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_name text;
begin
	v_name := normalize_display_name(p_name);

	if v_name is null or char_length(v_name) < 3 then
		raise exception 'El nombre necesita al menos 3 caracteres' using errcode = 'NG101';
	end if;
	if char_length(v_name) > 20 then
		raise exception 'El nombre no puede pasar de 20 caracteres' using errcode = 'NG101';
	end if;
	-- Letras (con acentos y ñ), números, espacios y . _ -  Nada más: así no
	-- entran URLs, emojis que descuadren la TV ni caracteres de control.
	if v_name !~ '^[[:alnum:]ÁÉÍÓÚÜÑáéíóúüñ][[:alnum:]ÁÉÍÓÚÜÑáéíóúüñ ._-]*$' then
		raise exception 'Usa solo letras, números, espacios y . _ -' using errcode = 'NG101';
	end if;
	if v_name !~ '[[:alpha:][:digit:]]' then
		raise exception 'El nombre necesita alguna letra o número' using errcode = 'NG101';
	end if;

	if exists (
		select 1 from user_profiles u
		 where u.tenant_id = p_tenant_id and u.id <> p_user_id
		   and lower(u.display_name) = lower(v_name)
	) then
		raise exception 'Ese nombre ya está cogido en esta sala' using errcode = 'NG102';
	end if;

	update user_profiles set display_name = v_name
	 where id = p_user_id and tenant_id = p_tenant_id;
	if not found then
		raise exception 'Perfil no encontrado' using errcode = 'NG002';
	end if;

	return jsonb_build_object('display_name', v_name);
exception
	-- Carrera: dos personas pidiendo el mismo nombre a la vez.  El índice es la
	-- autoridad final; se traduce al mismo mensaje que la comprobación previa.
	when unique_violation then
		raise exception 'Ese nombre ya está cogido en esta sala' using errcode = 'NG102';
end $function$;

-- ── Nombre por defecto al darse de alta, a prueba de colisiones ───────────
-- El alta NO puede fallar por el nombre.  Si se insertara "Álvaro" a pelo y ya
-- hubiera otro Álvaro en la sala, el índice único reventaría la creación del
-- perfil.  Aquí se busca la primera variante libre y, si no la hay, se deja sin
-- nombre: el ranking dirá "Jefe #7" y la persona podrá elegir, que es mucho
-- mejor que no poder entrar.
--
-- Se usa solo el NOMBRE DE PILA: esto se pinta en la televisión de una
-- discoteca y "Álvaro" identifica mucho menos que "Álvaro Diez".
create or replace function public.claim_default_display_name(
	p_tenant_id uuid, p_user_id uuid, p_full_name text)
returns text language plpgsql security definer set search_path = public as $function$
declare v_base text; v_try text; i int := 1;
begin
	v_base := normalize_display_name(split_part(coalesce(p_full_name, ''), ' ', 1));
	if v_base is null or char_length(v_base) < 3 then return null; end if;
	v_base := left(v_base, 20);
	if v_base !~ '^[[:alnum:]ÁÉÍÓÚÜÑáéíóúüñ][[:alnum:]ÁÉÍÓÚÜÑáéíóúüñ ._-]*$' then
		return null;
	end if;

	-- "Álvaro", "Álvaro 2", "Álvaro 3"…  Se corta a los 50 intentos.
	while i <= 50 loop
		v_try := case when i = 1 then v_base
		              else left(v_base, 20 - char_length(i::text) - 1) || ' ' || i end;
		begin
			update user_profiles set display_name = v_try
			 where id = p_user_id and tenant_id = p_tenant_id and display_name is null;
			if found then return v_try; end if;
			return null;          -- ya tenía nombre: no se pisa
		exception when unique_violation then
			i := i + 1;
		end;
	end loop;
	return null;
end $function$;

grant execute on function public.set_display_name(uuid, uuid, text) to service_role;
grant execute on function public.normalize_display_name(text) to service_role;
grant execute on function public.claim_default_display_name(uuid, uuid, text) to service_role;

comment on column public.user_profiles.display_name is
	'Nombre elegido por la persona; es lo que se ve en el ranking y en la TV. Único por sala (insensible a mayúsculas). Se cambia con set_display_name(), que valida.';
