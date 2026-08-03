# V20 · Bitácora de trabajo

Documento vivo: **contexto + plan + estado + qué se ha cambiado y por qué**.
Se actualiza al cerrar cada fase. Sirve de memoria entre sesiones — leer esto
primero antes de retomar.

- **Rama de integración:** `feat/v20` → una sola PR a `main` al final.
- **Ramas por fase:** `feat/v20-fN-...`, se mergean a `feat/v20` al terminar.
- **Referencias:** modelo de BD en [`database/DB_MODEL.md`](database/DB_MODEL.md) ·
  grafo de código en `graphify-out/` (`graphify query "..."`).

---

## Estado de las fases

| # | Fase | Estado | Deploy |
|---|---|---|---|
| 0 | Grants de `service_role` | ✅ **hecho** (en producción) | no requiere |
| 1 | Robustez: no tragarse errores | ✅ **hecho** | sí |
| 2 | TV: visibilidad, QR de batalla, nube en Live | ✅ **hecho** | sí |
| 3 | Promociones por tier real | ✅ **hecho** | sí |
| 4 | Modularización (clean code) | ⬜ pendiente | sí |
| 5 | Refactor N-a-N `event_tracks` ↔ `global_tracks` | ⬜ pendiente | sí |

## Decisiones tomadas (no volver a discutir)

1. **N-a-N al final** (fase 5), tras los fixes y la UX.
2. **Canción sonada** reaparece en la tele **si la vuelven a votar O pasadas 2 h**
   (se conserva la ventana de 2 h además del re-voto).
3. **QR de la batalla** = `/checkin?code=…&next=live` → registra la visita
   (fidelidad + KPI) **y** abre la batalla.
4. Ranking de la tele: **solo temas con votos > 0**.

---

## FASE 0 — Grants de `service_role` ✅

**Bug raíz.** 7 tablas sin ningún privilegio para `service_role`, el rol con el
que el worker lee vía PostgREST con la service key. Ese rol **bypassa RLS pero
sigue necesitando GRANTs**, así que toda lectura directa fallaba mientras las
escrituras (RPCs `SECURITY DEFINER`) seguían funcionando → el fallo parecía
aleatorio. Agravado por `const { data } = await …`, que descarta el error y
devuelve `[]` (la UI mostraba "no hay nada" en vez de un error).

Tablas afectadas: `global_tracks`, `event_templates`, `event_template_tracks`,
`qr_strategies`, `live_battles`, `tenant_token_rewards`, `tenant_tier_thresholds`.

**Síntomas que resolvió:**
- Almacén global y Plantillas vacíos en `/admin`.
- `qr_strategies` ilegible → `/api/tv` no resolvía el QR de entrada → el QR del
  jumbotron caía al enlace de atribución → **nadie llegaba a `/checkin`**:
  0 `venue_visits` con 360 perfiles registrados → KPI de check-ins y racha de
  fidelidad clavados a 0.
- Batalla ausente en el arranque de `/admin` y de la TV.
- `/api/session` devolvía `reward_rules: []` → cliente con precios hardcodeados.

**Cambio:** `GRANT SELECT/INSERT/UPDATE/DELETE` a `service_role` en las 7 tablas
+ `ALTER DEFAULT PRIVILEGES` para tablas futuras.
Migración `v20_fix_service_role_grants` · espejo:
[`database/24_v20_service_role_grants.sql`](database/24_v20_service_role_grants.sql).

**Verificado:** `has_table_privilege('service_role', …, 'SELECT') = true` en las 7.
**Pendiente de confirmación visual:** que `/admin` liste Plantillas y Almacén.

---

## FASE 1 — Robustez: no tragarse errores ✅

**Problema.** El patrón `const { data } = await supabase…` descartaba el error,
así que un fallo de permisos se mostraba como "no hay datos". Fue lo que mantuvo
oculto el bug de grants.

**Cambios**
- `admin-handler.server.ts` · `bootstrap()`: cada query captura su `error`,
  lo loguea y suma un aviso. La respuesta añade `warnings: string[]`.
- `tv-handler.server.ts`: igual para `qr_strategies`, `tv_ranking`,
  `now_playing` y `live_battles`; devuelve `warnings`.
- `admin.tsx`: banner ámbar cuando `warnings.length > 0` — distingue
  "no hay datos" de "no se pudo cargar".

## FASE 2 — TV: visibilidad, QR de batalla y nube en Live ✅

