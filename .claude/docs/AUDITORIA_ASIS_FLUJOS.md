# 🔍 Auditoría AS-IS · Flujos de Economía y Tokens
**Fecha:** 2026-05-29 · **Alcance:** código real en `main` (frontend hooks, `/api/*`, RPCs en `database/*.sql`)
**Método:** lectura estática del código y de las migraciones SQL. No me dice cómo debería ser — describe qué hace el código **ahora mismo**.

> ⚠️ No pude contrastar contra la BD viva: el único conector de base de datos disponible apunta a "VideogamesStore", no a la Supabase de producción. Todos los veredictos salen del código fuente y de las migraciones `database/08*.sql`, que son la fuente de verdad del esquema desplegado.

---

## 0. EL HALLAZGO RAÍZ (lee esto primero)

Existe **una sola pieza que define toda la fuga**: **no hay ningún RPC de "ganar tokens con límite".**

Inventario real de RPCs en la BD (`grep "create function" database/*.sql`):

| RPC | Qué hace | ¿Tiene validación/límite? |
|---|---|---|
| `spend_tokens` | Gasto atómico (FOR UPDATE) | ✅ Sí (no permite overdraft) |
| `vote_track` | Voto + débito de boost | ✅ Dedupe + balance |
| `purchase_reward` | Compra en Menú Secreto | ✅✅ tier + día + `max_per_night/week/month` |
| `start_reward_redemption` | Inicia canje camarero | ✅ |
| `grant_signup_bonus` | Bonus +100 al registrarse | ✅ Idempotente |
| `get_user_tier`, `business_night` | Helpers | — |

**No existe** `grant_reward`, `claim_daily_reward`, `grant_ruleta`, `grant_checkin` ni equivalente. Toda acción de **ganar** tokens (ruleta, tinder, check-in, misiones) que no sea el signup va por el **EARN path de `/api/wallet`**, que hace esto (`app/routes/api.wallet.ts:236-255`):

```ts
// ── EARN PATH ──
// Direct insert is safe — credits never overdraft.
await supabase.from("wallet_ledger").insert({ tenant_id, user_id, amount, reason, metadata });
```

Es un **INSERT directo y ciego**. Acepta `amount` arbitrario (hasta 10.000) y cualquier `reason` string que mande el cliente. **No hay límite diario, no hay idempotencia, no hay verificación de que la acción ocurrió, no hay comprobación de que el `amount` coincida con `tenant_token_rewards`.**

La tabla `tenant_token_rewards` (08c/08d) que define "ruleta=15, tinder=25, checkin=50…" es **solo informativa**: el cliente la lee para pintar la UI, pero **el servidor nunca la usa para validar un earn**. El `max_per_night` que sí existe protege **únicamente** `purchase_reward` (el gasto del catálogo), no los ingresos.

> **Consecuencia:** cualquier usuario autenticado puede `POST /api/wallet {amount: 10000, reason: "lol"}` y acuñar tokens. La ruleta es solo el síntoma más visible de esto.

---

## 1. 🎡 RULETA (`RuletaRondas.tsx` → `useEarn.ts` → `/api/wallet`)

**1. Trigger UI:** Clic en "Girar" (`handleSpin`, `RuletaRondas.tsx:110`).

**2. Llamada API / Hook:** `useEarn().earn(15, "ruleta_spin")` → `POST /api/wallet` con `{ amount: +15, reason: "ruleta_spin", tenant_slug }` y JWT. Parámetros reales, sí.

**3. Backend / BD:** `/api/wallet` EARN path → **INSERT directo** en `wallet_ledger` (+15). El trigger `update_user_token_balance` materializa `token_balance`. **No llama a ningún RPC con límite.**

**4. VEREDICTO: 🔴 ROTO / FUGA INFINITA.**
- El token **sí se asienta** en el ledger (+15 reales por tirada)…
- …pero **no existe NINGÚN bloqueo de "1 por día"**. Ni en `RuletaRondas.tsx`, ni en `useEarn`, ni en `/api/wallet`, ni en la BD. El comentario del componente lo confirma: *"Cada tirada concedida ahora regala +15 tokens… siempre persiste server-side"* — pero nada limita el número de tiradas.
- **¿Por qué se puede tirar infinito?** Porque cada clic = un INSERT independiente de +15. El cooldown que esperarías (`business_night` + count) **no está cableado al earn**. `business_night` solo se usa en `purchase_reward` y en el cálculo de `daily_activity` de `/api/session` (que es cosmético, ver §5).
- **Dónde falta el bloqueo:** debería existir un RPC `grant_capped_reward(reason, …)` que cuente filas de hoy con ese `reason` en la `business_night` actual y rechace la segunda. Hoy no existe.
- **Bonus de gravedad:** como el `amount` lo manda el cliente, no es solo "+15 infinito" — es "+lo que el cliente diga, infinito".

