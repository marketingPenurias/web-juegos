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
| 4 | Modularización (clean code) | 🟡 **parcial** (ver nota) | sí |
| 5 | Refactor N-a-N `event_tracks` ↔ `global_tracks` | ✅ **hecho** | sí |

> ✅ **Desplegado en producción el 04/08** (BD + código). Ver
> [validación post-deploy](#validación-post-deploy--0408-1810) y el
> [plan de pruebas](#plan-de-pruebas-tras-el-deploy).

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

## FASE 5 — `event_tracks` N-a-N sobre `global_tracks` ✅

**Problema.** Cada evento **clonaba el catálogo entero**: 9.108 filas para 759
canciones distintas (12×), repitiendo título/artista/portada/género. Corregir un
título obligaba a tocarlo evento por evento y el género vivía duplicado.

**Modelo nuevo.** `global_tracks` = el catálogo (la verdad). `event_tracks` = el
**estado** de un tema en UNA noche (votos, si sonó, cuándo), unido por
`global_track_id`. La fila **sólo se crea cuando hace falta** (primer voto o
inyección del DJ) → un evento pasa de 759 filas a las que de verdad se usan.

**Cambios** ([`database/26_v20_event_tracks_n_to_n.sql`](database/26_v20_event_tracks_n_to_n.sql))
- Migración **aditiva**: `global_track_id` + backfill + `unique(event_id, global_track_id)`.
  Verificado: **0 huérfanos, 9.108/9.108 mapeadas**. No se borró ninguna columna,
  así que los eventos ya creados siguen comportándose igual.
- `ensure_event_track()` — materializa la fila; a prueba de carreras
  (`ON CONFLICT` + relectura).
- `event_catalog()` — catálogo + estado del evento por LEFT JOIN. Con
  `p_exclude_voted_by` alimenta también el **deck del Tinder**: sin eso, la
  creación lazy lo habría dejado **sin cartas** en un evento nuevo.
- `vote_track()` acepta `p_global_track_id` y crea la fila. De paso se
  **eliminaron las dos sobrecargas obsoletas** (7 y 9 args) → una sola firma.
- Cliente: Jukebox y Tinder votan por id de catálogo (estable aunque no exista
  fila); la Batalla sigue votando por `track_id` porque el DJ enfrenta filas
  reales.

**Sin pérdida de datos:** `track_votes.track_id` sigue apuntando a
`event_tracks.id` → histórico de votos y métricas intactos.

**Probado** (transacción + rollback): evento creado **vacío** → un voto por
catálogo → **1 fila creada**, catálogo visible 759, en la tele 1.

## FASE 4 — Modularización 🟡 parcial

**Hecho** (extracciones de bajo riesgo y alto reuso):
- `lib/search.ts` — `normalize` / `matchScore` / `searchTracks`, lógica **pura**
  sacada del Jukebox y reutilizable por el buscador del admin.
- `lib/madrid-time.ts` — conversión ISO ↔ `datetime-local` en hora del local
  (con DST), sacada de `admin.tsx`.
- `components/tv/` — `DuelSide`, `QrBlock`, `NowPlayingPanel`, `WinnerOverlay`,
  `EmptyState` y `types.ts`, sacados de `Jumbotron.tsx`.

| Fichero | Antes | Ahora |
|---|---|---|
| `Jumbotron.tsx` | 902 | **716** (+6 módulos en `components/tv/`) |
| `Jukebox.tsx` | 643 | **603** |
| `admin.tsx` | 1608 | **1580** |

**NO hecho, a propósito:** trocear `admin.tsx` (1.580 líneas) en
`components/admin/*`. Es la pieza más grande y **mover ~1.500 líneas de JSX sin
poder verlo en pantalla es justo donde más fácil se rompe la UI**. Queda como
primera tarea de la siguiente sesión, ya con el deploy probado.

---

# Plan de pruebas (tras el deploy)

Orden pensado para que cada paso valide el anterior. Marca ✅/❌ al pasar.

## 0 · Antes de desplegar
- [ ] `npm run build` sin errores.
- [ ] Desplegar (`npx wrangler deploy`). **Solo lo puede hacer el equipo.**

## 1 · Panel /admin (valida FASE 0 + F1)
- [ ] Pestaña **Plantillas**: se listan las 2 plantillas (antes: vacío).
- [ ] Pestaña **Almacén Global**: se listan 759 temas (antes: vacío).
- [ ] **No** aparece el banner ámbar de "secciones no cargadas".
      → Si aparece, dice exactamente qué falló (eso es F1 funcionando).

## 2 · Check-in y fidelidad (el bug gordo)
- [ ] Abrir `/tv/dashboard` y **escanear el QR** con un móvil.
- [ ] La URL debe ser `…/checkin?code=POCHA-ENTRADA-01&ref=QR-TV`
      (si lleva a `/?ref=QR-TV`, `qr_strategies` sigue sin leerse).
- [ ] Con cuenta nueva de Google: login → **check-in automático** tras el alta.
- [ ] Sale el pop-up con **+50 tokens y racha**.
- [ ] En `/admin`, el KPI **Check-ins hoy** sube (antes clavado a 0).
- [ ] SQL de control: `select count(*) from venue_visits where tenant_id=…;`

## 3 · Tele: qué se ve y qué no (F2)
- [ ] Evento recién abierto → la lista sale **vacía** con
      *"Aún no hay votos · escanea el QR y elige la primera"* (correcto).
- [ ] Votar un tema → aparece en la tele en pocos segundos.
- [ ] Un tema con **0 votos nunca** aparece.
- [ ] El DJ marca "Sonando ahora" → **desaparece** del ranking.
- [ ] **Re-votar** ese mismo tema → **vuelve con todos sus votos** (no reinicia).
- [ ] Split view: toggle **Canción actual** en `/admin` → mitad lista / mitad
      canción, **y el QR sigue visible** (antes desaparecía).

## 4 · Batalla (F2)
- [ ] Lanzar batalla desde `/admin`.
- [ ] En la app aparece la **nube "¡Batalla!"** sobre *Directo* y el chip en el
      Hub, **sin entrar** a la pantalla.
- [ ] En la tele, el duelo muestra **su propio QR**.
- [ ] Escanear ese QR → hace **check-in** y abre **directamente la batalla**.
- [ ] Probar también con **sesión cerrada**: login de Google por medio y debe
      seguir aterrizando en la batalla (es el caso que más fácil se rompe).
- [ ] Al acabar: animación de ganador y la nube desaparece.

## 5 · Promociones por tier (F3)
- [ ] Con usuario **Bronce**: ve promos Bronce disponibles, las de **Plata como
      "Próximamente"** con *"te faltan N pts"*, y **NO** ve Oro ni Platino.
- [ ] Subir a un usuario de prueba a Oro (`lifetime_earned >= 1500`) y
      comprobar que ve Bronce/Plata/Oro y **Platino** como próximamente.
- [ ] Comprar una promo de tu tier → funciona.

## 6 · Jukebox y Tinder sobre el modelo N-a-N (F5)
- [ ] Jukebox lista el **catálogo completo** (759) aunque el evento sea nuevo.
- [ ] Filtro por **género** y buscador tolerante siguen funcionando.
- [ ] Pedir un tema **nunca votado** → se registra (crea la fila lazy).
- [ ] Los **5 votos gratis** siguen contando; al agotarlos, "Pedir · 15".
- [ ] **Tinder**: salen cartas en un evento nuevo (si sale vacío, es el bug que
      cubre `p_exclude_voted_by`).
- [ ] **Batalla**: votar sigue funcionando (usa `track_id`, no catálogo).
- [ ] SQL de control tras la noche:
      `select count(*) from event_tracks where event_id='<nuevo>';`
      → debe ser **decenas**, no 759.

## 7 · Activar el ahorro del N-a-N (último paso, opcional)
Hasta aquí los eventos se siguen creando **clonando** las 759 filas, para que
todo sea compatible. Cuando 1–6 estén ✅:
- [ ] Crear el siguiente evento **sin clonar** (sólo la fila de `tenant_events`).
- [ ] Repetir las pruebas 3 y 6 sobre ese evento.
- [ ] Si algo falla, se vuelve a crear clonando (rollback trivial).

## Consultas útiles de control
```sql
-- Check-ins de la noche
select count(*) from venue_visits
where tenant_id='b6e2b669-22a0-4cb9-adfc-20e3f344a44b'
  and business_night(entry_time)=business_night(now());

-- Qué pinta la tele ahora mismo
select * from tv_ranking('<event_id>', 10);

-- Cuánto ocupa un evento (antes 759)
select count(*) from event_tracks where event_id='<event_id>';
```

---

## Validación post-deploy · 04/08 18:10

**Desplegado y confirmado** (marcadores presentes en los bundles de producción):
`ng_pending_screen`, `battleLive`, `unlockMissing`, `global_track_id` (app) ·
`tv_ranking`, `QR-TV-BATALLA`, "Escanea y vota", `checkin?` (TV).

| Prueba | Cómo | Resultado |
|---|---|---|
| Deep-link del QR de batalla (**flujo frío**, el más frágil) | abrir `/checkin?code=…&next=live` sin sesión | ✅ guarda `ng_pending_screen=live` y `ng_pending_checkin=POCHA-ENTRADA-01`, y manda al login |
| Worker sano | `POST /api/tv`, `/api/session`, `/api/music` sin auth | ✅ 401 limpio (no 500) |
| Grants | `has_table_privilege` en las 7 tablas | ✅ |
| Regla de visibilidad | 5 casos sintéticos + rollback | ✅ |
| N-a-N lazy | evento vacío → 1 voto → 1 fila | ✅ |

**Pendiente de prueba humana** (requiere sesión y evento activo): `/admin`
(plantillas + almacén), check-in real con cuenta Google, tele, batalla, tiers,
jukebox/tinder. Ver el [plan de pruebas](#plan-de-pruebas-tras-el-deploy).

> Contexto: el 04/08 no había evento activo (todos `ended`), así que los flujos
> de juego no se pudieron ejercitar en vivo.

## FASE 6 — Marca por local (multi-tenant real) ✅

**Problema.** "La Pocha" estaba escrito a fuego en 9 sitios: título de pestaña,
splash, panel del DJ, bienvenida, nombre de la app instalada, textos legales y
cabecera del directo. **Cualquier cliente nuevo habría visto el nombre de otra
discoteca.** Además `theme` estaba vacío en los dos locales, así que la
personalización de color existía pero nunca se había usado.

**Cambios**
- `tenant.tsx`: contrato de marca ampliado con `logoUrl`, `faviconUrl` y
  `welcomeText`. Al ser `theme` un **jsonb**, ampliarlo **no requiere migración**.
- `FALLBACK_TENANT` pasa a llamarse **NightGraph** (neutro): mientras el loader
  resuelve el tenant, ya no se viste con la marca de un cliente concreto.
- `home.tsx`: título, descripción y splash salen de `tenant.name`.
- `root.tsx`: nombre de la app instalada vía `useRouteLoaderData` (funciona
  también en pantallas de error, donde el loader puede no haber corrido).
- `admin.tsx`, `WelcomeModal`, `LiveHeader`, `legal.tsx`: sin marca fija.
- `i18n`: `live.brand` → `{{name}}`; textos sin nombre de local.

**Demostrado en producción, sin desplegar** (los colores viven en BD):

| | `lapocha.nightgraph.io` | `prueba.nightgraph.io` |
|---|---|---|
| Color principal | `#7DF9FF` cian | `#C084FC` morado |
| Fondo | `#050505` | `#0B0616` |

> Regla útil que queda clara: **marca visual (colores, logo) = BD → efecto
> inmediato**; **textos y estructura = código → requieren deploy**.

**Pendiente menor:** quedan literales en `i18n.ts` (`onboarding.brand`,
nombres de productos de ejemplo) que **no se usan** en ninguna pantalla; se
limpiarán al tocar i18n, sin prisa.
