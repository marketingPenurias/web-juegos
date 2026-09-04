# Cómo montar una noche

Guía operativa para quien maneja el panel. Escrita después de reconstruir la
noche del **3 de septiembre de 2026**, en la que casi todo falló.

---

## El orden correcto, en seis pasos

El orden importa más que ninguna otra cosa de esta página.

| | Cuándo | Qué |
| :-: | :-- | :-- |
| **1** | Un par de horas antes | **Crear** la fiesta. Queda *programada*: no la ve nadie. |
| **2** | Justo después | **Cargar los temas**, con la fiesta todavía cerrada. |
| **3** | Antes de abrir | **Comprobar que la fiesta tiene repertorio.** Si no lo tiene, no seguir. |
| **4** | Al abrir la puerta | **Activarla. Una sola vez.** |
| **5** | Durante la noche | Lanzar flash drops, batallas, «suena ahora». |
| **6** | Durante la noche | Añadir más temas si hace falta — esto sí es seguro en caliente. |

**La regla de una línea:** *primero los temas, después activar.* Todo lo que
salió mal el 3 de septiembre sale de haberlo hecho al revés.

---

## Las tres cosas que no hay que hacer

### 1 · Activar una fiesta vacía

Crear la fiesta **no** la activa: nace *programada* y hay que arrancarla a mano.
Pero al revés también pasa: se puede activar una fiesta sin un solo tema, y el
panel no dice nada.

Quien abra la app en ese momento se encuentra el Tinder y el Jukebox vacíos —
y **se queda así aunque luego cargues los temas**, porque su móvil ya preguntó.

> El 3 de septiembre la fiesta estuvo **diez minutos activa y sin repertorio**,
> justo en la franja en la que se estaba probando.

### 2 · Cambiar de fiesta con gente dentro

La app pregunta cuál es la fiesta activa **una sola vez, al abrirse**, y no
vuelve a preguntar. Si cambias de fiesta a mitad de noche:

- Los móviles ya abiertos siguen apuntando a la **fiesta anterior**.
- Sus votos van a una fiesta que ya no es la de la sala.
- No se enteran hasta que cierran y vuelven a abrir la app.

> Esa noche se cambió de fiesta **cuatro veces**, dos de ellas activando por
> error la fiesta del 1 de agosto.

### 3 · Crear una segunda fiesta para la misma noche

Si ya hay una en marcha, no crees otra: añade los temas que falten a la que está
viva. Dos fiestas para una noche parten los datos en dos y ninguna cuenta la
noche entera.

---

## Antes de abrir la puerta: cuatro comprobaciones

1. **Hay exactamente una fiesta activa**, y es la de hoy.
2. **Tiene temas.** Si el listado sale vacío, parar aquí.
3. **La carta tiene precios** y el aviso de cobertura está en verde.
4. **Abre la app en tu propio móvil** y mira que sale la música. Es la única
   comprobación que prueba lo que ve un cliente.

---

## Sobre los flash drops

Un drop compite con la promoción que ya esté puesta para ese producto. **Gana la
que le salga más barata al cliente en fichas**, no la que tenga mejor precio en
euros.

Antes de lanzar uno, mira qué precio tiene ya ese producto en la carta. Si tu
drop no mejora lo que ya hay, el cliente seguirá viendo la oferta anterior — y
desde fuera parece que el drop «no ha salido».

> El 3 de septiembre se lanzó una **Copa a 8 €** cuando la carta ya la tenía a
> **7 €**. Aquel día el sistema además comparaba mal (ver abajo), pero el
> consejo sigue valiendo: **un drop tiene que mejorar lo que ya hay.**

---

## Qué pasó el 3 de septiembre

Reconstruido desde el registro de auditoría y reproducido paso a paso en la sala
de pruebas.

### Un fallo nuestro, ya corregido

El flash drop **existía y era mucho mejor de lo que parecía**, pero la app
elegía la otra oferta:

| Copa · 9 € en barra | Descuento | Fichas por € | **Coste real** |
| :-- | --: | --: | --: |
| Promoción de la carta | 2 € | 150 | **300 fichas** |
| El flash drop | 1 € | 75 | **75 fichas** |

El drop era **cuatro veces más barato** para el cliente. Se escondía porque el
sistema ordenaba las ofertas **por su precio en euros** (7 € gana a 8 €) cuando
lo que paga la gente son **fichas**. Corregido en la migración `42`: ahora
ordena por el coste real, y con la misma cuenta con la que se cobra.

### Tres errores de manejo

| Hora | Qué pasó | Consecuencia |
| :-- | :-- | :-- |
| 21:13 → 21:24 | Fiesta activa **sin temas** durante 10 minutos | Música vacía para quien entrara |
| 21:24 y 23:12 | Se activó por error la **fiesta del 1 de agosto** | Los móviles abiertos se descolgaron |
| 23:24 | Se creó una **segunda fiesta** para la misma noche | Los datos de la noche quedaron partidos |

### Una cosa que no era un fallo

El enlace de invitación **no da fichas al mandarlo**: las da cuando el amigo
entra y **hace check-in** en la puerta. Esa noche una persona se registró con un
enlace pero nunca escaneó el QR, así que no se pagó nada. Funcionó como debía.

---

## Lo que todavía tenemos que arreglar nosotros

Estos son fallos del producto, no del manejo. Están pendientes:

- **La app no vuelve a preguntar por la fiesta activa.** Debería reintentarlo
  sola cada cierto tiempo, para que cambiar de fiesta no deje móviles colgados.
- **Se puede activar una fiesta sin temas** sin ningún aviso. El panel debería
  avisar, o directamente impedirlo.
- **El panel de drops no enseña el precio actual** del producto, así que es fácil
  lanzar uno que no mejora nada.
- **«Día 1 de piloto»** está escrito a fuego en el código y no se mueve.
- **Quien invita no ve que su enlace se usó** hasta que el amigo hace check-in.
  Debería ver «Pedro se ha registrado, te pagamos cuando entre».
