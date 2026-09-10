# Pedir canciones · en reposo

Estado a **9 de septiembre de 2026**. La funcionalidad está **construida y
aplicada en la base de datos, pero desconectada de la interfaz**, a la espera
de decidir cómo hacerla bien. Este documento existe para que no se pierda lo
aprendido.

---

## Qué se quería

Que si alguien busca una canción y no está, **pueda pedirla pagando fichas**, y
al DJ le salga que hay gente que la quiere. Las fichas no son un peaje: son el
filtro que separa «me apetece» de «lo quiero de verdad», y de paso convierten
una petición en una señal con valor.

## Por qué se para

Tres cosas sin decidir. Sin ellas, la lista de peticiones es inmanejable:

1. **Contra qué catálogo se resuelve.** Si es texto libre, lo que llega al DJ
   es una cadena que alguien tecleó a las tres de la mañana. Para que sea
   accionable hace falta un buscador real (Spotify) donde la persona elija una
   canción que existe, y al DJ le llegue con id, carátula y género.
2. **Qué pasa si el DJ no la pone.** Si se han pagado fichas, hay que decidir
   si se devuelven, cuándo, y quién lo decide.
3. **Quién puede pedir.** ¿Todo el mundo? ¿A partir de qué nivel? Sin un
   límite que dependa de algo, el que más insiste gana.

## El intento que se descartó, y por qué

Se llegó a implementar «añadir de un toque»: el DJ acepta la petición y la
canción entra en el almacén y en la fiesta. **No sirve**, y conviene dejar
escrito el motivo para no repetirlo:

- Inventa un `spotify_id` (`pedido:<hash>`) para poder insertar la fila.
- Entra **sin género y sin carátula**. Sin foto en la app y en la tele, fuera
  del filtro por género, y engordando el problema de los «16 temas sin género»
  que ya está en rojo en `QA.md`.
- El id es falso: si mañana esa canción se importa de verdad desde Spotify,
  **entra duplicada**, porque el dedupe va por `spotify_id`.

«De un toque» sólo es posible si la petición ya trae los datos buenos — es
decir, si se resolvió contra un catálogo real en el momento de pedirla.

## Lo que queda montado (y no molesta)

Aplicado en producción, sin interfaz que lo llame:

- Tabla `track_requests` y `normalize_request_key()`.
- `request_new_track` · `get_track_requests` · `admin_accept_request` ·
  `admin_dismiss_request` (ver `DB_MODEL.md` §6.4.b).
- Endpoint `POST /api/requests` (autenticado, tope de 3 por persona y noche).
- Componentes `TrackRequestsPanel.tsx` y `lib/useTrackRequests.ts`, sin usar.
- Migraciones `49_v23_track_requests.sql` y `50_v23_requests_are_new_songs.sql`.

Para reactivarlo hay que volver a colgar el panel en `admin.tsx` y el
formulario en `Jukebox.tsx`. La cobertura sigue en el banco de pruebas.

---

## Lo que se aprendió por el camino (esto sí importa)

### El Jukebox no respeta la selección del DJ

**Comprobado en el desplegado el 9 de septiembre.** Se quitó
«...Baby One More Time» de la fiesta desde el panel (el panel confirmó
«Canción quitada» y desapareció de la lista de pista). Acto seguido, en el
Jukebox:

- la canción **seguía apareciendo** en la búsqueda;
- se pulsó PEDIR y **la aceptó**, gastando un voto;
- el servidor creó la fila del evento al vuelo.

El Jukebox se sirve de `event_catalog`, que desde V20 devuelve el **repertorio
del local** en vez de las canciones de la fiesta. El comentario del código lo
explica: se cambió porque con creación perezosa un evento nuevo estaría vacío y
el Tinder se quedaba sin cartas.

**Por qué importa:** si cualquiera puede sacar del almacén lo que el DJ decidió
no poner esta noche, las plantillas dejan de significar nada. La fiesta debería
ser lo que el DJ eligió.

**Arreglado el mismo día**, migración `51_v23_event_is_the_dj_selection.sql`.
Leído el cuerpo: era un `LEFT JOIN` partiendo de `global_tracks`, sin ninguna
condición — devolvía el almacén entero siempre. La regla nueva: *si el DJ ha
cargado canciones se ven solo esas; si no ha cargado nada, se ve el almacén*.

La trampa que casi la lía: «tiene canciones» no puede ser «hay filas en
`event_tracks`», porque `ensure_event_track` crea una fila **en cada voto**.
Una fiesta vacía donde alguien vota se habría quedado con esa única canción.
De ahí `event_tracks.added_by` (`dj` | `vote`).

**Caso raro conocido, sin arreglar:** si alguien vota en una fiesta vacía y
DESPUÉS el DJ carga su lista, ese tema tiene votos pero ya no está en el
catálogo — sale en el ranking de la tele y no se puede votar. La ventana es
estrecha (votos anteriores a que el DJ prepare) y se ha preferido no repetir la
regla en `tv_ranking`, que sería un tercer sitio donde mantenerla.

**Y esto reabre lo de las peticiones:** ahora que la fiesta es de verdad la
lista del DJ, el hueco de «no está mi canción» es mucho más grande, y pedir
cobra bastante más sentido del que tenía.

### El aviso del Jukebox está para cerrar, no para abrir

El aviso bajo el buscador existe para que quien no encuentre su canción **no se
vuelva loco ni le dé la brasa al DJ**. Se escribió mal dos veces:

1. «Solo puedes pedir las canciones que ha elegido el DJ» — **falso** con el
   comportamiento actual, y estuvo un día en producción.
2. «Si no aparece, pídesela al DJ» — cierto, pero invitaba exactamente a la
   insistencia que el aviso quería evitar.

Ahora dice: *«Aquí no están todas las canciones del mundo. Si no la
encuentras, esta noche no suena.»* Cierto en los dos escenarios —lista del DJ o
repertorio del local— y cierra la conversación en vez de abrirla.
