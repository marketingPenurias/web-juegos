# V21 · Bitácora — Motor de promociones

Qué se ha cambiado y **qué hay que probar** antes de dar la versión por buena.
Se actualiza a medida que avanza la implementación.

> Convención: ✅ verificado por mí contra la base de datos · 🧪 **necesita a un
> humano con sesión iniciada** (login Google, móvil real, panel del DJ).

---

## Estado

| Bloque | Estado |
|---|---|
| Esquema (3 tablas, tasa por nivel, campañas) | ✅ aplicado en `prueba` y `lapocha` |
| Catálogo fusionado (22 → 13 productos reales) | ✅ aplicado en las dos salas |
| Motor (`get_promo_catalog`, `purchase_reward`) | ✅ probado |
| Flash Drops + medición de campañas | ✅ probado |
| App: menú, sesión, niveles | ✅ compila · 🧪 falta verlo |
| Consola de Flash Drops (`/admin` → Promos) | ✅ ciclo probado en BD · 🧪 falta usarla |
| Panel de configuración (`/admin` → Promos) | ✅ efecto probado en BD · 🧪 falta usarlo |
| Aviso de la regla de oro al guardar | ✅ probado (detecta y no falsea) |
| Mensaje de ambición en el Hub | ✅ cifras verificadas · 🧪 falta verlo |
| Retirada de las columnas obsoletas | ⏸ **bloqueada** hasta el humo con sesión (ver Riesgos) |
| ETL de BI al día con las campañas | ❌ pendiente — `run_etl` no conoce `campaign_code` |

---

## Plan de pruebas

### 1. Menú de promociones (móvil, usuario real) 🧪
- [ ] Se ven **dos precios**: el de barra tachado y el que pagará (9€ → 6€).
- [ ] El coste en tokens corresponde a su nivel (bronce: 1 € de descuento = 150 tk).
- [ ] Un bronce ve *"Con Plata te costaría 375"* en los productos donde mejora.
- [ ] **Regla de oro**: a cualquier hora hay algo canjeable. Ni una pantalla vacía.
- [ ] Lo no disponible explica **por qué**: *"Hoy de 22:00 a 00:00"* / *"Desde Plata"*.
- [ ] La cabecera dice cuántos canjes le quedan esta noche.

### 2. Compra y ticket 🧪
- [ ] Canjear descuenta los tokens correctos y abre la pantalla del camarero.
- [ ] El ticket muestra **lo que hay que cobrar en barra**, sin decimales.
- [ ] Sin saldo: mensaje claro, no error genérico.
- [ ] Segundo canje siendo bronce → *"Ya has usado tu canje de esta noche"*.
- [ ] Tras canjear, el menú se recarga (puede haberse agotado un drop).

### 3. Flash Drops (`/admin` → Promos) 🧪
- [ ] Lanzar un drop: aparece con cuenta atrás y stock.
- [ ] En el móvil sale **el primero**, en fucsia y con su etiqueta.
- [ ] El precio en tokens baja de verdad respecto a la promo normal.
- [ ] Agotar el stock → *"Promoción agotada"*, no "no disponible".
- [ ] Cortarlo: desaparece del móvil y el precio vuelve al normal.
- [ ] El código (`FD-…`) se ve en el panel y queda en el histórico.

### 4. Niveles y gancho de retención 🧪
- [ ] La cinta del Hub pinta los niveles **de la sala** (no los cableados).
- [ ] El progreso al siguiente nivel usa los umbrales reales (Plata = 300).
- [ ] El badge del perfil coincide con el nivel que dice el servidor.
- [ ] Un bronce nuevo lee *"Te faltan 50 puntos para Plata · todo un 17% más
      barato · 2 canjes por noche"*.
- [ ] Un platino lee *"Estás en el nivel máximo"*, no un mensaje roto.

### 5. Configuración por sala (`/admin` → Promos) 🧪
- [ ] **Carta**: cambiar 9 → 10 € en una copa sube su coste en tokens en el móvil.
- [ ] Guardar un precio con la app **mayor** que el de barra → lo rechaza.
- [ ] **Niveles**: bajar la tasa de bronce abarata todo para ese nivel; la
      columna «Copa» de la tabla anticipa el efecto antes de guardar.
- [ ] Cambiar el umbral de Plata mueve a quién es Plata (y la cinta del Hub).
- [ ] **Ventanas**: desplegar un producto, editar la franja de un nivel y ver
      que cambia cuándo aparece. Días vacíos = todos; horas vacías = toda la noche.
