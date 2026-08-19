# Roadmap · Agosto 2026

La Pocha cierra en agosto → **cero datos nuevos**. Por eso todo el mes se trabaja
contra el **sandbox** (`prueba`), no contra producción.

- Reapertura prevista: **septiembre**.
- Semanas: **S1** 4-10 · **S2** 11-17 · **S3** 18-24 · **S4** 25-31.
- Estado del producto: `V20` desplegado (ver [`V20_WORKLOG.md`](V20_WORKLOG.md)).

---

## Tarea 0 — Sandbox `prueba` ✅ HECHA (04/08)

Montado como **plantilla de alta de cliente** (sirve de ensayo para el 2º local):
marca y features clonadas · 759 canciones con género · 23 productos · 4 tiers ·
17 reglas de economía · 3 QRs · staff (los mismos admins) · 3 eventos
(2 pasados + 1 abierto) · 40 usuarios sintéticos con historia.

**Resultados que ya valida el sandbox:**

| Comprobación | Producción (La Pocha) | Sandbox |
|---|---|---|
| Saldo mediano | 100 | **200** |
| Usuarios que pueden canjear | 3 de 360 (0,8 %) | **33 de 40 (82 %)** |
| Filas por evento (modelo N-a-N) | 759 clonadas | **99 creadas lazy (−87 %)** |
| `fact_visits` en el BI | 1 | **74** |

> Conclusión: **el bug del check-in era lo que mataba la economía**. Con
> check-ins funcionando, la mediana dobla y el 82 % alcanza el primer canje.

### 🔴 BLOQUEANTE — DNS (para Álvaro, 5 min)
`prueba.nightgraph.io` **no resuelve**: no hay wildcard, cada subdominio se da de
alta a mano. Hay que crear en Cloudflare **`*.nightgraph.io`** (DNS + ruta del
Worker). Sin esto el sandbox no se puede usar desde el navegador y **cada cliente
nuevo seguirá necesitando trabajo manual** — justo la fricción que impide escalar.

---

## 👤 PLAN A — Álvaro (producto, app, economía)

| Semana | Tarea | Hecho cuando |
|---|---|---|
| S1 | **Wildcard DNS** `*.nightgraph.io` | `prueba.nightgraph.io` carga la app |
| S1 | **Validar V20 entero** en el sandbox | Las 7 secciones del plan de pruebas en ✅ |
| S1 | **Recalibrar la economía** | Un usuario nuevo puede canjear algo **en su 1ª noche** |
| S2 | **Prueba social en TV + check-in educativo** | La TV anuncia canjes en vivo; el pop-up dice "ya te da para X" |
| S2 | **Separabilidad multi-tenant** | Cero `lapocha` hardcodeado; regla escrita |
| S3 | **Flash Drops** (admin + TV + app) | El DJ lanza un drop y se canjea desde el móvil |
| S4 | **Loop de invitación** | Un usuario invita, el invitado se registra, ambos cobran |
| S4 | **Ensayo general** | Simulacro de noche completa sin bugs |

## 👥 PLAN B — Compi (BI + consola NightGraph)

| Semana | Tarea | Hecho cuando |
|---|---|---|
| S1 | Leer [`docs/DB_MODEL.md`](DB_MODEL.md) + definir KPIs | 5-6 KPIs con su fórmula SQL |
| S1 | **Arreglar `fact_rewards` en el ETL** (ver bug abajo) | Los canjes comprados aparecen en el BI |
| S1 | Informe del piloto con datos reales | Documento con lo que pasó en julio |
| S2 | Mergear `feat/analytics-integration` y **sacarlo del bundle público** | `/dashboard` con su entrada y auth propias |
| S2-S4 | **PANEL DE PARÁMETROS** (entregable grande) | Se configura un local **sin una línea de SQL** |
| ↳ S2 | Productos y precios · Economía | Cambiar el precio de un chupito desde la web |
| ↳ S3 | Tiers · Juegos activos | Activar/desactivar la ruleta desde la consola |
| ↳ S4 | QRs · Marca · **roles previstos** | Modelo `owner` vs `nightgraph_admin` contemplado |

### 🐛 Bug encontrado el 04/08 — `fact_rewards` mide la etapa equivocada
El ETL carga `fact_rewards` desde `user_rewards` usando **`redeemed_at`**, que
sólo se rellena cuando el ticket se consume en barra. Los canjes **comprados**
(`status='available'`, `redeemed_at` NULL) **nunca entran**: 12 canjes reales en
el sandbox → 0 filas nuevas.

Hay que separar dos métricas distintas del embudo:
1. **Comprado** — `user_rewards.created_at` (el usuario gastó tokens).
2. **Consumido** — `status='consumed'` / `redeemed_at` (llegó a la barra).

La diferencia entre ambas **es exactamente el dato que falta** para saber si la
gente compra y no canjea, o directamente no compra.

---

## 🔄 Sincronización
- **Día 1:** Álvaro → compi: `DB_MODEL.md` + sandbox listo.
- **Lunes, 15 min:** qué parámetros cambian y qué rompería a quién.
- **Fin S1:** economía recalibrada → son los valores que el panel debe editar.
- **Fin S2:** panel de productos/economía → se acaba el SQL a mano.
- **Fin S4:** ensayo conjunto (ella configura un local, él juega una noche).

⚠️ **Todos los experimentos en `prueba`.** La Pocha sólo para arreglos reales.

## 🚫 Fuera de agosto
Landings · onboarding self-service · zonas físicas de QR · modularizar `admin.tsx`.

## ✅ Éxito del mes (las 6)
1. V20 validado sin bugs conocidos.
2. Un usuario nuevo puede canjear en su primera noche.
3. Flash Drops operativo de punta a punta.
4. Se configura un local sin tocar SQL.
5. La consola ya no viaja dentro del producto del cliente.
6. Informe del piloto con KPIs.
