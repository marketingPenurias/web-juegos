# 🩻 AUDITORÍA GENERAL V16 — Operación Clean House

> **Alcance:** radiografía estructural de `/app` (87 archivos).
> **Base:** código actual en `/app`. `CLAUDE.md` y `ARCHITECTURE.md` usados solo como contexto.
> **Fecha:** 2026-06-10 · **Modo:** solo lectura (no se ha tocado código ni commits).

---

## 🔍 1. MAPA DE RUTAS Y FRAGMENTACIÓN (Router & Auth)

Fuente: [`app/routes.ts`](app/routes.ts). Hay **2 rutas de UI cliente**, **8 rutas API**, **2 pantallas TV**, **callback** y **legal**.

### 1.1 Rutas de página (UI)

| Ruta | Componente | Render | Método de Auth |
|---|---|---|---|
| `/` (index) | [`routes/home.tsx`](app/routes/home.tsx) → `LaPochaApp` | SPA cliente (gate de hidratación) | OAuth Google (Supabase PKCE) en cliente; `useSession` manda **Bearer JWT** a `/api/session` |
| `/auth/callback` | [`auth.callback.tsx`](app/routes/auth.callback.tsx) | Cliente | `exchangeCodeForSession` (PKCE) |
| `/checkin?code=` | [`checkin.tsx`](app/routes/checkin.tsx) | Cliente | Exige sesión → **Bearer** a `/api/checkin` |
| `/admin` | [`admin.tsx`](app/routes/admin.tsx) | Cliente | **Bearer** + gating `is_staff` vía `op:"bootstrap"` de `/api/admin` |
| `/tv/music` | [`tv.music.tsx`](app/routes/tv.music.tsx) → `Jumbotron` | Cliente | **Bearer** + rol `display`/`admin` vía `/api/tv` |
| `/tv/dashboard` | [`tv.dashboard.tsx`](app/routes/tv.dashboard.tsx) → `Jumbotron` | Cliente | **Bearer** + rol `display`/`admin` vía `/api/tv` |
| `/legal` | [`legal.tsx`](app/routes/legal.tsx) | Estático | Ninguno |

### 1.2 Rutas API (resource routes)

| Endpoint | Auth | Notas |
|---|---|---|
| `/api/session` | Bearer (verifyAuthToken) | JIT profile + welcome bonus |
| `/api/wallet` | Bearer | spend/earn/claim atómico |
| `/api/rewards` | Bearer | purchase + start-redemption |
| `/api/catalog` | Bearer | productos del tenant |
| `/api/history` | Bearer | ledger paginado |
| `/api/checkin` | Bearer | QR físico → streak |
| `/api/auth-sync` | Bearer | upsert perfil + `?ref` |
| `/api/admin` | Bearer (en `admin-handler.server`) | gating staff |
| `/api/music` | Bearer (en `music-handler.server`) | deck/vote/leaderboard |
| `/api/tv` | Bearer (en `tv-handler.server`) | rol display/admin |
| `/api/analytics` | **Anónimo** | `behavior_events` append-only (fire-and-forget) |
| `/api/track` | **Anónimo** | atribución/tracking |

> Nota: `api.admin/music/tv` no importan `verifyAuthToken` directamente pero **sí verifican** dentro de su handler `*.server.ts`. No es un agujero de auth.

### 1.3 🚨 ALERTA DE FRAGMENTACIÓN — `/tv/music` vs `/tv/dashboard`

**Hallazgo clave: NO es un problema de branding — son el MISMO componente.**

Ambas rutas renderizan exactamente [`Jumbotron`](app/components/Jumbotron.tsx). La diferencia es **solo los props**:

| | `/tv/music` | `/tv/dashboard` |
|---|---|---|
| Componente | `Jumbotron` | `Jumbotron` |
| `showQr` | ❌ (no) | ✅ |
| `enableBattle` | ❌ (no) | ✅ |
| `initialBattle` | — | ✅ |
| Vídeo premium / tema | ✅ (idéntico) | ✅ (idéntico) |
| Leaderboard GSAP | ✅ | ✅ |
| Endpoint | `/api/tv` (mismo) | `/api/tv` (mismo) |
| Boot/auth fetch | ~70 líneas | ~70 líneas (duplicadas casi literal) |

