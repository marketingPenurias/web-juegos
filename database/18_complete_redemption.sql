-- =========================================================================
--  18_complete_redemption.sql — Consumo REAL del ticket (anti-fraude)
--  (Auditoría 360º · §1 ALTO — "el ticket anti-fraude es teatro")
-- =========================================================================
--
--   Grieta detectada: el flujo de canje sólo transicionaba
--   `available → redeeming` (vía `start_reward_redemption`).  NADA escribía
--   nunca `consumed`, y el "Mantén pulsado para quemar" del cliente era
--   puramente cosmético (sólo tocaba estado de React, cero red).
--
--   Consecuencia: el mismo `user_reward` permanecía en `available`/
--   `redeeming` indefinidamente, con el MISMO código corto, y el usuario
--   podía re-mostrarlo (refresco/segundo amigo) tantas veces como quisiera.
--   El cobro de tokens era real, pero el single-use NO existía.
--
--   Cierre: `complete_redemption(p_tenant_id, p_user_id, p_reward_id)`
--   marca el reward como `consumed` de forma ATÓMICA e IDEMPOTENTE.  El
--   guard vive en el `WHERE status = 'redeeming'`: una segunda llamada
--   (doble-quemado, reintento de red) no encuentra fila y devuelve
--   `already_consumed` sin efectos secundarios.  El botón "quemar" del
--   cliente sólo muestra el éxito si este RPC responde ok.
--
--   Idempotente.  Run AFTER 08_loyalty_and_tiers.sql (que define el RPC
--   `start_reward_redemption` y el enum de estados de user_rewards).
-- =========================================================================

create or replace function public.complete_redemption(
	p_tenant_id uuid,
	p_user_id   uuid,
	p_reward_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_status text;
	v_now    timestamptz := now();
begin
	-- 1. Lock pesimista de la fila del reward (serializa quemados
	--    concurrentes del MISMO ticket: dos taps casi simultáneos, o el
	--    cliente reintentando por timeout de red).
	select status
	  into v_status
	from public.user_rewards
	where id        = p_reward_id
	  and tenant_id = p_tenant_id
	  and user_id   = p_user_id
	for update;

	-- 2. Reward inexistente o de otro usuario/tenant → no revelamos cuál.
	if not found then
		return jsonb_build_object('ok', false, 'error', 'reward_not_found');
	end if;

	-- 3. Guard idempotente: sólo un reward EN CURSO de canje se puede
	--    quemar.  Una segunda llamada lo encuentra ya 'consumed' y
	--    devuelve un ok=false benigno (la UI ya lo trató como quemado).
	if v_status = 'consumed' then
		return jsonb_build_object(
			'ok', false, 'error', 'already_consumed', 'reward_id', p_reward_id);
	end if;
	if v_status <> 'redeeming' then
		-- 'available' (nunca se abrió la pantalla camarero), 'expired', etc.
		return jsonb_build_object(
			'ok', false, 'error', 'not_redeeming', 'status', v_status);
	end if;

	-- 4. Consumo definitivo.  El `and status='redeeming'` es el backstop
	--    del guard incluso bajo el lock.
	update public.user_rewards
	set status       = 'consumed',
	    redeemed_at  = v_now
	where id        = p_reward_id
	  and tenant_id = p_tenant_id
	  and user_id   = p_user_id
	  and status    = 'redeeming';

	if not found then
		-- Carrera perdida contra otra transacción que ya lo consumió.
		return jsonb_build_object(
			'ok', false, 'error', 'already_consumed', 'reward_id', p_reward_id);
	end if;

	return jsonb_build_object(
		'ok', true, 'reward_id', p_reward_id, 'consumed_at', v_now);
end;
$$;

-- Lockdown: sólo el service_role (Cloudflare Worker) puede invocarlo.
revoke execute on function public.complete_redemption(uuid, uuid, uuid)
	from public, anon, authenticated;
grant  execute on function public.complete_redemption(uuid, uuid, uuid)
	to service_role;
