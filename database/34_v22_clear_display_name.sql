-- V22 · Moderación de nombres: la sala necesita poder quitar uno.
--
-- El nombre elegido se proyecta en la televisión del local.  La validación de
-- `set_display_name` frena URLs, emojis y textos largos, pero no frena un
-- insulto — y sin esta palanca, un nombre ofensivo se queda en pantalla toda la
-- noche sin que nadie pueda hacer nada.
--
-- No se sustituye por otro ni se banea a nadie: se vacía, y la persona vuelve a
-- salir como "Jefe #N".  Puede volver a elegir, y si insiste el staff lo vuelve
-- a quitar; para la reincidencia ya está el trato directo en la puerta, que
-- funciona mejor que cualquier lista de palabras prohibidas.
--
-- Aplicado en Supabase el 2026-08-24.
create or replace function public.clear_display_name(
	p_tenant_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_old text;
begin
	-- Se lee ANTES de vaciarlo: `returning display_name` daría el valor ya
	-- actualizado (null) y el registro de auditoría se quedaría sin lo único
	-- que importa, que es qué nombre se retiró.
	select display_name into v_old from user_profiles
	 where id = p_user_id and tenant_id = p_tenant_id
	 for update;
	if not found then
		raise exception 'Perfil no encontrado' using errcode = 'NG002';
	end if;

	update user_profiles set display_name = null
	 where id = p_user_id and tenant_id = p_tenant_id;

	return jsonb_build_object('cleared', true, 'previous_name', v_old);
end $function$;

grant execute on function public.clear_display_name(uuid, uuid) to service_role;