---

## 2. ⚔️ LIVE BATTLE (`LiveBattle.tsx` → `useMusic.ts` → RPC `vote_track`)

**1. Trigger UI:** Seleccionar tema + "Confirmar voto" / "Boost" (`handleConfirm`, `LiveBattle.tsx:118`).

**2. Llamada API / Hook:** `useMusic().castVote({ track_id, vote_type: 'free'|'boost', tokens_spent: 0|30 })` → `POST /api/music`.

**3. Backend / BD:** `handleMusicAction` → RPC `vote_track` (`06_music_rpc.sql`). Este RPC **sí es real y robusto**:
- Bloquea la fila `event_tracks` (`FOR UPDATE`), verifica `is_played=false`.
- Dedupe por índice único `(track_id, user_id)` → `already_voted`.
- Inserta en `track_votes`.
- Boost: debita `-tokens_spent` en `wallet_ledger` con balance check.
- Suma `+5` (boost) o `+1` (free) a `total_votes`.

**4. VEREDICTO: 🟠 VOTO REAL / RECOMPENSA INEXISTENTE + FUGA DE BOOST.**
- ✅ **Los votos SÍ se guardan** en `track_votes` (tabla real) y mueven `total_votes`. El boost de -30 **sí se resta** del ledger.
- 🔴 **Los 10 tokens de recompensa por votar NO se dan.** La regla `livebattle_vote = 10` existe en `tenant_token_rewards` (08d) y `MissionsCard` la pinta (con `fallbackReward: 0`), pero **ningún código llama a `earn()` tras votar en la batalla**. `handleConfirm` solo descuenta (boost) o registra el voto; nunca acredita. La recompensa de +10 es **fantasma: existe en la tabla de economía y en la UI, pero no en el flujo de ejecución.**
- 🔴 **Fuga lógica de boost gratis:** `vote_track` solo debita si `p_vote_type='boost' AND p_tokens_spent > 0`. Un cliente que mande `{ vote_type:'boost', tokens_spent:0 }` obtiene **+5 votos sin pagar nada**. La validación `free_votes_must_be_zero` solo aplica al tipo `free`; "boost con 0 tokens" cuela. El coste del boost no está anclado server-side a `tenant_token_rewards.livebattle_boost`.

---

## 3. 💘 TINDER MUSICAL (`TinderMusical.tsx` → `useMusic.ts` → RPC `vote_track`)

**1. Trigger UI:** Swipe derecha (like) / izquierda (dislike); al llegar a 5 swipes, modal de recompensa.

**2. Llamada API / Hook:**
- Like → `castVote({ vote_type:'free', tokens_spent:0 })` → `POST /api/music`.
- Dislike → solo `trackEvent` analytics (no vota, por diseño).
- Completar 5 → `addTokens(20, "history.tx_tinder")`.

**3. Backend / BD:**
- El voto (like) → RPC `vote_track` free → **fila real en `track_votes`**. ✅
- La recompensa por completar → **`addTokens` es una mutación local de Zustand** (`useGameState.ts:230`). **No toca el servidor.** El propio comentario del archivo lo admite: *"otorga la recompensa local (+20 tokens) — el ledger real lo gestiona el server, esto es feedback inmediato hasta que /api/wallet earn endpoint cierre el círculo en Fase 2."*

**4. VEREDICTO: 🟠 VOTO REAL / RECOMPENSA MOCKEADA.**
- ✅ El registro del voto es real y persistente.
- 🔴 **Los tokens por completar son falsos.** Se suman solo al estado del cliente; en cuanto `/api/session` vuelve a sincronizar (`syncSession` sobrescribe `tokens` con el balance del servidor), **el premio desaparece**. Es exactamente la "discrepancia UI vs BD" que reportaste.
- ⚠️ **Mismatch de cantidad:** el código premia `REWARD = 20` (`TinderMusical.tsx:34`), pero `tenant_token_rewards.tinder_completion = 25` (08d) — y 08c lo tenía en 20. Ni siquiera el número mockeado coincide con la economía oficial (la "Tabla 5").

