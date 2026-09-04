-- ─────────────────────────────────────────────────────────────────────────
-- QA · Prueba de humo del motor de la app
--
--   Ejercita las RPC que sostienen la noche: economía, canjes, música,
--   check-in, referidos y aislamiento entre salas.  Se ejecuta contra la sala
--   `prueba` y **deshace todo lo que toca**: al terminar, el saldo y el
--   histórico del usuario de prueba quedan como estaban.
--
--   No sustituye a probar por la interfaz — hay fallos que solo se ven ahí,
--   como el precio redondeado que encontramos el 4 de septiembre.  Cubre la
--   capa de debajo, que es donde vive el dinero.
--
--   Uso:  ejecutar entero.  La última sentencia devuelve la tabla de
--   resultados; cualquier fila con FALLO hay que mirarla.
-- ─────────────────────────────────────────────────────────────────────────

create temporary table if not exists qa (
	bloque text, caso text, esperado text, obtenido text, veredicto text
);
truncate qa;

do $$
declare
	v_t uuid; v_otro uuid; v_u uuid; v_actor uuid;
	v_ev uuid; v_prod uuid; v_prod_otra_sala uuid; v_track uuid;
	v_saldo_ini int; v_lifetime_ini int; v_reward uuid;
	v_b uuid; v_sb_ini int; v_ref_ini uuid; v_code text;
	r jsonb; v_err text; v_n int;
