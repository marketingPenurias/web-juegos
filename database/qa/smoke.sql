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
	v_r1 uuid; v_r2 uuid; v_r3 uuid; v_votos int; v_lva timestamptz; v_base int;
	v_reqkey text; v_sel uuid; v_lib int; v_g uuid; v_g2 uuid; v_g3 uuid; v_et uuid;
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

	-- ═══ RESET DE VOTOS AL PINCHAR (v23) ════════════════════════════════
	--
	--   Las dos mitades del asunto, que es fácil arreglar una y romper la
	--   otra: el contador del ranking se resetea, el registro de votos NO.
	--   Y el guardia de las batallas, que se decidían comparando el mismo
	--   contador que ahora ponemos a cero.
	insert into event_tracks(tenant_id,event_id,spotify_id,title,artist,genre,total_votes,is_played)
	select v_t, v_ev, 'qareset'||g, 'QA reset '||g, 'QA', 'QA género', 0, false from generate_series(1,3) g;
	select id into v_r1 from event_tracks where event_id=v_ev and spotify_id='qareset1';
	select id into v_r2 from event_tracks where event_id=v_ev and spotify_id='qareset2';
	select id into v_r3 from event_tracks where event_id=v_ev and spotify_id='qareset3';

	-- La fiesta ya trae votos del bloque de Música, así que el panel se mide
	-- por diferencia y no por el número absoluto.
	r := get_admin_metrics(v_t, v_actor, v_ev);
	v_base := (r->>'total_votes')::int;

	r := vote_track(v_t, v_u, v_ev, v_r1, 'free', 0, 'livebattle_boost', 'battle', false);
	select total_votes into v_votos from event_tracks where id=v_r1;
	insert into qa values ('Reset de votos','votar sube el contador','1', v_votos::text,
		case when v_votos=1 then 'ok' else 'FALLO' end);

	r := admin_set_now_playing(v_t, v_actor, v_ev, v_r1);
	select total_votes, last_vote_at into v_votos, v_lva from event_tracks where id=v_r1;
	insert into qa values ('Reset de votos','al pincharla el contador vuelve a 0','0', v_votos::text,
		case when v_votos=0 then 'ok' else 'FALLO' end);
	insert into qa values ('Reset de votos','y se limpia el desempate','sin sello',
		coalesce(v_lva::text,'sin sello'), case when v_lva is null then 'ok' else 'FALLO' end);

	select count(*) into v_n from track_votes where track_id=v_r1;
	insert into qa values ('Reset de votos','el voto NO se pierde','1', v_n::text,
		case when v_n=1 then 'ok' else 'FALLO' end);
	r := get_admin_metrics(v_t, v_actor, v_ev);
	insert into qa values ('Reset de votos','y el panel del DJ lo sigue contando',
		(v_base+1)::text, coalesce(r->>'total_votes','—'),
		case when (r->>'total_votes')::int = v_base+1 then 'ok' else 'FALLO' end);

	select count(*) into v_n from tv_ranking(v_ev, 10) where id=v_r1;
	insert into qa values ('Reset de votos','sale del ranking al momento, sin esperar 2h','0',
		v_n::text, case when v_n=0 then 'ok' else 'FALLO' end);

	-- Puede volver, pero sólo si la vota gente que aún no la había votado.
	r := admin_set_now_playing(v_t, v_actor, v_ev, v_r2);
	r := vote_track(v_t, v_u, v_ev, v_r1, 'free', 0, 'livebattle_boost', 'battle', false);
	insert into qa values ('Reset de votos','quien ya la votó no la revota','already_voted',
		coalesce(r->>'error','dejó votar'),
		case when r->>'error'='already_voted' then 'ok' else 'FALLO' end);
	r := vote_track(v_t, v_b, v_ev, v_r1, 'free', 0, 'livebattle_boost', 'battle', false);
	select total_votes into v_votos from event_tracks where id=v_r1;
	insert into qa values ('Reset de votos','vuelve a subir con gente nueva, desde 1','1',
		v_votos::text, case when v_votos=1 then 'ok' else 'FALLO' end);
	r := get_admin_metrics(v_t, v_actor, v_ev);
	insert into qa values ('Reset de votos','el total acumulado sí suma',
		(v_base+2)::text, coalesce(r->>'total_votes','—'),
		case when (r->>'total_votes')::int = v_base+2 then 'ok' else 'FALLO' end);

	-- El duelo se decide comparando total_votes: poner una a cero en mitad
	-- de la batalla la haría perder sola.
	insert into live_battles(tenant_id,event_id,track_a,track_b,status,started_at,ends_at)
	values (v_t, v_ev, v_r1, v_r3, 'live', now(), now()+interval '10 minutes');
	r := admin_set_now_playing(v_t, v_actor, v_ev, v_r1);
	select total_votes into v_votos from event_tracks where id=v_r1;
	insert into qa values ('Reset de votos','pinchar un tema en duelo NO lo deja a 0','1',
		v_votos::text, case when v_votos=1 then 'ok' else 'FALLO' end);
	update live_battles set status='closed' where event_id=v_ev and status='live';

	-- ═══ PEDIRLE UNA CANCIÓN QUE NO TENEMOS (v23) ═══════════════════════
	--
	--   El Jukebox ya sirve el repertorio entero de la sala, así que lo que
	--   está guardado NO es una petición.  Esto cubre lo que falta, en texto
	--   libre, y lo que decide es cuánta gente pide lo mismo.
	r := request_new_track(v_t, v_u, v_ev, 'Zzz Tema Inexistente QA', 'QA Artista');
	insert into qa values ('Peticiones','pedir algo que la sala no tiene','aceptada',
		coalesce(r->>'ok','—'), case when (r->>'ok')::boolean then 'ok' else 'FALLO' end);

	r := request_new_track(v_t, v_u, v_ev, '  zzz  tema   inexistente qa ', 'qa artista');
	insert into qa values ('Peticiones','la misma escrita distinta no cuela dos veces',
		'already_requested', coalesce(r->>'error','la aceptó'),
		case when r->>'error'='already_requested' then 'ok' else 'FALLO' end);

	r := request_new_track(v_t, v_b, v_ev, 'Zzz Tema Inexistente QA', 'QA Artista');
	insert into qa values ('Peticiones','otra persona pide la misma · la señal sube','2',
		coalesce(r->>'requests','—'),
		case when r->>'requests'='2' then 'ok' else 'FALLO' end);

	r := request_new_track(v_t, v_u, v_ev, 'QA tema 1', null);
	insert into qa values ('Peticiones','pedir algo que SÍ tenemos','already_in_library',
		coalesce(r->>'error','la aceptó'),
		case when r->>'error'='already_in_library' then 'ok' else 'FALLO' end);

	r := request_new_track(v_t, v_u, v_ev, 'x', null);
	insert into qa values ('Peticiones','un título de una letra','invalid_title',
		coalesce(r->>'error','la aceptó'),
		case when r->>'error'='invalid_title' then 'ok' else 'FALLO' end);

	select count(*) into v_n from get_track_requests(v_t, v_actor, v_ev);
	insert into qa values ('Peticiones','una fila por canción, no por petición','1',
		v_n::text, case when v_n=1 then 'ok' else 'FALLO' end);
	select count(*) into v_n from get_track_requests(v_t, v_u, v_ev);
	insert into qa values ('Peticiones','un cliente no ve el panel del DJ','0',
		v_n::text, case when v_n=0 then 'ok' else 'FALLO' end);

	select req_key into v_reqkey from get_track_requests(v_t, v_actor, v_ev) limit 1;
	r := admin_accept_request(v_t, v_actor, v_ev, v_reqkey);
	select count(*) into v_n from event_tracks
	 where event_id=v_ev and spotify_id like 'pedido:%';
	insert into qa values ('Peticiones','al aceptarla entra en la fiesta','1',
		v_n::text, case when v_n=1 then 'ok' else 'FALLO' end);
	select count(*) into v_n from get_track_requests(v_t, v_actor, v_ev);
	insert into qa values ('Peticiones','y sale de pendientes','0',
		v_n::text, case when v_n=0 then 'ok' else 'FALLO' end);

	-- ═══ LA FIESTA ES LO QUE HA ELEGIDO EL DJ (v23) ═════════════════════
	--
	--   La trampa está en el segundo caso: `ensure_event_track` crea una fila
	--   en CADA voto, así que "la fiesta tiene canciones" no puede significar
	--   "hay filas en event_tracks" — una fiesta vacía donde alguien vota se
	--   quedaría con esa única canción.
	select count(*) into v_lib from global_tracks where tenant_id = v_t;
	insert into tenant_events(tenant_id,name,status,start_time,end_time)
	values (v_t,'QA selección','scheduled', now()-interval '1 hour', now()+interval '6 hours')
	returning id into v_sel;

	select count(*) into v_n from event_catalog(v_sel, 5000, null);
	insert into qa values ('Selección','fiesta vacía · se ve todo el almacén',
		v_lib::text, v_n::text, case when v_n = v_lib then 'ok' else 'FALLO' end);

	select id into v_g  from global_tracks where tenant_id=v_t order by title limit 1;
	select id into v_g2 from global_tracks where tenant_id=v_t order by title offset 1 limit 1;
	select id into v_g3 from global_tracks where tenant_id=v_t order by title offset 2 limit 1;
	v_et := ensure_event_track(v_t, v_sel, v_g);
	select count(*) into v_n from event_catalog(v_sel, 5000, null);
	insert into qa values ('Selección','un voto NO convierte la fiesta en lista',
		v_lib::text, v_n::text, case when v_n = v_lib then 'ok' else 'FALLO' end);
	insert into qa values ('Selección','la fila del voto queda marcada','vote',
		(select added_by from event_tracks where id = v_et),
		case when (select added_by from event_tracks where id = v_et) = 'vote'
		     then 'ok' else 'FALLO' end);

	insert into event_tracks(tenant_id,event_id,global_track_id,spotify_id,title,artist,genre,total_votes,is_played)
	select v_t, v_sel, g.id, g.spotify_id, g.title, g.artist, g.genre, 0, false
	from global_tracks g where g.tenant_id=v_t and g.id <> v_g order by g.title limit 3;
	select count(*) into v_n from event_catalog(v_sel, 5000, null);
	insert into qa values ('Selección','el DJ carga 3 · sólo se ven ésas','3',
		v_n::text, case when v_n = 3 then 'ok' else 'FALLO' end);

	delete from event_tracks where event_id = v_sel and added_by = 'dj'
	  and id = (select id from event_tracks where event_id = v_sel and added_by='dj'
	            order by title limit 1);
	select count(*) into v_n from event_catalog(v_sel, 5000, null);
	insert into qa values ('Selección','el DJ quita una · desaparece de verdad','2',
		v_n::text, case when v_n = 2 then 'ok' else 'FALLO' end);

	-- Vetar (v23 · paso perezoso): "Quitar" pasa a ser "excluir de esta
	-- noche", y deshacerlo tiene que borrar la fila — si sólo se apaga el
	-- veto, esa fila queda como "lista del DJ de una canción" y la fiesta se
	-- vacía.  Es la trampa del voto por otro lado; la cazó este banco.
	delete from event_tracks where event_id = v_sel;
	r := admin_exclude_track(v_t, v_actor, v_sel, v_g, true);
	select count(*) into v_n from event_catalog(v_sel, 5000, null);
	insert into qa values ('Selección','vetar una · suena todo menos ésa',
		(v_lib - 1)::text, v_n::text, case when v_n = v_lib - 1 then 'ok' else 'FALLO' end);

	r := admin_exclude_track(v_t, v_actor, v_sel, v_g, false);
	select count(*) into v_n from event_catalog(v_sel, 5000, null);
	insert into qa values ('Selección','deshacer el veto · vuelve todo',
		v_lib::text, v_n::text, case when v_n = v_lib then 'ok' else 'FALLO' end);
	insert into qa values ('Selección','y no deja fila detrás','0',
		(select count(*)::text from event_tracks where event_id = v_sel),
		case when not exists(select 1 from event_tracks where event_id = v_sel)
		     then 'ok' else 'FALLO' end);

	-- Curar NO es operar.  Poner una canción necesita una fila donde guardar
	-- el estado, pero no es elegir el repertorio: si contara como lista, el
	-- DJ marcando la primera canción de la noche dejaría el catálogo en CERO
	-- (la lista sería esa canción, y está sonando, así que se filtra).
	delete from event_tracks where event_id = v_sel;
	r := admin_set_now_playing_global(v_t, v_actor, v_sel, v_g);
	select count(*) into v_n from event_catalog(v_sel, 5000, null);
	insert into qa values ('Selección','poner la 1ª sin curar · el catálogo NO se vacía',
		(v_lib - 1)::text, v_n::text, case when v_n = v_lib - 1 then 'ok' else 'FALLO' end);
	insert into qa values ('Selección','y esa fila no cuenta como lista del DJ','vote',
		(select added_by from event_tracks where event_id = v_sel and global_track_id = v_g),
		case when (select added_by from event_tracks where event_id = v_sel and global_track_id = v_g) = 'vote'
		     then 'ok' else 'FALLO' end);

	-- Batalla desde el catálogo (v23 · 2a).  Montar un duelo tampoco es
	-- curar: si estas dos filas contaran como lista, la fiesta se reduciría
	-- a las dos canciones enfrentadas.
	delete from event_tracks where event_id = v_sel;
	r := admin_start_battle_global(v_t, v_actor, v_sel, v_g, v_g2, 3);
	insert into qa values ('Selección','batalla en fiesta vacía · se puede montar','ok',
		coalesce(r->>'ok','—'), case when (r->>'ok')::boolean then 'ok' else 'FALLO' end);
	select count(*) into v_n from event_catalog(v_sel, 100000, null);
	insert into qa values ('Selección','y el duelo NO reduce el repertorio a dos',
		v_lib::text, v_n::text, case when v_n = v_lib then 'ok' else 'FALLO' end);
	update live_battles set status='closed' where event_id = v_sel;

	r := admin_exclude_track(v_t, v_actor, v_sel, v_g3, true);
	r := admin_start_battle_global(v_t, v_actor, v_sel, v_g3, v_g, 3);
	insert into qa values ('Selección','no se puede enfrentar una vetada','invalid_tracks',
		coalesce(r->>'error','la aceptó'),
		case when r->>'error' = 'invalid_tracks' then 'ok' else 'FALLO' end);

	delete from live_battles where event_id = v_sel;
	delete from track_votes  where event_id = v_sel;
	delete from event_tracks where event_id = v_sel;
	delete from tenant_events where id = v_sel;

	-- ═══ DESHACER ═══════════════════════════════════════════════════════
	-- Orden importa: los movimientos de cartera apuntan a la fiesta con una
	-- clave foránea, así que se van ANTES que ella.
	delete from track_requests where event_id = v_ev;
	delete from track_votes   where event_id = v_ev;
	delete from user_rewards  where event_id = v_ev;
	delete from wallet_ledger where event_id = v_ev;
	delete from live_battles  where event_id = v_ev;
	delete from event_tracks where event_id = v_ev;
	delete from tenant_events where id = v_ev;
	delete from global_tracks where tenant_id = v_t and spotify_id like 'pedido:%';
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