---

## 4. 🎵 JUKEBOX (`Jukebox.tsx` → `useMusic.ts` → RPC `vote_track`)

**1. Trigger UI:** Botón "Pedir" o "Boost" por canción.

**2. Llamada API / Hook:**
- Pedir → `castVote({ vote_type:'free', tokens_spent:0 })`.
- Boost → `castVote({ vote_type:'boost', tokens_spent:50 })` (`BOOST_COST=50`).

**3. Backend / BD:** Ambos → RPC `vote_track`. El boost debita -50 reales del `wallet_ledger`; el balance devuelto se aplica con `setBalance(res.balance)`.

**4. VEREDICTO: 🟢 BOOST REAL / 🟠 "Pedir" sin recompensa + código muerto.**
- ✅ **El Boost SÍ resta los 50 tokens** de verdad (RPC con balance check). Este es el flujo de gasto más correcto junto con el Menú Secreto.
- 🟠 **"Pedir" es gratis y no acredita nada.** Es un voto `free` (coste 0). La regla `jukebox_request = +20` existe en `tenant_token_rewards` (08d) pero **no se otorga** — igual que en Tinder/Battle, la recompensa de pedir canción es fantasma.
- 🔴 **Misma fuga de boost-a-0** del §2: el coste 50 lo fija el cliente, no el servidor. `{ vote_type:'boost', tokens_spent:0 }` da el boost (+5 votos) gratis.
- 🧟 **Código muerto:** `useGameState.boostSongRequest()` (resta -50 **local** sobre `INITIAL_SONG_REQUESTS`, que son canciones mockeadas: "Despacito", "Bombay"…) **no lo usa nadie** — la pantalla real usa `castVote`. Es un mock huérfano del MVP anterior que conviene borrar para no confundir.

---

## 5. 📍 CHECK-IN / MISIONES

### Check-in físico (QR)
**1-3. Flujo:** **No existe.** No hay ruta `/api/checkin`, no hay RPC de check-in, no hay pantalla de escaneo. Las rutas API completas son: `analytics, auth-sync, catalog, history, music, rewards, session, track, wallet`. Ninguna hace check-in.

**4. VEREDICTO: 🔴 INEXISTENTE (feature fantasma).**
- La regla `checkin_la_pocha = +50` está sembrada en `tenant_token_rewards` (08d) y el comentario de 08d la lista como "premio por acción real", pero **está totalmente huérfana**: nada en el código la concede.
- Lo único relacionado con "físico↔digital" que sí existe es `resolve_tracking_campaign` (07_growth, atribución de `?ref=` por cookie para RRPPs) — pero eso es atribución de captación, **no** un grant de tokens por check-in. El check-in con QR descrito en la arquitectura **no está implementado**.

### Misiones (`MissionsCard.tsx`)
**1-3. Flujo:** La tarjeta lee `dailyActivity` y `rewardRules` del store (poblados por `/api/session`). Pinta un check verde si `daily_activity[clave]` es true. Al tap, solo navega a la pantalla del juego (`setScreen`).

`daily_activity` se calcula en `/api/session` (`api.session.ts:253-313`) leyendo `wallet_ledger` (últimas ~30h) y `track_votes`. Eso **es real como indicador de actividad**.

**4. VEREDICTO: 🟡 DISPLAY REAL / SIN MOTOR DE RECOMPENSA.**
- ✅ Los checks verdes reflejan actividad real del servidor (no mock).
- ⚠️ Pero **las misiones no otorgan ninguna recompensa propia**: son atajos de navegación con un "+X" decorativo. El `reward` que muestran es el del juego subyacente (que, como vimos, en su mayoría no se acredita).
- 🧟 `completeMission()` y `markDaily()` en el store **no los usa nadie** (código muerto). `INITIAL_MISSIONS` (tinder-10, vote-3) también es mock huérfano: la tarjeta real usa su propia constante `MISSIONS`.

---

## 6. MOCKS Y FUGAS RESIDUALES (estado del cliente)

`app/store/useGameState.ts` arrastra estado falso del MVP original, persistido en `sessionStorage`:

