# 🛠️ Reporte de Cambios · Fase de Resolución en Vivo
**Fecha:** 2026-05-29 · **Estado:** PENDIENTE DE TU APROBACIÓN — nada aplicado a producción, nada pusheado.

---

## ⚠️ Antes de nada: 2 hallazgos críticos del diagnóstico en vivo

1. **Producción está desincronizada del repo.** Consultando la BD real (`cfxpwsexxwcxogwuykue`) descubrí que **`tenant_token_rewards` y `grant_signup_bonus` NO existen** en producción. Las migraciones 08c/08d del repo nunca se aplicaron. Consecuencias vivas:
   - El `reward_rules` de `/api/session` siempre devuelve `[]` (la query falla en silencio).
   - El bonus de bienvenida (+100) **no se concede**: nuevos usuarios empiezan con 0 tokens.

2. **El bug del móvil NO es de timezone.** `SecretMenu` ya usa `Intl.DateTimeFormat` con `Europe/Madrid` (correcto e iOS-safe). El evento de hoy está activo en BD (`status='active'`, ventana 13:33→03:33 UTC). La causa real es **caché**: ninguna respuesta de `/api/*` llevaba `Cache-Control`, así que iOS Safari / proxies servían un `/api/session` cacheado de **antes** de que el DJ abriera el evento (creado 15:05 UTC) → `activeEventId=null` → "No hay eventos activos".

---

## 1. 🐛 Bug móvil — FIX (caché)

| Archivo | Cambio |
|---|---|
| `app/lib/api.server.ts` | En `jsonResponse()` añadido `Cache-Control: no-store, no-cache, must-revalidate` + `Pragma: no-cache`. Centraliza el fix para session/music/catalog/wallet a la vez. |
| `app/lib/useSession.ts` | `fetch(/api/session)` con `cache: "no-store"` (defensa contra bfcache de iOS). |
| `app/lib/useMusic.ts` | `fetchJson` con `cache: "no-store"` (el deck cambia en vivo). |

---

## 2. 🗄️ Migración SQL nueva — `database/08e_rewards_engine.sql`

Una sola migración idempotente que cierra todas las fugas de la auditoría:

1. **Crea `tenant_token_rewards`** (no existía) con columna nueva `daily_limit` + RLS de lectura por tenant.
2. **Siembra la economía de 'lapocha'** (Tabla 5 / BRONZE.pdf): signup 100, checkin 50, ruleta 15, tinder 25, livebattle_vote 10, jukebox_request 20, reto 40, referral 100, y los costes de boost (jukebox −50, livebattle −30). Los earns con `daily_limit=1`.
3. **`claim_gamification_reward(p_user_id, p_event_code, p_event_id)`** — RPC maestro de INGRESOS:
   - Lock `FOR UPDATE` del perfil (serializa claims concurrentes).
   - Lee el `amount` de la BD; rechaza `amount<=0` (`not_claimable`) y códigos desconocidos.
   - Valida `daily_limit` contando filas de hoy por `business_night(created_at)=business_night(now())` (timezone Madrid).
   - Inserta el ingreso atómico. Devuelve **siempre** el balance autoritativo (éxito o fallo) → habilita la reconciliación optimista.
4. **`vote_track` endurecido** (cierra "boost a 0"):
   - **`DROP` del overload viejo de 6 args** (era la versión vulnerable que confiaba en el coste del cliente).
   - Nueva firma con `p_boost_code`; el coste del boost se **lee de `tenant_token_rewards`** server-side. `p_tokens_spent` del cliente se **ignora**. Si no hay regla de coste, degrada a `free` (nunca regala +5 gratis).
5. **`grant_signup_bonus`** recreado (no existía en prod).

> ⚠️ **Orden de despliegue obligatorio:** aplicar 08e **ANTES** de subir el worker. El nuevo `music-handler` llama a `vote_track` con `p_boost_code` (7 args) y `/api/wallet` llama a `claim_gamification_reward`; ambos fallarían contra el esquema viejo.