### 2.1 Regla de visibilidad del ranking
Nueva RPC **`tv_ranking(p_event_id, p_limit)`**
([`database/25_v20_tv_ranking.sql`](database/25_v20_tv_ranking.sql)):
sólo temas con votos · fuera el que suena · los sonados vuelven si los re-votan
**o** pasadas 2 h · empate → gana el que lleva más tiempo con esos votos.

- Vive en SQL porque compara **dos columnas** (`last_vote_at > played_at`), algo
  que PostgREST no expresa; así la regla existe **una sola vez**.
- `SECURITY INVOKER` → respeta RLS desde el navegador; el worker la llama con
  service_role.
- `tv-handler` y el poll del `Jumbotron` la usan. `Jumbotron.sorted` replica la
  regla en cliente sólo para que el Realtime no cuele filas entre polls.
- **Cero pérdida de datos:** `track_votes`/`total_votes` intactos → al reaparecer
  conserva todos sus votos y las métricas siguen completas.
- Empty state reescrito: al empezar la noche la lista está vacía **a propósito**
  → "Aún no hay votos · escanea el QR y elige la primera".

### 2.2 QR de la batalla + deep-link
- `Jumbotron`: el modo DUELO ya tiene su QR (antes no había ninguno justo en el
  momento de máxima atención). Apunta a
  `/checkin?code=…&next=live&ref=QR-TV-BATALLA` → **check-in + entrar al duelo**.
- `useDeepLinkScreen.ts` (nuevo): guarda la intención en `localStorage` y la
  aplica **cuando hay sesión**, para que sobreviva al redirect de Google OAuth.
  One-shot: un refresh no vuelve a forzar la pantalla.
- `checkin.tsx`: lee `next` y lo memoriza vía `rememberScreen()`.
- `ref` distinto (`QR-TV` vs `QR-TV-BATALLA`) para separar orígenes en analítica.

### 2.3 "Nube" de batalla en vivo
- `useActiveBattle.ts` (nuevo): **un solo** canal Realtime de `live_battles` +
  poll de seguridad a 30 s; publica `battleActive` en el store (sin
  prop-drilling ni sockets duplicados). `LiveBattle` conserva su canal porque
  necesita el detalle del duelo.
- `store`: `battleActive` + `setBattleActive` (efímero, no se persiste; el setter
  ignora escrituras iguales para no re-renderizar el nav en cada tick).
- `BottomNav`: nube flotante (GSAP) + halo pulsante sobre *Directo*.
- `GameLauncherCard`: chip "¡Batalla!" en la card de Live.
- i18n `nav.battleLive` (es/en).

### Verificación
`tsc` limpio · `npm run build` OK · RPC probada contra el evento del sábado:
759 filas totales → 124 con votos → la tele sólo pinta esas.

Prueba de la regla con 5 casos sintéticos (transacción + rollback, sin rastro):

| Caso | Esperado | Resultado |
|---|---|---|
| sin votos | oculto | ✅ |
| sonando ahora | oculto | ✅ |
| sonada, sin re-voto | oculto | ✅ |
| **sonada y RE-VOTADA** | **visible, votos intactos** | ✅ |
| sonó hace 3 h | visible | ✅ |

## FASE 3 — Promociones por tier real ✅

**Problema.** `SecretMenu` daba por hecho que **todos son bronce**
(`if (min_tier_required !== "bronce") → bloqueado`), decisión de piloto que se
quedó fija: un usuario Oro veía sus propias promos como "próximamente". Además
el store **no guardaba** el `tier` que `/api/session` ya calcula bien.

**Regla de producto.** Ves lo tuyo y **asomas al siguiente nivel** como
zanahoria; lo que está dos escalones por encima no se muestra (ruido):

| Tu tier | Disponible | "Próximamente" | Oculto |
|---|---|---|---|
| Bronce | Bronce | Plata | Oro, Platino |
| Oro | Bronce, Plata, Oro | Platino | — |

**Cambios**
- `lib/tier.ts`: `tierRank()`, `productVisibility()` y `pointsToTier()` —
  funciones **puras**, testeables y reutilizables.
- `store`: nuevo `tier` (server-authoritative, no se recalcula en cliente para
  no desincronizarse de `tenant_tier_thresholds`); se resetea al desloguear.
- `useSession`: propaga `data.tier`.
- `SecretMenu`: usa `productVisibility(...)` con el tier real; `LockedCard`
  muestra **"te faltan N pts"** — convierte el muro en objetivo concreto.
- i18n `menu.unlockMissing`.

> Los umbrales de BD (`0/500/1500/4000`) coinciden con los de `tier.ts`, así que
> no hubo que migrar nada. La RPC `purchase_reward` sigue validando el tier
> server-side: esto es sólo presentación.
