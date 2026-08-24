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
| Retirada de las columnas obsoletas | ⏸ tras desplegar |

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

### 4. Niveles 🧪
- [ ] La cinta del Hub pinta los niveles **de la sala** (no los cableados).
- [ ] El progreso al siguiente nivel usa los umbrales reales (Plata = 300).
- [ ] El badge del perfil coincide con el nivel que dice el servidor.

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
- **Configuración con efecto real**: barra 9→10 € sube la copa de 450 a 600 tk;
  tasa bronce 150→100 la baja a 400 tk; ampliar la ventana de 22→00 a 22→06
  hace que un bronce sí pueda pedir copa a las 03:00 del sábado.

---

## Riesgos abiertos

- **`price_tokens` es un puente**: la app desplegada aún lo pinta, así que se
  rellenó con el coste de bronce. El cobro real ya no lo usa. Se elimina —
  junto a `min_tier_required` y `available_days` — cuando esta versión esté
  arriba.
- **La Pocha ya tiene el catálogo nuevo** aunque el frontend viejo siga en
  producción. Es seguro porque `purchase_reward` valida con el modelo nuevo,
  pero conviene no dejar la ventana abierta más de lo necesario.