- [ ] Una ventana `22 → 02` debe entenderse como "hasta las dos", no como vacía.
- [ ] **Aviso rojo**: desactivar las promos "para todos" debe disparar
      *"Bronce: viernes, sábado · de 00:00 a 06:00"* al guardar.
- [ ] Añadir y borrar una ventana desde el panel.

### 6. Regresión (que no se haya roto nada) 🧪
- [ ] Check-in con QR sigue sumando tokens.
- [ ] Jukebox, batalla y ruleta intactos.
- [ ] La TV sigue pintando ranking y batalla.

---

## Verificado ya (no hace falta repetirlo)

- **Regla de oro**, barrido de 4 niveles × 5 noches × 8 horas = **0 huecos**.
  Bronce nunca baja de 7 promociones; a las 00:00 del viernes pierde la copa.
- **7 rechazos de compra**: saldo, límite de nivel, fuera de franja, stock
  agotado, y compra correcta dentro de campaña.
- **Ciclo del drop**: `not_now`/450 tk → drop → `available`/375 tk pagando 4 € →
  cortado → `not_now`/450 tk, con la campaña conservada.
- Typecheck, build y 62 claves i18n.
- **Validador de cobertura** en los dos sentidos: con la configuración buena
  da 0 huecos, y al desactivar las promos abiertas detecta 12 y señala
  *"Bronce el día 5 a las 0:00"* — justo el caso que no queremos.
- **Mensaje de ambición** con los números reales de la sala: Bronce→Plata 17 %
  más barato y 2 canjes; Plata→Oro 20 % y 3; Oro→Platino 25 % y sin límite.
- **Configuración con efecto real**: barra 9→10 € sube la copa de 450 a 600 tk;
  tasa bronce 150→100 la baja a 400 tk; ampliar la ventana de 22→00 a 22→06
  hace que un bronce sí pueda pedir copa a las 03:00 del sábado.

---

## Verificado en producción (2026-08-21, tras el despliegue)

Sin sesión iniciada no se puede entrar al menú, la TV ni `/admin`, así que se
comprobó todo lo que no la necesita:

- **El build desplegado es el de V21**, no el anterior. En el bundle del cliente
  están `cheaperAtNextTier`, `redemptionsLeft`, `unlock_hint`, `cost_tokens`,
  `promo_price_eur`, `tierNext`, `perkCheaper`, `list_price_eur`… y **han
  desaparecido** `min_tier_required`, `available_days`, `price_tokens`,
  `tierFromLifetime` y `productVisibility`.
- **Contrato cliente ↔ servidor idéntico**: las 9 claves de la raíz y las 15 de
  producto que emite `get_promo_catalog` coinciden exactamente con los tipos de
  `useCatalog.ts`. Ni falta ni sobra ninguna — era el fallo de integración más
  probable y queda descartado.
- `/api/catalog`, `/api/session` y `/api/rewards` responden **401** sin token.
- Las dos salas quedan coherentes: 13 productos, 0 sin precio de barra,
  37 reglas, **0 huecos** de cobertura, misma escalera de niveles.
- La app carga sin errores de consola.

---

## Riesgos abiertos

- **No se han borrado las columnas obsoletas todavía, a propósito.** Nadie en
  la base de datos las lee (`min_tier_required`, `available_days`,
  `max_per_month`, y los `max_per_*` de `tenant_products`) y el bundle del
  cliente tampoco. Pero `/api/catalog` corre en el *worker*, y no puedo
  comprobar sin sesión que el worker desplegado sea el nuevo. Si fuera el
  viejo, seguiría haciendo `select … min_tier_required …` y borrarlas tumbaría
  el menú en producción. Cuestan cero mantenerlas una hora más: **primero el
  humo con sesión, después el borrado**.
- **`price_tokens` y `reference_fiat` NO se borran**: las siguen usando
  `purchase_reward` y `get_promo_catalog` para los productos de canje directo
  (Reserva Prioritaria, Pack Leyenda) y `analytics.run_etl`.
- **El ETL de BI está ciego a las campañas.** `analytics.run_etl` sigue
  filtrando por `redeemed_at` —o sea, solo cuenta lo consumido en barra, no lo
  comprado— y no conoce `discount_eur` ni `campaign_code`. Mientras siga así,
  el panel de tu compañera no podrá medir un Flash Drop aunque los datos ya
  estén ahí.
