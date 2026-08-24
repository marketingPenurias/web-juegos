# Diseño · Sistema de promociones y niveles

Especificación para implementar. Todo lo descrito es **configurable por sala**
(`tenant_id`): dos discotecas pueden tener precios, niveles, horarios y límites
completamente distintos sin tocar código.

---

## 1. Principios

1. **Los tokens compran DESCUENTO, no producto.** 450 tk = copa de 9 € a 6 €.
   Excepción configurable: `free_product` (flash drop, chupito por reseña).
2. **El nivel modula CUÁNTO cuesta y CUÁNTAS veces**, no *qué* existe.
3. **Regla de oro — nadie se queda sin promociones.** En cualquier momento de la
   noche, **todo nivel debe tener al menos una promoción activa**. Un bronce sin
   nada a las 00:00 es un fallo de configuración, no una decisión de producto.
4. **Lo que varía por nivel es el ACCESO A LO BUENO en horario premium**, no el
   acceso a todo. La copa a las 03:00 un sábado puede ser de Plata para arriba;
   el chupito y la cerveza están para todos, toda la noche.
5. **Precios sin decimales.** Si una bebida lleva RedBull, cuesta 1 € más que su
   versión normal — siempre, también en promo.

---

## 2. Catálogo (precios reales de La Pocha)

| Producto | Barra | Con app | Dto. |
|---|---|---|---|
| Agua · Chupito normal | 3 € | 2 € | 1 € |
| Refresco | 4 € | 3 € | 1 € |
| Cerveza · Vino · Sangría · RedBull | 5 € | 4 € | 1 € |
| Chupito especial | 4 € | 2 € | 2 € |
| **Copa** | **9 €** | **6 €** | **3 €** |
| Copa + RedBull | 10 € | 7 € | 3 € |
| Copa premium | 12 € | 9 € | 3 € |
| Copa premium + RB | 13 € | 10 € | 3 € |
| Botella de vino | 20 € | 14 € | 6 € |

## 3. Coste en tokens = descuento × tasa del nivel

**No se guarda un precio en tokens por producto.** Se calcula. Así un producto
existe **una sola vez** (fin de los duplicados que había en el catálogo).

| Nivel | tk / € dto. | Chupito (1 €) | Chupito esp. (2 €) | Copa (3 €) | Botella (6 €) |
|---|---|---|---|---|---|
| 🥉 Bronce | 150 | 150 | 300 | 450 | 900 |
| 🥈 Plata | 125 | 125 | 250 | 375 | 750 |
| 🥇 Oro | 100 | 100 | 200 | 300 | 600 |
| 💎 Platino | 75 | 75 | 150 | 225 | 450 |

Un platino obtiene **el doble de descuento** por el mismo esfuerzo.

## 4. Disponibilidad — todos tienen algo, siempre

Ejemplo de configuración para La Pocha (editable por la sala):

| Producto | 🥉 Bronce | 🥈 Plata | 🥇 Oro | 💎 Platino |
|---|---|---|---|---|
| Chupito, agua, refresco, cerveza | **toda la noche** | toda la noche | toda la noche | toda la noche |
| Chupito especial | mar-jue | toda la semana | toda la semana | toda la semana |
| **Copa** | mar-jue toda la noche · **vie-sáb hasta 00:00** | vie-sáb hasta 02:00 | vie-sáb hasta 04:00 | siempre |
| Copa premium / +RB | — | mar-jue | toda la semana | siempre |
| Botella / barril | — | — | bajo pedido | siempre |

**Lectura:** un bronce **nunca se queda sin promociones** (chupito, cerveza y
refresco están siempre). Lo que se gana subiendo es **la copa en hora punta**.

### Canjes por noche
🥉 1 · 🥈 2 · 🥇 3 · 💎 sin límite. *(configurable)*

## 5. Niveles: el salto debe ocurrir en la 2ª visita

Objetivo de negocio: **que alguien nuevo quiera volver una segunda vez**.

| Nivel | Umbral actual | Propuesto | Se alcanza |
|---|---|---|---|
| Plata | 500 | **300** | **2ª noche** ← el gancho |
| Oro | 1.500 | 800 | ~5 noches |
| Platino | 4.000 | 2.000 | ~12 noches |

Mensaje en la app: *"Vuelve otra noche y serás Plata: copa hasta las 02:00 y
2 canjes por noche"*.

**Aceleradores** (suman a `lifetime`, no regalan descuento): invitar +100 ·
misiones de la noche +25/50 · Flash Drops con tokens que caducan esa noche.

### Primera noche (requisito inamovible)
Bono de bienvenida 100 + check-in 50 = **150 → el primer chupito sale gratis de
tokens**. No hace falta subir el bono: **nadie entra a la app si no es por el QR**,
así que el check-in está garantizado.

---

## 6. Modelo de datos

### `tenant_products` — el QUÉ (una fila por producto)
`id`, `tenant_id`, `name`, `description`, `product_type`, `image_url`,
`list_price_eur` (9 = precio de barra), `promo_price_eur` (6 = con app),
`redemption_type` (`discount` | `free_product`), `is_active`, `sort_order`.
> El descuento es `list - promo`. **No hay precio en tokens**: se calcula.

