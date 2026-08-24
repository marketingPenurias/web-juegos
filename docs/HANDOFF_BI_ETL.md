# Traspaso · `fact_rewards` y la medición de campañas

**Para:** la parte de BI · **Estado:** abierto desde el 04/08 · **Comprobado el 24/08**

Esto bloquea dos de los seis objetivos del mes: el **informe del piloto** y
**saber si un Flash Drop funcionó**. Todo lo que hace falta ya está en la base
de datos; lo que falta es cargarlo.

---

## 1. El bug original: mide la etapa equivocada

`analytics.run_etl` carga `fact_rewards` desde `user_rewards` filtrando por
**`redeemed_at`**, que solo se rellena cuando el ticket **se consume en barra**.
Los canjes **comprados** (`status='available'`, `redeemed_at` NULL) nunca entran.

Los números de hoy en el sandbox:

| | |
|---|---|
| Canjes reales en `user_rewards` | **16** |
| Consumidos en barra | 2 |
| Filas en `analytics.fact_rewards` | **2** |

Se están perdiendo **14 de 16**. Y lo que se pierde es justo el dato
interesante: **la diferencia entre comprar y consumir**.

Son dos métricas distintas del embudo y hacen falta las dos:

1. **Comprado** — `user_rewards.created_at`. La persona gastó tokens.
2. **Consumido** — `status='consumed'` / `redeemed_at`. Llegó a la barra.

Si compra mucho y consume poco, el problema está en el ticket o en la barra.
Si no compra, el problema está en la economía o en el catálogo. Hoy no se
puede distinguir.

**Sugerencia:** cargar una fila por canje en el momento de la **compra**, y
tratar el consumo como un atributo que se actualiza después
(`consumed_at` NULL / con fecha), en vez de como condición de entrada.

---

## 2. Lo nuevo: el ETL está ciego a las campañas (V21/V22)

Desde la V21 cada promoción puede venir de una campaña con identidad propia
—un Flash Drop es `FD-20260824-01`— y el canje guarda **de cuál salió** y
**cuánto descuento se regaló**. Nada de eso llega al modelo en estrella.

Columnas que ya existen en `public.user_rewards` y no se cargan:

| Columna | Qué es |
|---|---|
| `campaign_code` | Identidad estable de la campaña (`FD-20260824-01`) |
| `availability_id` | La regla concreta que se aplicó |
| `discount_eur` | Euros de descuento regalados en ESE canje |

`analytics.fact_rewards` tiene hoy: `fact_reward_id, tenant_id, user_id,
time_id, reward_type, reward_value, tokens_redeemed, created_at`. Le faltan las
tres de arriba.

**Sin `campaign_code` en el hecho, no se puede medir una campaña.** Se puso
precisamente para eso: hoy se puede lanzar un drop en la tele y no saber
después si mereció la pena.

### Atajo mientras tanto
La vista `public.campaign_performance` ya responde la pregunta de negocio sin
tocar el ETL — canjes, usuarios únicos, € regalados, **tasa de consumo en
barra** e ingreso real por `campaign_code`. Sirve para no quedarse a ciegas,
pero es una vista sobre el operacional: **no sustituye** al modelo en estrella
ni sirve para series temporales.

---

## 3. Con qué comprobar que quedó bien

- `fact_rewards` tiene **16 filas**, no 2 (con los datos de hoy del sandbox).
- Un canje recién comprado aparece **sin esperar** a que se consuma.
- Al consumirlo en barra, esa misma fila se marca como consumida (no se
  duplica).
- Un canje de campaña llega con su `campaign_code` y su `discount_eur`.
- Los totales de `fact_rewards` cuadran con `campaign_performance` para una
  misma campaña.

---

## 4. Contexto útil

- Modelo completo de la BD: [`DB_MODEL.md`](DB_MODEL.md)
- Por qué el coste en tokens se calcula y no se guarda:
  [`DISENO_PROMOCIONES.md`](DISENO_PROMOCIONES.md)
- Migraciones de las campañas: `database/27..29_v21_*.sql`

> **Aviso de solapamiento:** el «panel de parámetros» de las semanas 2-3 del
> roadmap (productos, precios, economía y tiers) **ya está construido y
> desplegado** en `/admin` → Promos. Lo que sigue siendo solo suyo: este ETL,
> el informe del piloto, sacar la consola del bundle del cliente, y del panel
> quedan juegos activos, QRs y marca.
