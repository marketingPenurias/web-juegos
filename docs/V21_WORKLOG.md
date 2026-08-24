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
| App: menú, sesión, niveles | ✅ **probado en producción con sesión real** |
| Consola de Flash Drops (`/admin` → Promos) | ✅ drop lanzado y visto en el móvil |
| Panel de configuración (`/admin` → Promos) | ✅ probado en vivo |
| Aviso de la regla de oro al guardar | ✅ probado (detecta y no falsea) |
| Mensaje de ambición en el Hub | ✅ visto en pantalla |
| Retirada de las columnas obsoletas | ✅ hecho (migración 32) |
| Nombre de usuario elegible | ✅ probado en BD · 🧪 falta verlo desplegado |
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

### 6. Nombre de usuario 🧪
- [ ] Un perfil sin nombre ve el aviso ámbar en el Hub y llega al perfil.
- [ ] Elegir un nombre lo cambia en el Hub, el perfil y el ranking.
- [ ] Un nombre ya cogido en la sala → *"Ese nombre ya está cogido"*.
- [ ] Menos de 3 caracteres, más de 20, o con símbolos raros → rechazado con el
      motivo concreto.
- [ ] Un usuario **nuevo** entra ya con su nombre de pila puesto.
- [ ] Dos cuentas con el mismo nombre de pila → la segunda queda «Nombre 2»,
      y **el alta no falla**.

### 7. Regresión (que no se haya roto nada) 🧪
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

## Prueba de humo con sesión real (2026-08-24, sala `prueba`)

Conducida con el Chrome del usuario, ya autenticado. Todo lo marcado 🧪 en las
secciones 1-5 queda cubierto salvo donde se indica.

### Fallo grave encontrado y corregido: una cuenta no podía estar en dos salas
`/api/session` devolvía **500 `profile_create_failed`** y `/api/catalog` **404**,
así que la app caía a los valores por defecto del store: saldo mock 450,
histórico 0, sin escalera de niveles, y el pie de la cinta diciendo *"Estás en
el nivel máximo"* a un usuario Bronce.

Causa: `user_profiles` tenía **dos índices únicos contradictorios** —
`(tenant_id, auth_user_id)`, correcto, y `(auth_user_id)` a secas, que limita
cada cuenta a UNA discoteca. Quien ya tenía perfil en La Pocha no podía
registrarse en otra sala. `api.auth-sync` intentaba recuperarse del 23505
releyendo el perfil **acotado por sala**, así que con una colisión de otra sala
tampoco lo encontraba; el síntoma se había atribuido a una carrera de React
StrictMode. Corregido en `database/30_v21_fix_cross_tenant_profile.sql`.
Verificado: la misma cuenta existe ya en `prueba` y `lapocha` a la vez.

### Lo que se vio funcionando
- **Menú**: dos precios (`~~3€~~ 2€`), coste en tokens por nivel, *"Con plata te
  costaría 125 tokens"*, y la cabecera *"Te queda 1 canje esta noche"* en
  singular.
- **Compra real**: chupito por 150 tk, saldo 250 → 100, descuento 1 € y regla
  atribuida en `user_rewards`. El **ticket del camarero mostró "COBRAR AL
  CLIENTE 2 €"** — el precio promocional, sin decimales.
- **Límite de noche**: el segundo canje devolvió **429 · `night_limit_reached` ·
  "Ya has usado tu canje de esta noche"**, confirmando el mapeo por SQLSTATE.
- **Flash Drop**: lanzado desde `/admin` (`FD-20260824-01`, copa a 4 €, 20
  unidades). El panel previsualizó *"Regalas 5€ por copa y les cuesta 375
  tokens"*. En el móvil apareció **el primero**, en fucsia, con etiqueta y sin
  la línea de "con Plata" (durante la campaña la tasa ya es la mejor).
- **Configuración**: la escalera con la columna «Copa» (450/375/300/225) y la
  carta con sus precios; aviso verde de cobertura correcto.
- **Cinta del Hub**: *"Te faltan 200 puntos para Plata · todo un 17% más barato ·
  2 canjes por noche"*.

### Tres defectos menores corregidos (pendientes de redesplegar)
1. **La configuración de promociones era inalcanzable sin fiesta activa**: todo
   el panel colgaba del `else` de "¿hay evento?". La carta se prepara un martes
   por la tarde, no a las tres de la mañana. Ahora se muestra también sin fiesta;
   los Flash Drops siguen dentro de la sesión, que es donde tienen sentido.
2. **Con 0 canjes restantes los botones seguían activos**, así que el usuario
   chocaba contra un 429 en vez de saberlo antes. Ahora se deshabilitan.
3. **La cuenta atrás marcaba "31 min" en un drop de 30** (redondeo hacia
   arriba). Ahora redondea hacia abajo sin bajar de 1 mientras siga vivo.

### Sin cubrir todavía
- Agotar el stock de un drop (haría falta otra cuenta con saldo).
- Regresión de jukebox, batalla, ruleta y TV.

---

## Riesgos abiertos

- **Sin moderación de nombres.** El nombre elegido se pinta en la TV del local.
  La validación impide URLs, emojis y textos largos, pero **nada impide un
  insulto**. La sala no tiene hoy forma de corregir un nombre. Antes de un
  sábado con gente conviene decidirlo: lo más barato es un botón en `/admin`
  para vaciar el nombre de alguien (vuelve a "Jefe #N").
- **`price_tokens` y `reference_fiat` NO se borran**: las siguen usando
  `purchase_reward` y `get_promo_catalog` para los productos de canje directo
  (Reserva Prioritaria, Pack Leyenda) y `analytics.run_etl`.
- **El ETL de BI está ciego a las campañas.** `analytics.run_etl` sigue
  filtrando por `redeemed_at` —o sea, solo cuenta lo consumido en barra, no lo
  comprado— y no conoce `discount_eur` ni `campaign_code`. Mientras siga así,
  el panel de tu compañera no podrá medir un Flash Drop aunque los datos ya
  estén ahí.