begin
	select id into v_t    from tenants where slug='prueba';
	select id into v_otro from tenants where slug='lapocha';
	select user_id into v_actor from tenant_staff where tenant_id=v_t and is_active limit 1;
	select id, token_balance, lifetime_earned
	  into v_u, v_saldo_ini, v_lifetime_ini
	  from user_profiles where tenant_id=v_t order by lifetime_earned desc limit 1;

	-- Fiesta de trabajo, con repertorio ANTES de activarla (el orden correcto)
	insert into tenant_events(tenant_id,name,status,start_time,end_time)
	values (v_t,'QA smoke','scheduled', now()-interval '1 hour', now()+interval '6 hours')
	returning id into v_ev;
	insert into event_tracks(tenant_id,event_id,spotify_id,title,artist,genre,total_votes,is_played)
	select v_t, v_ev, 'qa'||g, 'QA tema '||g, 'QA', 'QA género', 0, false from generate_series(1,3) g;
	update tenant_events set status='active' where id=v_ev;
	select id into v_track from event_tracks where event_id=v_ev limit 1;

	select id into v_prod from tenant_products
	 where tenant_id=v_t and redemption_type='discount' and is_active limit 1;
	select id into v_prod_otra_sala from tenant_products
	 where tenant_id=v_otro and is_active limit 1;

	-- ═══ ECONOMÍA ═══════════════════════════════════════════════════════
	-- Regla de la casa: el saldo NUNCA baja de cero.
	update user_profiles set token_balance = 0 where id = v_u;
	begin
		r := purchase_reward(v_t, v_u, v_prod, v_ev);
		insert into qa values ('Economía','comprar sin saldo','error NG001',
			'compró igualmente','FALLO');
	exception when others then
		get stacked diagnostics v_err = returned_sqlstate;
		insert into qa values ('Economía','comprar sin saldo','error NG001', v_err,
			case when v_err='NG001' then 'ok' else 'FALLO' end);
	end;

	insert into qa
	select 'Economía','el saldo no quedó negativo','>= 0', token_balance::text,
	       case when token_balance >= 0 then 'ok' else 'FALLO' end
	  from user_profiles where id = v_u;

	-- ═══ CANJE ══════════════════════════════════════════════════════════
	update user_profiles set token_balance = 5000 where id = v_u;
	begin
		r := purchase_reward(v_t, v_u, v_prod, v_ev);
		v_reward := (r->>'reward_id')::uuid;
		insert into qa values ('Canje','comprar con saldo','premio creado',
			'coste ' || (r->>'cost_tokens') || ' fichas','ok');
	exception when others then
		get stacked diagnostics v_err = returned_sqlstate;
		insert into qa values ('Canje','comprar con saldo','premio creado', v_err,'FALLO');
	end;

	insert into qa
	select 'Canje','el cobro salió del saldo','5000 menos el coste', token_balance::text,
	       case when token_balance < 5000 then 'ok' else 'FALLO' end
	  from user_profiles where id = v_u;

	insert into qa
	select 'Canje','queda apuntado quién y qué','fila en user_rewards',
	       status || ' · descuento ' || coalesce(discount_eur::text,'—'),'ok'
	  from user_rewards where id = v_reward;

	-- Empezar a quemarlo: pasa a 'redeeming'
	begin
		r := start_reward_redemption(v_t, v_u, v_reward);
		insert into qa
		select 'Canje','empezar a quemar el ticket','redeeming', status,
		       case when status='redeeming' then 'ok' else 'FALLO' end
		  from user_rewards where id = v_reward;
	exception when others then
		get stacked diagnostics v_err = returned_sqlstate;
		insert into qa values ('Canje','empezar a quemar el ticket','redeeming', v_err,'FALLO');
	end;

	-- El ticket de otro no se puede quemar
	begin
		r := start_reward_redemption(v_t,
			(select id from user_profiles where tenant_id=v_t and id <> v_u limit 1), v_reward);
		insert into qa values ('Canje','quemar el ticket de OTRO','rechazado',
			'lo permitió','FALLO');
	exception when others then
		get stacked diagnostics v_err = returned_sqlstate;
		insert into qa values ('Canje','quemar el ticket de OTRO','rechazado',
			'rechazado ('||v_err||')','ok');
	end;

	-- ═══ AISLAMIENTO ENTRE SALAS ════════════════════════════════════════
	begin
		r := purchase_reward(v_t, v_u, v_prod_otra_sala, v_ev);
		insert into qa values ('Aislamiento','comprar producto de OTRA sala','rechazado',
			'lo permitió','FALLO');
	exception when others then
		get stacked diagnostics v_err = returned_sqlstate;
		insert into qa values ('Aislamiento','comprar producto de OTRA sala','rechazado',
			'rechazado ('||v_err||')','ok');
	end;

	-- ═══ MÚSICA ═════════════════════════════════════════════════════════
	begin
		r := vote_track(v_t, v_u, v_ev, v_track, 'free', 0, null, 'jukebox', false, null);
		insert into qa values ('Música','votar un tema (gratis)','voto registrado',
			coalesce(r->>'ok','sin ok'),'ok');
	exception when others then
		get stacked diagnostics v_err = returned_sqlstate;
		insert into qa values ('Música','votar un tema (gratis)','voto registrado', v_err,'FALLO');
	end;

	insert into qa
	select 'Música','el voto sube el contador del tema','total_votes > 0',
	       total_votes::text, case when total_votes > 0 then 'ok' else 'FALLO' end
	  from event_tracks where id = v_track;

	-- ═══ BATALLA ════════════════════════════════════════════════════════
	begin
		r := admin_start_battle(v_t, v_actor, v_ev,
			(select id from event_tracks where event_id=v_ev order by spotify_id limit 1),
			(select id from event_tracks where event_id=v_ev order by spotify_id desc limit 1), 1);
		insert into qa values ('Batalla','iniciar una batalla',
			'batalla en marcha', coalesce(r->>'ok','sin ok'),
			case when (r->>'ok')::boolean then 'ok' else 'FALLO' end);
	exception when others then
		get stacked diagnostics v_err = returned_sqlstate;
		insert into qa values ('Batalla','iniciar una batalla','batalla en marcha', v_err,'FALLO');
	end;

	begin
		r := admin_force_close_battle(v_t, v_actor, v_ev);
		insert into qa values ('Batalla','forzar el cierre','cerrada',
			coalesce(r->>'ok','sin ok'),
			case when (r->>'ok')::boolean then 'ok' else 'FALLO' end);
	exception when others then
		get stacked diagnostics v_err = returned_sqlstate;
		insert into qa values ('Batalla','forzar el cierre','cerrada', v_err,'FALLO');
	end;

	-- ═══ NIVELES ════════════════════════════════════════════════════════
	insert into qa values ('Niveles','0 puntos = nivel de entrada','bronce',
		get_user_tier(v_t, 0),
		case when get_user_tier(v_t, 0)='bronce' then 'ok' else 'FALLO' end);
	insert into qa values ('Niveles','muchos puntos = nivel más alto','platino',
		get_user_tier(v_t, 999999),
		case when get_user_tier(v_t, 999999)='platino' then 'ok' else 'FALLO' end);

	-- ═══ NOCHE DE NEGOCIO ═══════════════════════════════════════════════
	insert into qa values ('Noche','las 3 de la mañana son de la noche anterior',
		business_night('2026-09-05 03:00:00+02'::timestamptz)::date::text,
		business_night('2026-09-05 03:00:00+02'::timestamptz)::date::text,
		case when business_night('2026-09-05 03:00:00+02'::timestamptz)::date = date '2026-09-04'
		     then 'ok' else 'FALLO' end);

	-- ═══ COBERTURA DE LA CARTA ══════════════════════════════════════════
	select count(*) into v_n from check_promo_coverage(v_t);
	insert into qa values ('Carta','todos los niveles tienen algo a cualquier hora','0 huecos',
		v_n::text, case when v_n = 0 then 'ok' else 'FALLO' end);

	-- ═══ CHECK-IN Y REFERIDOS ═══════════════════════════════════════════
	--   El check-in es la bisagra del negocio: registra la visita, paga las
	--   fichas de entrada y dispara el premio de quien invitó.  Estuvo roto
	--   todo el piloto de agosto, así que se comprueba entero.
	select id, token_balance into v_b, v_sb_ini
	  from user_profiles where tenant_id = v_t and id <> v_u
	 order by created_at desc limit 1;
	select referred_by into v_ref_ini from user_profiles where id = v_b;

	update user_profiles set referred_by = v_u where id = v_b;
	delete from venue_visits where user_id = v_b
	  and business_night(entry_time) = business_night(now());
	delete from wallet_ledger where user_id in (v_u, v_b) and reason like '%referral%';

	r := process_checkin(v_b, 'PRUEBA-ENTRADA-01');
	insert into qa values ('Check-in','entrar con un QR válido','ok + premio',
		coalesce(r->>'ok','?') || ' · +' || coalesce(r->>'reward_amount','0') || ' fichas',
		case when (r->>'ok')::boolean then 'ok' else 'FALLO' end);

	r := process_checkin(v_b, 'PRUEBA-ENTRADA-01');
	insert into qa values ('Check-in','repetir el mismo QR esta noche','rechazado',
		coalesce(r->>'error','lo permitió'),
		case when r->>'error' = 'already_checked_in' then 'ok' else 'FALLO' end);

	r := process_checkin(v_b, 'NO-EXISTE-999');
	insert into qa values ('Check-in','QR inventado','rechazado',
		coalesce(r->>'error','lo permitió'),
		case when r->>'error' = 'invalid_qr' then 'ok' else 'FALLO' end);

	r := process_checkin(v_b, 'POCHA-ENTRADA-01');
	insert into qa values ('Aislamiento','QR de OTRA sala','rechazado',
		coalesce(r->>'error','lo permitió'),
		case when r->>'error' = 'invalid_qr' then 'ok' else 'FALLO' end);

	select token_balance into v_n from user_profiles where id = v_u;
	r := grant_referral_reward(v_t, v_b);
	insert into qa select 'Referido','quien invita cobra al entrar su amigo','sube el saldo',
		v_n::text || ' → ' || token_balance::text,
		case when token_balance > v_n then 'ok' else 'FALLO' end
	  from user_profiles where id = v_u;

	select token_balance into v_n from user_profiles where id = v_u;
	r := grant_referral_reward(v_t, v_b);
	insert into qa select 'Referido','no se paga dos veces','el saldo no cambia',
		v_n::text || ' → ' || token_balance::text,
		case when token_balance = v_n then 'ok' else 'FALLO' end
	  from user_profiles where id = v_u;

	-- ═══ LÍMITES DIARIOS ════════════════════════════════════════════════
	--   Cuatro premios son "1 por noche".  Si el límite no se aplica, se
	--   pueden farmear fichas sin salir de casa — y las fichas son dinero
	--   en barra.
	foreach v_code in array array['ruleta_spin','tinder_completion',
	                              'livebattle_vote','reto_mesa'] loop
		delete from wallet_ledger where user_id = v_u and reason = v_code
		  and business_night(created_at) = business_night(now());
		r := claim_gamification_reward(v_u, v_code, null);
		select token_balance into v_n from user_profiles where id = v_u;
		r := claim_gamification_reward(v_u, v_code, null);
		insert into qa select 'Juegos · ' || v_code,'cobrar dos veces la misma noche',
			'la 2ª no paga', v_n::text || ' → ' || token_balance::text,
			case when token_balance = v_n then 'ok' else 'FALLO — se puede farmear' end
		  from user_profiles where id = v_u;
	end loop;

	-- ═══ DESHACER ═══════════════════════════════════════════════════════
	-- Orden importa: los movimientos de cartera apuntan a la fiesta con una
	-- clave foránea, así que se van ANTES que ella.
	delete from track_votes   where event_id = v_ev;
	delete from user_rewards  where event_id = v_ev;
	delete from wallet_ledger where event_id = v_ev;
	delete from live_battles  where event_id = v_ev;
	delete from event_tracks where event_id = v_ev;
	delete from tenant_events where id = v_ev;
	delete from venue_visits  where user_id = v_b
	  and business_night(entry_time) = business_night(now());
	delete from wallet_ledger where user_id in (v_u, v_b)
	  and business_night(created_at) = business_night(now());
	update user_profiles
	   set token_balance = v_saldo_ini, lifetime_earned = v_lifetime_ini
	 where id = v_u;
	update user_profiles
	   set token_balance = v_sb_ini, referred_by = v_ref_ini
	 where id = v_b;

	insert into qa
	select 'Limpieza','el usuario queda como estaba', v_saldo_ini::text,
	       token_balance::text,
	       case when token_balance = v_saldo_ini then 'ok' else 'FALLO' end
	  from user_profiles where id = v_u;
end $$;

select bloque, caso, esperado, obtenido, veredicto from qa;