### `tenant_tier_config` — el CUÁNTO (4 filas por sala)
`tenant_id`, `tier_code`, `min_lifetime`, `tokens_per_euro`,
`max_redemptions_per_night`, `display_name`, colores/emoji.
> Amplía la actual `tenant_tier_thresholds`; no es una tabla nueva.

### `product_availability` — el CUÁNDO (N filas por producto × nivel)
`id`, `tenant_id`, `product_id`, `tier_code` (null = todos),
`days` smallint[] (ISO dow), `hour_from`, `hour_to` (null = toda la noche),
`valid_from`, `valid_to` (campañas), `max_per_night`, `max_per_week`,
`stock_total`, `stock_used` (Flash Drops), `is_active`,
`promo_price_eur` y `tokens_per_euro` (sobrescriben producto/nivel),
`kind`, `campaign_code`, `label`.

> `hour_from > hour_to` significa que la ventana **cruza medianoche** (22 → 02
> es "hasta las dos"), que es el caso normal en una discoteca.  Y el día se
> compara contra `business_night()`, no contra el reloj: a las 02:00 del sábado
> se sigue estando en la noche del viernes.

`promo_price_eur` y `tokens_per_euro` en la regla **sobrescriben** los del
producto y del nivel.  Sin el segundo, un Flash Drop sale *más caro*: más
descuento × la misma tasa = más tokens y el mismo valor por token, o sea
ninguna oferta.  Con él, un drop es literalmente *"durante 30 minutos todos
pagáis como un Platino"*.

> **Un Flash Drop no es una feature aparte**: es una fila de disponibilidad con
> `valid_from/valid_to` cortos y `stock_total`.

### Campañas medibles
`kind` (`base` | `flash_drop` | `happy_hour` | `campaign`) y `campaign_code`
(`FD-20260821-01`) le dan identidad propia a cada activación.  El canje copia
`availability_id`, `campaign_code` y `discount_eur` a `user_rewards`, así que
la atribución sobrevive aunque después se borre la regla.

La vista `campaign_performance` responde *"¿mereció la pena?"*: canjes,
usuarios, € de descuento regalado, **tasa de consumo en barra** e ingreso real.
Sin esto se sabría que hubo canjes, pero no bajo qué oferta — y una campaña que
no se puede medir no se puede repetir ni cortar.

## 7. Qué ve el usuario

- **Disponible ahora**: precio en tokens según su nivel.
- **No disponible ahora**: *"Los bronce pueden pedirla hasta las 00:00 · sube a
  Plata para pedirla hasta las 02:00"* → conversión, no muro.
- **Nivel superior**: *"Con Plata te costaría 375 en vez de 450"* → ambición.

## 8. Qué configura la sala (panel)

Productos y precios en € · tasa tk/€ por nivel · umbrales de nivel · días,
**franja horaria**, límites y stock por producto y nivel · campañas con vigencia.

### Validación obligatoria del panel
Al guardar, comprobar la **regla de oro**: si algún nivel se queda sin ninguna
promoción activa en algún tramo de la noche, avisar:
> ⚠️ *"Los bronce no tienen ninguna promoción entre las 02:00 y las 06:00"*

## 9. Migración (sin perder datos)

1. Fusionar los 22 productos actuales en **13 únicos** (hoy están duplicados por
   nivel: "Copa Nacional 6€" y "— Oro" son la misma).
2. Rellenar `list_price_eur` con los precios reales de barra (hoy
   `reference_fiat` guarda el precio ya promocionado: 6 € en vez de 9 €).
3. Generar `product_availability` a partir del `min_tier_required` y
   `available_days` actuales.
4. `purchase_reward` pasa a calcular el coste (descuento × tasa) y a validar
   franja horaria, vigencia y stock.
5. `user_rewards` guarda el coste cobrado, el descuento y la campaña.

**Estado: aplicado el 2026-08-21** en las dos salas (`prueba` y `lapocha`).
Migraciones en `database/27..29_v21_*.sql`.  `seed_default_catalog(tenant_id)`
quedó como función reutilizable: da de alta el catálogo de una discoteca nueva
de una sola llamada.

## 10. Verificación de la regla de oro

Se barrieron los 4 niveles × 5 noches × 8 horas de apertura (160 combinaciones)
contra `matching_rules`: **0 huecos**.  El bronce nunca baja de 7 promociones
activas; lo que pierde a medianoche el fin de semana es la copa, no el menú.

| Viernes | 🥉 Bronce | 🥈 Plata | 🥇 Oro | 💎 Platino |
|---|---|---|---|---|
| 22:00 | 9 (con copa) | 10 | 13 | 14 |
| 00:00 | **7** (sin copa) | 10 | 13 | 14 |
| 02:00 | 7 | **8** (sin copa) | 13 | 14 |
| 04:00 | 7 | 8 | **11** (sin copa) | 14 |

## 11. Calibración
Los números son un **punto de partida coherente**, no la verdad. La tasa
(150 tk/€) y los umbrales se recalibran con la primera noche real de septiembre,
cuando se vea cuántos tokens gana la gente con el check-in ya arreglado.
