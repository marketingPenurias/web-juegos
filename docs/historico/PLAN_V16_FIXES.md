# 🛠️ Plan V1.6 — Fixes & Mejoras (para claude-code)

> Diagnósticos verificados contra la BD de producción (`cfxpwsexxwcxogwuykue`, tenant `lapocha`).
> Orden por prioridad. Cada item: **Problema → Causa → Propuesta → Toca**.

---

## 🔴 BLOQUE A — BUGS CRÍTICOS (bloquean la batalla y la TV)

### A1. 403 Forbidden al leer `live_battles` (la batalla nunca aparece)
- **Problema:** `GET /rest/v1/live_battles?...status=eq.live` → **403**, en móvil (LiveBattle) y en la TV. La batalla no se ve aunque esté iniciada.
- **Causa (CONFIRMADA):** las tablas creadas en la migración `09` (`live_battles`, `global_tracks`, `qr_strategies`) **no tienen `GRANT SELECT` para los roles `anon`/`authenticated`**. PostgREST corta con 403 *antes* de evaluar la RLS (las policies ya existen y son correctas). En cambio `event_tracks`/`track_votes`/`venue_visits` sí tienen el grant (vienen del esquema base), por eso esas sí funcionan.
- **Propuesta:** nueva migración `database/11_grants_fix.sql`:
  ```sql
  grant select on public.live_battles  to anon, authenticated;
  grant select on public.global_tracks to anon, authenticated;
  -- qr_strategies se lee sólo server-side (service_role) → no hace falta,
  -- pero por consistencia se puede añadir si algún día se lee en cliente.
  -- Asegurar default privileges para futuras tablas (opcional):
  -- alter default privileges in schema public grant select on tables to anon, authenticated;
  ```
  Aplicar a producción. Sin esto, NADA de lo demás de la batalla funciona.
- **Toca:** SQL (migración nueva).

### A2. El admin no puede abrir `/tv/dashboard` (ni el dashboard de TV)
- **Problema:** un usuario `admin` logueado en la app no puede entrar al Jumbotron; debería poder ver app + admin + TV.
- **Causa:** `/tv/dashboard` (y `/tv/music`) autentican por **cookie** (`requireTenantRole` en `tv-dashboard-handler.server.ts`), pero el login del SPA usa **localStorage** (`supabase.client.ts`, sin cookie). El loader server no encuentra sesión → 401/redirect.
- **Propuesta (recomendada, alinear con `/admin`):** convertir `/tv/dashboard` a **gating cliente + endpoint autenticado**:
  1. Nuevo `POST /api/tv` (handler tipo `admin-handler`): `verifyAuthToken` + comprobar rol `display`/`admin` (o `is_tenant_staff`) → devuelve `{ tenant_id, event, tracks, battle }`.
  2. `tv.dashboard.tsx` pasa a client-render: en `useEffect` llama a `/api/tv` con `Authorization: Bearer` (`getAccessToken`) y monta el `Jumbotron` con esos datos.
  3. El `Jumbotron` ya hace realtime; con A1 corregido, las suscripciones a `live_battles`/`event_tracks` funcionan para el staff logueado.
  - *Alternativa:* mantener cookie y crear un flujo de login "kiosko/display" — más infra, no recomendado ahora.
- **Toca:** `app/routes/tv.dashboard.tsx`, nuevo `app/routes/api.tv.ts` + `app/lib/tv-handler.server.ts` (o reutilizar `tv-dashboard-handler` adaptado a Bearer). Depende de A1.

---

## 🟠 BLOQUE B — PANEL `/admin` (gestión real para el DJ/Staff)

### B1. Histórico de eventos
- **Problema:** solo se ve el evento del día. El DJ no ve eventos pasados.
- **Propuesta:** en `bootstrap` (admin-handler) devolver también `events_history` (últimos N `tenant_events` del tenant, cualquier estado, orden desc). En `admin.tsx` añadir una sección/lista "Eventos" con su estado (activo/programado/cerrado) y acción de "activar" / "ver".
- **Toca:** `app/lib/admin-handler.server.ts` (bootstrap + op `list_events`), `app/routes/admin.tsx`.