**Sobre el branding premium reportado:** el vídeo de fondo del local, los blobs de color y el tema **viven dentro de `Jumbotron`** ([`Jumbotron.tsx:264-287`](app/components/Jumbotron.tsx)) y se alimentan de `tenant.bgVideoUrl` / `tenant.theme`, que provee el `TenantProvider` montado en [`root.tsx:193`](app/root.tsx) para **todas** las rutas. Por tanto `/tv/music` **sí recibe** el mismo branding que `/tv/dashboard`. Lo que el usuario percibe como "menos premium" es la **ausencia del panel QR lateral y del modo Batalla**, no del vídeo ni del layout.

**Conclusión:** `/tv/music` es un **subconjunto estricto** de `/tv/dashboard` (`dashboard` = `music` + QR + Batalla). No aporta nada único.

**Recomendación → DEPRECAR `/tv/music`.** La pantalla que debe estar encendida de forma constante es `/tv/dashboard` porque incluye el QR de captación ("Escanea para pedir tu canción") y el modo Duelo en directo, sin perder el Top ni el vídeo. Si se quiere conservar la URL `/tv/music` por compatibilidad de marcadores, convertirla en un **alias** que renderice `<TvDashboard/>` o un `Jumbotron` con flags por query (`?qr=0`), no un archivo paralelo.

> Drift de doc: `ARCHITECTURE.md §4.3` afirma que `/tv/music` usa **cookie-auth**. **Falso en el código actual**: ambas TV usan Bearer cliente (ver [`tv.music.tsx:52-63`](app/routes/tv.music.tsx)). Esto dejó huérfano `lib/cookie-auth.server.ts` (ver §3).

---

## 🗺️ 2. FLUJOS UI/UX: CUELLOS DE BOTELLA

### 2.1 🔴 Flujo del DJ (`/admin`) — meter canciones en el evento (reportado)

Mecánica real (todo en [`admin.tsx`](app/routes/admin.tsx)):

- `LibraryPanel` ([:521](app/routes/admin.tsx)) = **Biblioteca Global** (`global_tracks`, catálogo permanente).
- `PlaylistPanel` ([:578](app/routes/admin.tsx)) = **Control de Pista (esta noche)** (`event_tracks`).
- Ambos se montan en un `grid md:grid-cols-2` ([:317](app/routes/admin.tsx)).
- El paso DB→noche es el botón **"+ Al evento"** ([:553-569](app/routes/admin.tsx)) → `op:"add_track"`.

**Por qué es confuso (causas concretas):**

1. **Dos paneles gemelos visualmente.** Los dos son `rounded-3xl bg-zinc-900/70` con su propio buscador y su propia lista. No hay jerarquía visual que diga "origen" vs "destino". El usuario no distingue de un vistazo el catálogo permanente de la pista de hoy.
2. **La pista de relación es espacial y se rompe en móvil.** El copy dice _"pulsa **+ Al evento** … → "_ apuntando a la columna derecha ([:531](app/routes/admin.tsx)). En `grid md:grid-cols-2` eso solo se cumple en pantalla ancha; en un móvil/tablet vertical los paneles se **apilan** y la flecha "→" apunta a la nada (al panel de abajo).
3. **El textarea de carga masiva tapa el flujo frecuente.** Para añadir un tema que YA está en biblioteca, primero hay que pasar por el textarea de pegar-canciones-nuevas + botón "Cargar a biblioteca" ([:532-538](app/routes/admin.tsx)) y recién después aparece el buscador y la lista. La acción habitual (añadir lo existente) queda **debajo** de la acción rara (cargar nuevo).
4. **No hay feedback de "dónde cae".** Al pulsar "+ Al evento" el item cambia a "En la pista" ([:564](app/routes/admin.tsx)) pero la canción aparece en el OTRO panel; sin animación de transferencia ni scroll-to, el DJ no ve que "algo pasó allí".

