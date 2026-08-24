-- V22 · Loop de invitación: traer gente REAL a la puerta.
--
-- La regla `friend_referral` (100 tk) existía desde el principio y **nunca se
-- había pagado una sola vez**: no había ni código de invitación ni quien lo
-- disparara.
--
-- DECISIÓN IMPORTANTE — se cobra con el CHECK-IN del invitado, no con su
-- registro.  Una cuenta de Google es gratis y se crea desde el sofá: premiar
-- el alta es pagar por cuentas falsas (100 tk por cuenta = una copa cada cinco
-- registros de humo).  El check-in exige estar físicamente en la puerta, que
-- además es justo lo que el negocio quiere comprar.  De paso convierte al que
-- invita en alguien interesado en que su amigo APAREZCA, no solo en que se
-- registre.
--
-- Aplicado en Supabase el 2026-08-24.

alter table public.user_profiles
	add column if not exists invite_code text,
	add column if not exists referred_by uuid references public.user_profiles(id) on delete set null;

create unique index if not exists user_profiles_invite_code_unique
	on public.user_profiles (tenant_id, invite_code) where invite_code is not null;
create index if not exists user_profiles_referred_by_idx
	on public.user_profiles (referred_by) where referred_by is not null;

-- ── Código de invitación ──────────────────────────────────────────────────
-- Se dicta en voz alta en un sitio ruidoso y se teclea a oscuras, así que el
-- alfabeto excluye lo que se confunde: 0/O, 1/I/L. Seis caracteres dan ~1.000
-- millones de combinaciones; el bucle cubre la colisión improbable.
create or replace function public.get_or_create_invite_code(
	p_tenant_id uuid, p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $function$
declare
	v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
	v_code text; v_existing text; i int;
begin
	select invite_code into v_existing from user_profiles
	 where id = p_user_id and tenant_id = p_tenant_id;
	if not found then
		raise exception 'Perfil no encontrado' using errcode = 'NG002';
	end if;
	if v_existing is not null then return v_existing; end if;

	for attempt in 1..20 loop
		v_code := '';
		for i in 1..6 loop
			v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
		end loop;
		begin
			update user_profiles set invite_code = v_code
			 where id = p_user_id and tenant_id = p_tenant_id and invite_code is null;
			if found then return v_code; end if;
			-- Otra petición se lo asignó mientras tanto: vale el suyo.
			select invite_code into v_existing from user_profiles where id = p_user_id;
			return v_existing;
		exception when unique_violation then
			null;   -- código ocupado, otra vuelta
		end;
	end loop;
	raise exception 'No se pudo generar un código de invitación';
end $function$;

create or replace function public.resolve_invite_code(p_tenant_id uuid, p_code text)
returns uuid language sql stable security definer set search_path = public as $function$
	select id from user_profiles
	 where tenant_id = p_tenant_id and invite_code = upper(btrim(p_code))
	 limit 1
$function$;

-- ── Pagar la invitación ───────────────────────────────────────────────────
-- Idempotente: se llama tras CADA check-in y solo paga la primera vez.  Las
-- dos cantidades salen de `tenant_token_rewards`, como el resto de la
-- economía, para que la sala pueda ajustarlas sin tocar código.
create or replace function public.grant_referral_reward(
	p_tenant_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_referrer uuid; v_amount_referrer int; v_amount_invitee int;
begin
	select referred_by into v_referrer from user_profiles
	 where id = p_user_id and tenant_id = p_tenant_id;
	if v_referrer is null then
		return jsonb_build_object('paid', false, 'reason', 'sin_invitador');
	end if;

	-- Ya cobrado por ESTE invitado.  La marca vive en el apunte del invitador,
	-- que es quien no puede cobrar dos veces por la misma persona.
	if exists (
		select 1 from wallet_ledger w
		 where w.tenant_id = p_tenant_id and w.user_id = v_referrer
		   and w.reason = 'friend_referral'
		   and w.metadata->>'invitee_id' = p_user_id::text
	) then
		return jsonb_build_object('paid', false, 'reason', 'ya_pagado');
	end if;

	select amount into v_amount_referrer from tenant_token_rewards
	 where tenant_id = p_tenant_id and event_code = 'friend_referral' and is_active;
	select amount into v_amount_invitee from tenant_token_rewards
	 where tenant_id = p_tenant_id and event_code = 'friend_referral_invitee' and is_active;

	if coalesce(v_amount_referrer, 0) > 0 then
		insert into wallet_ledger (tenant_id, user_id, amount, reason, metadata)
		values (p_tenant_id, v_referrer, v_amount_referrer, 'friend_referral',
		        jsonb_build_object('invitee_id', p_user_id));
	end if;
	if coalesce(v_amount_invitee, 0) > 0 then
		insert into wallet_ledger (tenant_id, user_id, amount, reason, metadata)
		values (p_tenant_id, p_user_id, v_amount_invitee, 'friend_referral_invitee',
		        jsonb_build_object('referrer_id', v_referrer));
	end if;

	return jsonb_build_object('paid', true,
		'referrer_amount', coalesce(v_amount_referrer, 0),
		'invitee_amount', coalesce(v_amount_invitee, 0));
end $function$;

-- Premio para quien LLEGA invitado: configurable como todo lo demás.
insert into public.tenant_token_rewards (tenant_id, event_code, amount, description, is_active)
select t.id, 'friend_referral_invitee', 50, 'Bienvenida por venir invitado', true
  from public.tenants t
 where not exists (
   select 1 from public.tenant_token_rewards r
    where r.tenant_id = t.id and r.event_code = 'friend_referral_invitee');

grant execute on function public.get_or_create_invite_code(uuid, uuid) to service_role;
grant execute on function public.resolve_invite_code(uuid, text) to service_role;
grant execute on function public.grant_referral_reward(uuid, uuid) to service_role;

comment on column public.user_profiles.invite_code is
	'Código corto para invitar (alfabeto sin 0/O/1/I/L: se dicta a gritos y se teclea a oscuras). Único por sala.';
comment on column public.user_profiles.referred_by is
	'Quién le invitó. Se fija UNA vez al darse de alta y no se cambia; el premio se paga en su primer check-in, no al registrarse.';