### B2. Programar eventos futuros (no solo "abrir hoy")
- **Problema:** solo existe "Abrir Fiesta de Hoy" (crea uno activo ahora).
- **Propuesta:** op `create_event` con `name`, `start_time`, `end_time`, `status` (`scheduled` | `active`). UI: formulario "Nuevo evento" con fecha/hora (reutilizar el helper de timezone Madrid ya existente). Permitir activar un evento programado (op `activate_event` → set `status='active'` y desactivar el anterior si procede). Nota: revisar el CHECK de `tenant_events.status` (ver qué valores admite; si solo `active`/otros, ampliar o usar los permitidos).
- **Toca:** `admin-handler.server.ts` (ops `create_event`, `activate_event`), `admin.tsx`. Posible micro-migración si el CHECK de `status` no admite `scheduled`.

### B3. Buscador de canciones para añadir (no solo pegar texto)
- **Problema:** hoy solo se pueden meter canciones pegando tuplas. Se pide **buscar** una canción y añadirla al general/evento desde el panel.
- **Propuesta (2 niveles, elegir):**
  - **Rápido (sin credenciales):** un buscador que filtra `global_tracks` ya cargadas y permite mandarlas al evento con "+". (Complementa el buscador de pista de B4.)
  - **Completo (Spotify):** integrar **Spotify Web API Search**. Requiere crear una app en Spotify (client id/secret) → endpoint Edge `POST /api/admin {op:'spotify_search', q}` que use *client-credentials* para buscar y devolver `{spotify_id,title,artist,cover}`; botón "+" inserta en `global_tracks` (+ opcionalmente al evento). **Decisión de negocio:** ¿montamos la integración Spotify (necesita credenciales) o de momento basta el buscador local + pegado masivo?
- **Toca:** `admin-handler.server.ts` (op búsqueda), `admin.tsx` (input de búsqueda + resultados). Si Spotify: secret en Cloudflare env + cliente HTTP.

### B4. Buscador en "Control de Pista (esta noche)"
- **Problema:** con muchas canciones, el DJ no encuentra nada.
- **Propuesta:** input de filtro client-side sobre `event_tracks` (título/artista), como el del Jukebox. Trivial, sin backend.
- **Toca:** `app/routes/admin.tsx`.

### B5. "Parar lo que suena" + claridad del botón "Sonando"
- **Problema 1:** el DJ no puede dejar "nada sonando" (si la siguiente no está cargada, la anterior se queda marcada demasiado tiempo → mala UX).
- **Problema 2:** TODAS las filas muestran un botón verde "Sonando", que se lee como estado pero es la acción de poner. Confunde.
- **Propuesta:**
  - Op `stop_now_playing` → `update event_tracks set is_played=false where event_id=... and tenant_id=...`. Botón global "⏹ Nada sonando" en el panel (dispara Now Playing vacío en los móviles).
  - Renombrar el CTA por fila de "Sonando" a **"▶ Poner"**; reservar el verde/etiqueta "● SONANDO" SOLO para la fila activa (ya se hace con el tag). Así no hay ambigüedad.
- **Toca:** `admin-handler.server.ts` (op `stop_now_playing`), `admin.tsx` (label + botón). `NowPlaying.tsx` ya gestiona el caso "nada" (oculta la barra).

### B6. Batalla: el DJ debe ELEGIR las dos canciones
- **Problema:** "Iniciar Batalla" coge automáticamente el top-2; el DJ no elige.
- **Propuesta:** modificar el flujo de batalla para selección manual:
  - RPC `admin_start_battle` → aceptar `p_track_a` y `p_track_b` explícitos (con fallback al top-2 si vienen null, para compatibilidad). Validar que ambos pertenecen al evento y no están `is_played`.
  - `admin.tsx`: UI para seleccionar 2 pistas (checkbox/selección en la lista de Control de Pista) antes de "Iniciar Batalla"; pasar los ids al endpoint.
- **Toca:** SQL (CREATE OR REPLACE `admin_start_battle` con 2 args nuevos), `admin-handler.server.ts` (op `start_battle` pasa track_a/track_b), `admin.tsx` (selector).