**Diagnóstico UX:** falta un flujo direccional único. Hoy es "dos tablas parecidas y un botón +"; debería ser un buscador único con acción de añadir prominente (o drag), y diferenciación visual fuerte entre catálogo y setlist de hoy.

### 2.2 🟠 Flujo de Plantillas (`TemplatesPanel`)

[`TemplatesPanel`](app/routes/admin.tsx) ([:814](app/routes/admin.tsx)) **sí existe y sí permite crear** plantillas a partir de la pista actual:

- **Crear:** input "Nombre de la plantilla" + "Guardar setlist" ([:851-859](app/routes/admin.tsx)), `op:"save_template"`. Se deshabilita si `!hasTracks` (no hay canciones en el evento).
- **Aplicar:** botón "Aplicar" con confirm + estado "Aplicando…" ([:871-883](app/routes/admin.tsx)).
- **Borrar:** ([:884-892](app/routes/admin.tsx)).

**Por qué "no se encuentran":**

1. **Está enterrado al final.** Orden de render ([:304-351](app/routes/admin.tsx)): EventCard → Métricas → Batalla → grid Biblioteca/Pista → **Plantillas** → Eventos. En la noche real el DJ vive en Biblioteca/Pista y nunca scrollea hasta abajo.
2. **Solo se activa con condiciones.** "Guardar setlist" exige `hasTracks`; con la pista vacía el botón está apagado y sin explicación inmediata (el `title` lo aclara, pero hay que hacer hover).
3. **No hay entrada desde el flujo de canciones.** No existe un "Guardar esta pista como plantilla" junto al `PlaylistPanel`, que es donde el DJ está mirando.

**Conclusión:** la funcionalidad de **crear** plantilla existe (no es solo aplicar las de BD), pero su descubribilidad es baja por posición y por gating silencioso.

### 2.3 Flujo Móvil (`/` y subrutas) — callejones sin salida

- **Pantalla `ticket` (legacy).** [`Ticket.tsx`](app/screens/Ticket.tsx) es un **stub que redirige a hub** a los 800ms. El tab "ticket" del [`BottomNav`](app/components/BottomNav.tsx) solo aparece si `activeTicket !== null` ([:43](app/components/BottomNav.tsx)), pero `activeTicket` ya **nunca se setea** (`createTicket` está muerto, §3). Resultado: tab invisible + pantalla zombie alcanzable solo por `sessionStorage` viejo (porque `currentScreen` se persiste, §4).
- **`DJDashboard` (screen) inalcanzable.** Existe el caso `case "dj"` en [`LaPochaApp.tsx:78`](app/components/LaPochaApp.tsx) pero **nadie hace `setScreen("dj")`** (verificado: los launchers en [`GameLauncherCard`](app/components/hub/GameLauncherCard.tsx) solo abren `live/tinder/ruleta/jukebox`). Es un destino sin puerta.
- **LiveBattle tras votar.** Al votar/boostear, la botonera se bloquea y el copy dice _"Mira el ganador en pantalla"_ ([:322-326](app/screens/LiveBattle.tsx)). No hay revelación de ganador in-app: el usuario queda en una pantalla congelada dependiendo de mirar la TV. No es bug, pero es un final muerto en el móvil.
- **Flujos sanos (sin dead-end):** Ruleta (`WinnerModal` → "otra ronda"/"salir a hub", [:320-326](app/screens/RuletaRondas.tsx)), Tinder (modal final → "volver al hub", [:414-420](app/screens/TinderMusical.tsx)), SecretMenu (botón fijo "volver al hub", [:383-391](app/screens/SecretMenu.tsx)), Jukebox (flecha atrás en header). Correctos.

---

## 💀 3. CÓDIGO HUÉRFANO Y COMPONENTES SUBUTILIZADOS

### 3.1 Componentes / hooks con **0 imports** (candidatos a borrado directo)