| Elemento | Estado | Nota |
|---|---|---|
| `tokens: 450`, `streak: 3` inicial | 🟠 Mock | `syncSession` los sobrescribe con el server al loguear, pero `addTokens`/`spendTokens` (locales) los hacen derivar entre syncs → discrepancia UI vs BD. |
| `INITIAL_LEADERBOARD` ("Carla R.", "Marcos D.", "Tú") | 🔴 Mock 100% | El ranking del Hub es hardcodeado. No viene de BD. |
| `INITIAL_MISSIONS`, `completeMission`, `markDaily` | 🧟 Código muerto | No referenciados por la UI real. |
| `INITIAL_SONG_REQUESTS`, `boostSongRequest` | 🧟 Código muerto | Canciones mock + resta local; la pantalla usa `castVote`. |
| `songVotes.estopa`, `driftSongVotes` | 🔴 Mock | Fluctuación aleatoria de un % de votos. |
| `INITIAL_TRANSACTIONS` (signup +450, racha +30…) | 🟠 Mock | Histórico falso de arranque; el real vive en `useHistory`/`/api/history`. |

---

## 7. LO QUE SÍ ESTÁ BIEN (para no tirar al bebé con el agua)

- **Menú Secreto / `purchase_reward`** (08_loyalty): **es el único flujo end-to-end correcto.** Valida producto activo, tier mínimo, día permitido (ISO dow Europe/Madrid), `max_per_night`/`week`/`month` y saldo, todo atómico con `FOR UPDATE`. Es el patrón que **deberían** seguir los earns.
- **`spend_tokens`** y el SPEND path de `/api/wallet`: atómicos, sin overdraft.
- **`vote_track`**: persistencia y dedupe correctos (salvo la fuga boost-a-0).
- **`grant_signup_bonus`**: idempotente, lee el amount de la BD. Bien hecho — es el modelo a copiar.
- **Auth/Tenant:** el JWT verificado y la resolución estricta de tenant están bien aplicados en todos los endpoints.

---

## 8. RESUMEN EJECUTIVO — TABLA DE VEREDICTOS

| Módulo | ¿Guarda dato? | ¿Tokens correctos (Tabla economía)? | ¿Límite/anti-abuso? | VEREDICTO |
|---|---|---|---|---|
| **Ruleta** | ✅ +15 al ledger | ⚠️ amount lo decide el cliente | 🔴 **Ninguno — infinito** | 🔴 ROTO/FUGA |
| **Live Battle (voto)** | ✅ track_votes | 🔴 +10 NO se dan | dedupe ✅ | 🟠 VOTO OK / PREMIO FANTASMA |
| **Live Battle (boost)** | ✅ -30 real | ⚠️ coste no anclado server | 🔴 boost-a-0 gratis | 🟠 FUGA LÓGICA |
| **Tinder (voto)** | ✅ track_votes | — | dedupe ✅ | 🟢 REAL |
| **Tinder (premio +25)** | 🔴 local only | 🔴 da 20, no 25, y es mock | — | 🔴 MOCKEADO |
| **Jukebox (pedir)** | ✅ voto free | 🔴 +20 NO se dan | dedupe ✅ | 🟠 PREMIO FANTASMA |
| **Jukebox (boost -50)** | ✅ -50 real | ⚠️ coste no anclado | 🔴 boost-a-0 gratis | 🟢/🟠 GASTO REAL c/ fuga |
| **Check-in (+50)** | 🔴 no existe | 🔴 — | 🔴 — | 🔴 INEXISTENTE |
| **Misiones** | ✅ display server | ⚠️ no otorgan nada propio | — | 🟡 SOLO DISPLAY |
| **Menú Secreto (compra)** | ✅ | ✅ | ✅✅ | 🟢 REAL |

### Las 4 desconexiones críticas que explican tus síntomas
1. **Ruleta infinita** → el EARN de `/api/wallet` es un INSERT ciego sin RPC con `business_night` + count. Falta un `grant_capped_reward`.
2. **Mint arbitrario** → ese mismo INSERT acepta `amount`/`reason` del cliente. Vector de fraude más grave que la propia ruleta.
3. **Premios fantasma** (Tinder +25, Battle +10, Jukebox +20) → existen en `tenant_token_rewards` y en la UI, pero **ningún código los acredita** (o lo hace solo en local, como Tinder).
4. **Boost-a-cero** → `vote_track` no exige que un boost pague; coste fijado por el cliente. +5 votos gratis.