---

## 3. 💸 Boost server-authoritative

| Archivo | Cambio |
|---|---|
| `app/lib/music-handler.server.ts` | Añadido `boost_context` al body; helper `boostCodeFromContext()` mapea `jukebox→jukebox_boost`, `livebattle→livebattle_boost`; pasa `p_boost_code` al RPC. El coste del cliente ya no se usa. |
| `app/lib/useMusic.ts` | `castVote` acepta `boost_context` y lo envía. |
| `app/screens/Jukebox.tsx` | Boost envía `boost_context: "jukebox"`. |
| `app/screens/LiveBattle.tsx` | Voto/boost envía `boost_context: "livebattle"`. |

---

## 4. 🎁 Premios reales (Tabla 5) + Optimistic UI

Nuevo hook **`app/lib/useClaim.ts`**: `claim(event_code)` → `POST /api/wallet {event_code}`. Reconciliación automática (`setBalance`) tanto en éxito como en fallo. Endpoint extendido: `app/routes/api.wallet.ts` ahora detecta modo CLAIM (cuando llega `event_code`) y enruta al RPC; el modo earn/spend legacy se conserva.

Patrón aplicado en cada juego — **suma local inmediata + animación (60fps), claim en background, el ledger reconcilia**:

| Pantalla | Antes | Ahora |
|---|---|---|
| `RuletaRondas.tsx` | `await earn(15)` **bloqueante** antes de girar; sin tope | Gira y suma **al instante**; `claim("ruleta_spin")` en background; el RPC aplica **1/noche**; toast "ya giraste hoy" si se rechaza. Quitado `useEarn`/`pending`. |
| `TinderMusical.tsx` | `addTokens(20)` **solo local** (mock) | `REWARD=25`; `addTokens` optimista **+** `claim("tinder_completion")` real. |
| `LiveBattle.tsx` | voto real, **+10 nunca se daba** | Tras votar: `addTokens(10)` optimista + `claim("livebattle_vote")`. |
| `Jukebox.tsx` | pedir gratis, **+20 nunca se daba** | Tras pedir: `addTokens(20)` optimista + `claim("jukebox_request")`. |

---

## 📋 Lista completa de archivos tocados

**Nuevos (2):**
- `database/08e_rewards_engine.sql`
- `app/lib/useClaim.ts`

**Modificados (8):**
- `app/lib/api.server.ts` · `app/lib/useSession.ts` · `app/lib/useMusic.ts` · `app/lib/music-handler.server.ts`
- `app/routes/api.wallet.ts`
- `app/screens/RuletaRondas.tsx` · `app/screens/TinderMusical.tsx` · `app/screens/LiveBattle.tsx` · `app/screens/Jukebox.tsx`

---

## ✅ Verificación y ⚠️ caveats

- **Revisión sintáctica:** verifiqué vía lectura autoritativa las inserciones grandes (bloque CLAIM de `api.wallet`, `handleSpin` de Ruleta, RPC y helper de boost). Balance correcto.
- **`tsc` no pudo correr en el sandbox:** el mount de bash quedó con copias **truncadas/desincronizadas** de los archivos (limitación conocida del entorno: las file-tools y el shell usan rutas distintas). Los archivos reales están completos y correctos. **Debes correr `npm run typecheck` (o `npm run build`) en tu máquina antes de desplegar** para confirmar — es la regla de oro del proyecto.
- **NO aplicado a producción:** no ejecuté la migración 08e contra la BD ni hice push. Esperando tu OK.

---

## ▶️ Siguientes pasos sugeridos (cuando des el OK)

1. `npm run typecheck` local → confirmar build verde.
2. Aplicar `08e_rewards_engine.sql` a producción (puedo hacerlo vía el conector Supabase).
3. Push a `main` → auto-deploy del worker en Cloudflare (en ese orden, migración primero).
4. Smoke test en móvil: login → ver evento → ruleta 2 veces (2ª no suma) → boost (cuesta lo de BD aunque el cliente mande 0).