| Archivo | Estado |
|---|---|
| [`components/hub/LeaderboardCard.tsx`](app/components/hub/LeaderboardCard.tsx) | Huérfano. Hub lo declara "retirado a Fase 2" en comentario ([Hub.tsx:23](app/screens/Hub.tsx)) pero no lo renderiza. Único lector de `store.leaderboard`. |
| [`components/hub/ViralLoopCard.tsx`](app/components/hub/ViralLoopCard.tsx) | Huérfano. "RPC `redeem_referral` pendiente". No montado. |
| [`components/hub/MissionRow.tsx`](app/components/hub/MissionRow.tsx) | Huérfano. `MissionsCard` no lo usa (inlinea sus filas). |
| [`lib/cookie-auth.server.ts`](app/lib/cookie-auth.server.ts) | Huérfano. Nadie lo importa; las TV migraron a Bearer. Drift vs `ARCHITECTURE.md`. |
| [`lib/useEarn.ts`](app/lib/useEarn.ts) | Huérfano. Reemplazado por [`useClaim`](app/lib/useClaim.ts). Solo aparece en comentarios. |

### 3.2 Importado pero **inalcanzable / zombie**

| Archivo | Problema |
|---|---|
| [`screens/DJDashboard.tsx`](app/screens/DJDashboard.tsx) | Importado por `LaPochaApp` pero `screen "dj"` nunca se activa. Arrastra el polling de `useDJLeaderboard` (5s) y el tipo `"dj"` del store. |
| [`screens/Ticket.tsx`](app/screens/Ticket.tsx) | Legacy autoconfeso; solo redirige. Tab del nav nunca visible. |

### 3.3 Estado **mock vestigial** en el store ([`useGameState.ts`](app/store/useGameState.ts))

Escrito pero **nunca leído** por UI viva (verificado por grep de `s.<campo>`):

- `songVotes` + `voteSongEstopa` + `driftSongVotes` (la "batalla Estopa" mock — sustituida por `live_battles` real).
- `songRequests` + `INITIAL_SONG_REQUESTS` + `boostSongRequest` (jukebox mock — sustituido por `event_tracks`).
- `transactions` + `recordTransaction` + `INITIAL_TRANSACTIONS` → **historial paralelo fantasma**: `addTokens/spendTokens` lo alimentan pero el `HistoryDrawer` usa `useHistory` (real `/api/history`). Nadie lee `transactions`.
- `missions` + `INITIAL_MISSIONS` + `completeMission` (`MissionsCard` deriva de `dailyActivity` + `rewardRules`, no de aquí).
- `leaderboard` + `INITIAL_LEADERBOARD` (solo lo lee el huérfano `LeaderboardCard`).
- `profile` + `INITIAL_PROFILE` (ya autodeclarado vestigial, [:91-101](app/store/useGameState.ts)).
- `activeTicket` + `createTicket` + `redeemTicket` (+ `clearTicket`, usado solo por el `Ticket` zombie).
- `spendTokens` (acción): sin llamantes; los gastos reales van por RPC/`/api/wallet`.

> Impacto: ~40% del store es mock muerto. Confunde sobre la fuente de verdad y mantiene viva la rama "demo sin backend" que ya no aplica al piloto en producción.

### 3.4 Redundancia visual / oportunidades de reutilización

- **`tenantSlugFromHost()` duplicado 4 veces** (cliente): [`admin.tsx:45`](app/routes/admin.tsx), [`tv.music.tsx:38`](app/routes/tv.music.tsx), [`tv.dashboard.tsx:45`](app/routes/tv.dashboard.tsx), [`checkin.tsx`](app/routes/checkin.tsx) — y diverge de `extractSlugFromHost` (server) en [`tenant.tsx:68`](app/lib/tenant.tsx). Debe haber **un** helper cliente compartido.
- **Boot/auth de TV duplicado** literal (~70 líneas) entre `tv.music.tsx` y `tv.dashboard.tsx`. Extraer `useTvBoot()`.
- **Patrón "Optimistic claim"** copiado en 4 pantallas (Ruleta [:126-133](app/screens/RuletaRondas.tsx), Tinder [:183-185](app/screens/TinderMusical.tsx), Jukebox [:172-173](app/screens/Jukebox.tsx), LiveBattle [:235-237](app/screens/LiveBattle.tsx)): `addTokens(N) → markDaily → void claim(code)`. Candidato a `useOptimisticClaim()`.
- **`formatDays` vs `formatDaysLong`** en [`SecretMenu.tsx`](app/screens/SecretMenu.tsx) ([:51](app/screens/SecretMenu.tsx) y [:136](app/screens/SecretMenu.tsx)): dos mapas día→etiqueta casi idénticos.
- **`EmptyState` / `Center`** reimplementados en varias pantallas (Tinder, Jukebox, tv.music, tv.dashboard, admin) — primitivo común sin extraer.