---

## 🟡 BLOQUE C — APP MÓVIL

### C1. Tinder: el "like" no parece sumar (solo el dislike)
- **Problema:** al deslizar a LIKE no se percibe que cuente; con DISLIKE sí avanza.
- **A investigar / causa probable:** el LIKE llama a `castVote` (vote_track free, +1 voto real); el DISLIKE solo avanza localmente. Posibles motivos del síntoma: (a) si la canción ya fue votada antes → `already_voted` y no incrementa (correcto pero sin feedback visible); (b) el `await castVote` dentro del `onComplete` retrasa el avance de la carta y se percibe "lento/no cuenta"; (c) falta feedback visual del voto sumado.
- **Propuesta:** definir UX esperada y aplicarla:
  - El LIKE debe mostrar feedback inmediato ("+1 voto a esta canción" / animación), avanzar la carta sin esperar a la red (optimista), y registrar el voto en background.
  - Manejar `already_voted` como info silenciosa (no error).
  - Revisar `TinderMusical.tsx` (`handleSwipe`): mover el `castVote` a fire-and-forget tras animar, igual que el dislike, para que ambos se sientan iguales.
- **Toca:** `app/screens/TinderMusical.tsx`.

### C2. No aparece el pop-up de bienvenida (+100 al registrarse)
- **Problema:** no sale el modal de "+100 tokens".
- **Causa:** el modal se dispara con `is_new_user`, que solo es `true` en el **primer login de la vida** (cuando el JIT crea el perfil). La cuenta de prueba **ya existía**, así que `is_new_user=false` → no aparece. No es un bug del modal.
- **Propuesta (elegir):**
  - **Verificar** con una cuenta Google nueva (mostrará el +100 una vez). O
  - **Desacoplar** el trigger: que `/api/session` marque `show_welcome` cuando el `signup_bonus` existe en `wallet_ledger` pero el cliente aún no lo ha "reconocido" (flag servidor/columna `welcome_seen_at` en `user_profiles`), en vez de depender solo del JIT. Más robusto para reinstalaciones/multi-dispositivo.
- **Toca:** (si se desacopla) `app/routes/api.session.ts`, `app/lib/useSession.ts`, `app/store/useGameState.ts`, posible micro-migración (`user_profiles.welcome_seen_at`).

---

## 🟢 BLOQUE D — DEPENDIENTES / VERIFICACIÓN

### D1. Jumbotron modo Duelo
- Una vez aplicados **A1** (grant) y **A2** (auth TV), la batalla aparecerá en TV y móvil. Re-verificar el flujo completo: iniciar batalla (con selección B6) → ambos móviles + TV muestran el duelo sincronizado → autocierre → ganador.

### D2. "Biblioteca vacía" en el panel
- En la captura salía vacía porque las `global_tracks` se sembraron **después** de abrir el panel. Con un **reload** ya muestran 12. No es bug; B3/B4 mejoran su gestión. Verificar tras A1 (por si el cliente intentara leer `global_tracks` directo en algún punto → necesitaría el grant de A1).

---

## Orden sugerido de ejecución
1. **A1** (grant SQL) — desbloquea batalla en móvil y TV. *Imprescindible y de 1 línea.*
2. **A2** (auth TV) — admin entra al dashboard.
3. **B6** (elegir canciones de batalla) + **B5** (parar/etiqueta) — núcleo DJ.
4. **B4** (buscador pista) + **B1/B2** (histórico + programar) — gestión.
5. **C1** (Tinder like) + **C2** (welcome).
6. **B3** (buscador Spotify) — decidir alcance (local vs API Spotify) antes.

## Decisiones de negocio pendientes (para ti)
- **B3:** ¿integración real con Spotify Search (requiere credenciales de una app Spotify) o de momento buscador local + pegado?
- **B2:** ¿estados de evento que quieres (`scheduled`, `active`, `ended`…)? Confirmar para ajustar el CHECK.
- **B6:** ¿el DJ elige siempre las 2, o "auto top-2" como opción rápida además de la manual?
