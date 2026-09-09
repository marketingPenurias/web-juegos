# Los votos: qué se guarda, qué se enseña y qué pasa cuando Javi pincha

Investigado y resuelto el **8 de septiembre de 2026**, a partir de lo que pidió
Lucía: guardar los totales para métricas, pero que el contador del ranking
vuelva a cero cuando Javi pone la canción.

**Hecho.** Migración `48_v23_reset_votes_on_play.sql`, aplicada y con 10
comprobaciones nuevas en el banco de pruebas.

---

## El problema que había

Había **dos cosas distintas** viviendo en la misma columna:

| | Dónde vive | Para qué sirve |
| :-- | :-- | :-- |
| El **registro** de cada voto | `track_votes`, una fila por persona y canción | Métricas |
| El **contador** del ranking | `event_tracks.total_votes` | Ordenar la lista de la TV |

`admin_set_now_playing` marcaba la canción como sonada pero no tocaba el
contador. Y como al pinchar la siguiente la anterior vuelve a
`is_played=false`, la canción regresaba al saco con todos sus votos y se
plantaba arriba del ranking.

Existía un parche: `tv_ranking` la escondía dos horas. Solo la escondía.

Los números de la última noche (`SABADO 05/09`): el ranking visible tenía **48
canciones**, y **33 ya habían sonado sin que nadie las volviera a votar**.
Estaban ahí porque habían pasado dos horas. Solo 2 recibieron un voto de verdad
después de sonar. En `Sábado 01/08`, 116 de 119 temas sonados seguían en el
saco con sus votos puestos.

Dos de cada tres canciones del ranking eran fantasmas.

## La solución

Separar las dos cosas. El contador se resetea al pinchar; el registro no se
toca nunca.

Lo bueno es que **no hace falta romper el `UNIQUE (track_id, user_id)`**. Ese
único sigue garantizando «un voto por persona y canción», que es justo lo que
hace que las métricas cuenten bien. Y una canción ya sonada **puede volver a
subir** si la vota gente que todavía no la había votado — que es exactamente la
señal que queremos: demanda nueva, no el eco de hace tres horas.

Tres cambios que van juntos. Por separado rompen cosas:

1. **`admin_set_now_playing`** pone `total_votes = 0` y `last_vote_at = null`
   al tema que empieza a sonar. El sello de desempate también, porque si no
   reaparecería con ventaja al subir de nuevo desde cero.

2. **`get_admin_metrics`** deja de sumar `event_tracks.total_votes` y cuenta
   desde `track_votes`, ponderando el boost ×5 para que el número siga
   significando lo mismo. **Esto era obligatorio**: sin ello, el contador de
   «votos totales» del panel de Javi se habría desangrado según avanzase la
   noche. Un dato válido, sin error, y equivocado — el mismo patrón que nos
   costó la noche del 3 de septiembre con el ranking de los flash drops.

   Comprobado antes de tocarlo: en las 10 fiestas con votos, las dos formas de
   calcularlo daban idéntico (517=517, 399=399, …). El cambio no altera ni un
   número de hoy.

3. **`tv_ranking`** y su copia en `Jumbotron.tsx` pierden la ventana de las 2h.
   Existía para tapar este agujero; con el contador a cero, el filtro
   `total_votes > 0` la deja fuera él solo. De paso nos quitamos una regla
   duplicada entre la base de datos y el cliente.

## El guardia de las batallas

`admin_force_close_battle` y `resolve_due_battles` deciden el ganador
comparando el `total_votes` de las dos pistas. Poner una a cero en mitad de un
duelo la habría hecho **perder sola**.

Así que si el tema está en una batalla `live`, se pincha igual pero el contador
se respeta hasta que el duelo cierre. La RPC lo dice en la respuesta
(`votes_reset: false`) y queda en `audit_logs`.

## Lo que NO se toca

- **`track_votes`**, nunca. Todo lo votado desde el primer día sigue ahí.
- **Las métricas del dashboard.** El ETL (`008_analytics_etl.sql`) llena
  `fact_track_votes` desde `track_votes` fila a fila; de `event_tracks` solo
  saca título, artista y género. El contador no le llega.
- **Los datos históricos.** La migración no hace backfill: los contadores de
  las fiestas pasadas se quedan como están. Cada noche abre su propia fiesta,
  así que a partir de ahora salen limpias solas.

## Lo que queda apuntado

`track_votes` tiene **tres** restricciones únicas y dos son idénticas:

```
track_votes_event_id_track_id_user_id_key   UNIQUE (event_id, track_id, user_id)
track_votes_event_track_user_unique         UNIQUE (event_id, track_id, user_id)
track_votes_unique_user_track               UNIQUE (track_id, user_id)
```

Se paga el mantenimiento de un índice repetido en cada voto. No es urgente,
pero si se entra a tocar esta tabla, se quita una.

## Cómo se comprobó

10 casos en `database/qa/smoke.sql`, bloque «Reset de votos», ejecutados contra
la sala `prueba` y deshaciendo todo al terminar. La tanda completa son 37
comprobaciones y salieron las 37 en verde.

Se cubren las dos mitades — que el contador baje y que el registro sobreviva —
porque es fácil arreglar una y romper la otra sin enterarse. Y el caso de la
batalla, que es el único sitio donde el reset haría daño.