---

## ⚠️ 4. INCONSISTENCIAS DE ESTADO Y ARQUITECTURA

### 4.1 Mezcla de gestores de estado

Conviven **cuatro** fuentes y no siempre está claro cuál manda:

1. **Zustand** ([`useGameState`](app/store/useGameState.ts)) — global, con `persist` en `sessionStorage`. Mezcla campos reales (`tokens`, `activeEventId`, `dailyActivity`) con mock muerto (§3.3).
2. **`useState` local** — `battle`/`deck`/`voted` en pantallas (LiveBattle, Tinder, Jukebox).
3. **Supabase Realtime** — canales WS.
4. **Servidor (authoritative)** — el balance real lo fija `setBalance` desde la respuesta del RPC.

Síntoma: `addTokens(N)` (optimista) escribe en `tokens` **y** en el `transactions` fantasma; acto seguido `claim()` llama `setBalance()` que **sobrescribe** `tokens` con el valor del servidor. Doble contabilidad: una que se pisa y otra (`transactions`) que nadie lee.

### 4.2 Cargas/listeners redundantes a Supabase Realtime

Inventario de canales:

| Canal | Tabla(s) | Dónde |
|---|---|---|
| `nowplaying:${eventId}` | `event_tracks` | [`NowPlaying.tsx:63`](app/components/NowPlaying.tsx) |
| `live:tracks:${eventId}` | `event_tracks` | [`LiveBattle.tsx:126`](app/screens/LiveBattle.tsx) |
| `live:battle:${eventId}` | `live_battles` | [`LiveBattle.tsx:106`](app/screens/LiveBattle.tsx) |
| `tv:event_tracks:${eventId}` | `event_tracks` | [`Jumbotron.tsx:97`](app/components/Jumbotron.tsx) |
| `tv:live_battles:${eventId}` | `live_battles` | [`Jumbotron.tsx:162`](app/components/Jumbotron.tsx) |
| `admin-metrics-${eventId}` | 5 tablas | [`admin.tsx:241`](app/routes/admin.tsx) |

🔴 **Doble suscripción a `event_tracks` en la pantalla `live` del móvil.** Como `live ∈ SCREENS_WITH_NAV`, `NowPlaying` se monta junto a `LiveBattle`; ambos abren un canal a `event_tracks` del **mismo `event_id`** (`nowplaying:*` y `live:tracks:*`). Reciben el **mismo payload** y lo procesan dos veces. Deberían compartir un único canal (`useEventTracksChannel`).

🟠 **LiveBattle abre 2 canales** (`live:tracks` + `live:battle`) que podrían fusionarse.

🟠 **Fetch de deck inútil en LiveBattle.** `LiveBattle` llama `useMusic(activeEventId)` solo por `castVote`, pero `useMusic` dispara un `GET …mode=swipe` al montar ([`useMusic.ts:125-127`](app/lib/useMusic.ts)) que carga un deck que LiveBattle **nunca renderiza**.

### 4.3 Lógica de negocio en componentes (debería estar en hooks)

- **Consultas directas a Supabase desde la vista.** [`LiveBattle.tsx:71-91`](app/screens/LiveBattle.tsx) hace `supabase.from('live_battles')` + `from('event_tracks')` y arma el duelo dentro del componente; igual [`Jumbotron.tsx:151-158`](app/components/Jumbotron.tsx). Saltan la capa de hooks/handlers. Extraer `useLiveBattle()`.
- **Reconciliación optimista inline** repetida en 4 pantallas (§3.4).

### 4.4 Economía duplicada / single-source-of-truth roto

