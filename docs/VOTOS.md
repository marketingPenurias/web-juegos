# Los votos: qué se guarda, qué se enseña y qué pasa cuando Javi pincha

Investigado el **8 de septiembre de 2026**, a raíz de lo que pidió Lucía:
guardar los totales para métricas, pero que el contador del ranking vuelva a
cero cuando Javi pone la canción.

**No se ha tocado nada.** Esto es el mapa del terreno, para cuando decidamos
entrar.

---

## Lo que hay hoy

Hay **dos cosas distintas** que ahora mismo son la misma columna:

| | Dónde vive | Para qué sirve |
| :-- | :-- | :-- |
| El **registro** de cada voto | `track_votes`, una fila por persona y canción | Métricas |
| El **contador** del ranking | `event_tracks.total_votes` | Ordenar la lista de la TV |

`total_votes` es un acumulado que solo sube. Nadie lo baja nunca: lo comprobé
en el cuerpo de `admin_set_now_playing`, que marca `is_played` y sella
`played_at`, y no toca el contador.

## El problema, con números

Cuando Javi pone una canción se apaga `is_played` de la anterior, así que esa
vuelve al saco. La regla de visibilidad (`tv_ranking`, replicada en
`Jumbotron.tsx`) la deja fuera de la tele **solo dos horas**. Pasadas esas dos
horas reaparece — con todos sus votos intactos, y por tanto arriba del todo.

En la última noche (`SABADO 05/09`), el ranking visible tenía **48 canciones**:

- **33 ya habían sonado y nadie las había vuelto a votar.** Están ahí porque
  pasaron dos horas, nada más.
- Solo **2** habían recibido un voto de verdad después de sonar.

Es decir: **dos de cada tres canciones del ranking son fantasmas.** La lista
que ve la gente en la pantalla no es lo que se quiere ahora, es lo que se quiso
hace tres horas.

No es de esa noche suelta. En `Sábado 01/08` sonaron 119 temas y **116** están
de vuelta en el saco con sus votos puestos.

## Por qué el cero no es un `update` de una línea

Poner `total_votes = 0` al pinchar suena a media hora de trabajo. No lo es, por
una razón concreta:

```
UNIQUE (track_id, user_id)   -- track_votes_unique_user_track
```

Un voto por persona y canción, para siempre. `vote_track` lo comprueba además a
mano y devuelve `already_voted`.

Así que si reseteas el contador a cero, **las mismas personas que la votaron no
pueden volver a votarla**. La canción se queda en cero, y como el ranking filtra
`total_votes > 0`, desaparece de la tele para el resto de la noche.

Eso puede ser justo lo que queremos («ya ha sonado, siguiente») o justo lo que
no («la peña la quiere otra vez a las 4»). Es una decisión de producto, no
técnica, y hay que tomarla antes de escribir nada:

- **A · Suena una vez y punto.** Reset a cero y se acabó. Lo más simple, y hace
  que el ranking sea de verdad «lo que se quiere ahora».
- **B · Puede volver, pero desde cero.** El contador se resetea y además se
  permite votar otra vez. Exige romper el `UNIQUE` y meter algo tipo «ronda» o
  «vale el voto si es posterior a `played_at`». Es donde está el trabajo real.

## Lo que se rompe si se resetea sin mirar

Una sola cosa, pero hay que arreglarla en el mismo movimiento:

`get_admin_metrics` calcula los votos totales así:

```sql
select coalesce(sum(total_votes),0) from event_tracks where event_id = …
```

Suma **el contador del ranking**, no los votos. Si el contador se resetea, el
número de «votos totales» del panel de Javi se desploma según avanza la noche.
Sería el mismo tipo de fallo que ya nos comimos con el ranking de los flash
drops: un dato válido, sin error, y equivocado.

El arreglo es cambiarlo por un recuento sobre `track_votes`, que es donde están
los votos de verdad. Ojo al detalle: un *boost* suma **5** al contador y **1**
fila, así que para no cambiar el significado del número habría que contar
`sum(case when vote_type='boost' then 5 else 1 end)`.

## Lo que NO se rompe

Comprobado, para que nadie se preocupe de más:

- **Las métricas del dashboard están a salvo.** El ETL
  (`008_analytics_etl.sql`) llena `fact_track_votes` desde `track_votes` fila a
  fila, y de `event_tracks` solo saca título, artista y género. El contador no
  aparece por ningún lado.
- **El histórico no se pierde.** `track_votes` no se toca en ninguna de las dos
  opciones. Todo lo votado desde el primer día sigue ahí.
- **`active_players`** ya cuenta usuarios distintos de `track_votes`. Bien.

## De paso: dos índices que sobran

`track_votes` tiene **tres** restricciones únicas y dos son idénticas:

```
track_votes_event_id_track_id_user_id_key   UNIQUE (event_id, track_id, user_id)
track_votes_event_track_user_unique         UNIQUE (event_id, track_id, user_id)
track_votes_unique_user_track               UNIQUE (track_id, user_id)
```

Las dos primeras son la misma. Se paga el mantenimiento de un índice repetido en
cada voto. No es urgente, pero si se entra a tocar esta tabla, se quita.

---

## Si algún día esto es crítico, el orden es

1. Decidir **A o B**. Sin eso no se puede escribir código.
2. Cambiar `get_admin_metrics` para que cuente desde `track_votes`. **Esto
   primero**, y se puede hacer ya: hoy también es lo correcto.
3. Resetear el contador dentro de `admin_set_now_playing`, en la misma
   transacción que marca la canción como sonada.
4. Si es la B: quitar el `UNIQUE (track_id, user_id)`, meter el concepto de
   ronda y ajustar el `already_voted` de `vote_track`.
5. Quitar la ventana de 2h de `tv_ranking` y de `Jumbotron.tsx` — con el reset
   ya no hace falta, y son **dos** sitios con la misma regla copiada.

El punto 5 tiene su gracia: la regla de las 2h existe precisamente para tapar
este problema. Con el contador a cero sobra, y nos quitamos de encima una lógica
duplicada entre la base de datos y el cliente.