El store sirve `rewardRules` desde `/api/session` y expone `rewardAmount(code, fallback)` ([:426](app/store/useGameState.ts)), pensado como única fuente de costes/premios. Pero **solo lo usan** `WelcomeModal` y `MissionsCard`. Las pantallas de juego **hardcodean**:

- `BOOST_COST = 50` (Jukebox [:33](app/screens/Jukebox.tsx)), `BOOST_COST = 30` (LiveBattle [:33](app/screens/LiveBattle.tsx)), `REWARD = 25` (Tinder [:35](app/screens/TinderMusical.tsx)), `SPIN_REWARD = 15` (Ruleta [:27](app/screens/RuletaRondas.tsx)), `+10`/`+20` inline.

El servidor es authoritative para el **débito real**, pero las **etiquetas y los gates de UI** divergen: si el negocio cambia un precio en BD, la app sigue mostrando/anunciando el número viejo. Debe leerse todo vía `rewardAmount`.

### 4.5 Persistencia que reabre pantallas muertas

`currentScreen` se persiste en `sessionStorage` ([partialize :439](app/store/useGameState.ts)). Un usuario que quedó en `ticket` (o cualquier screen retirado) **reentra en el stub zombie** al recargar. La persistencia de pantalla debería validarse contra el set de pantallas vivas.

### 4.6 Drift de documentación

`ARCHITECTURE.md` describe `/tv/music` con **cookie-auth** y `cookie-auth.server.ts` como pieza activa; el código actual usa Bearer y ese archivo está **huérfano**. La doc también lista la "batalla Estopa" / jukebox mock como si fueran el modelo, cuando ya hay tablas reales.

---

## 📋 5. PLAN DE ACCIÓN PARA EL CTO (próximo Sprint)

Ordenado por criticidad (impacto en piloto × esfuerzo):

- [ ] **1. Rediseñar el flujo DJ de añadir canciones (`/admin`).** _(crítico, reportado)_ Unificar `LibraryPanel`→`PlaylistPanel` en un flujo direccional claro: buscador único sobre biblioteca, acción **"+ Añadir a la noche"** prominente con feedback de transferencia (animación/scroll-to en la pista), y diferenciación visual fuerte (origen vs destino). Mover el textarea de carga masiva a un acordeón secundario. Añadir "Guardar esta pista como plantilla" junto al `PlaylistPanel` y subir `TemplatesPanel` por encima del pliegue.

- [ ] **2. Consolidar las pantallas de TV.** Deprecar `/tv/music` y dejar `/tv/dashboard` como **pantalla única always-on** (QR + Batalla + Top + vídeo). Si se mantiene la URL, convertirla en alias con flags por query. Extraer `useTvBoot()` (elimina ~70 líneas duplicadas) y actualizar `ARCHITECTURE.md`.

- [ ] **3. Purga de código muerto.** Borrar `LeaderboardCard`, `ViralLoopCard`, `MissionRow`, `cookie-auth.server.ts`, `useEarn.ts`, la screen `DJDashboard` (+ tipo `"dj"`), la screen `Ticket` (+ `activeTicket`/`createTicket`/`redeemTicket`/tab ticket) y todo el estado mock del store (`songVotes`, `songRequests`, `transactions`, `missions`, `leaderboard`, `profile`, `spendTokens`). Validar `currentScreen` persistido contra pantallas vivas.

- [ ] **4. Unificar la capa Realtime.** Un único canal `event_tracks` por evento, compartido vía hook `useEventTracksChannel`, consumido por `NowPlaying` y `LiveBattle` (elimina la doble suscripción en la pantalla `live`). Fusionar los 2 canales de `LiveBattle` y quitar el `GET deck` inútil. Extraer `useLiveBattle()` para sacar las queries Supabase de la vista.

- [ ] **5. Centralizar economía y lógica compartida.** Sustituir TODAS las constantes de coste/premio hardcoded por `rewardAmount(code)` (single source of truth). Extraer `useOptimisticClaim()` (patrón repetido en 4 pantallas) y un helper cliente único `tenantSlugFromHost()` (hoy duplicado 4×). Unificar `EmptyState`/`Center` y `formatDays`.
