# QA · Qué está probado y qué no

Estado a **4 de septiembre de 2026** · **27 comprobaciones, 27 en verde**. Se actualiza cada vez que se pasa el QA.

La prueba automática vive en `database/qa/smoke.sql`: se ejecuta entera contra
la sala `prueba` y **deshace todo lo que toca**. Cualquier fila con `FALLO` hay
que mirarla antes de desplegar.

---

## Verde · probado y funcionando

### Economía — la regla de la casa

| Caso | Resultado |
| :-- | :-- |
| Comprar sin saldo suficiente | Rechazado con `NG001` |
| El saldo después de intentarlo | **0, nunca negativo** |
| El cobro sale del saldo | 5.000 → 4.875 |

### Canje y ticket

| Caso | Resultado |
| :-- | :-- |
| Comprar un premio | Se crea con su descuento congelado |
| Empezar a quemar el ticket | Pasa a `redeeming` |
| **Quemar el ticket de otra persona** | **Rechazado** |
| Queda apuntado quién, qué y cuánto | Sí, en `user_rewards` |

### Aislamiento entre salas

| Caso | Resultado |
| :-- | :-- |
| Comprar un producto de OTRA sala | Rechazado con `NG008` |

### Música

| Caso | Resultado |
| :-- | :-- |
| Votar un tema | Registrado |
| El voto sube el contador | Sí |
| Añadir canción suelta del almacén | Conserva género y enlace |
| Guardar la sesión como plantilla | Conserva género |
| Aplicar una plantilla | Conserva género y enlace |
| Aplicar la misma plantilla dos veces | Añade 0 · no duplica |
| Añadir dos veces la misma canción | Rechazada |

### Check-in y referidos

| Caso | Resultado |
| :-- | :-- |
| Entrar con un QR válido | +50 fichas y visita registrada |
| Repetir el mismo QR esta noche | `already_checked_in` |
| QR inventado | `invalid_qr` |
| **QR de OTRA sala** | `invalid_qr` |
| **Quien invita cobra al entrar su amigo** | 75 → 175 |
| **No se paga dos veces** | 175 → 175 |

### Límites diarios · lo que evita que se farmeen fichas

Los cuatro premios de «1 por noche» rechazan el segundo intento y el saldo no
se mueve: ruleta (+15), Tinder (+25), batalla (+10) y reto de mesa (+40).

### Batalla, niveles y horario

| Caso | Resultado |
| :-- | :-- |
| Iniciar una batalla | En marcha |
| Forzar el cierre | Cerrada |
| 0 puntos → nivel de entrada | `bronce` |
| Muchos puntos → el más alto | `platino` |
| Las 3:00 pertenecen a la noche anterior | Correcto |
| Cobertura de la carta | 0 huecos |

### Panel del DJ · verificado en la interfaz

| Caso | Resultado |
| :-- | :-- |
| Crear una fiesta | Queda *programada*, no activa |
| Activar una fiesta **sin canciones** | Pide confirmación explícita |
| Activar una fiesta | El panel se actualiza al instante |
| Lanzar un flash drop | Aparece en el catálogo del cliente |
| Un drop que no mejora la oferta vigente | Avisa: «Este drop no se va a ver» |
| Precio del drop con decimales | «2,50€», no «3€» |
| Racha en la app | La real, no «Día 1 de piloto» |

---

## Ámbar · no probado todavía

Nada de esto se ha ejercitado. **No quiere decir que esté roto: quiere decir
que no lo sabemos.**

- **Los cuatro juegos jugándolos.** La lógica de debajo está probada —premios,
  límites, votos— pero nadie ha jugado una partida entera desde un móvil.
- **Las pantallas de TV.** Ni el jumbotron ni el dashboard de pantalla.
- **El circuito de invitación desde dos teléfonos.** La maquinaria está
  probada y paga bien; falta el recorrido humano: A comparte, B abre el enlace,
  B se registra, B escanea.
- **Subida de fotos y vídeo del local**, y el carrusel de fondo.
- **Comportamiento con mala conexión**, que es la condición normal de un local.

---

## Rojo · conocido y sin arreglar

- **Quien invita no ve nada** hasta que su amigo hace check-in. El enlace se
  usó, el sistema lo sabe, y la persona que invitó no se entera. Es lo que
  confundió al DJ el 3 de septiembre.
- **16 temas de plantilla sin género** en La Pocha. No están en el almacén, así
  que no hay de dónde sacarlo. Son 16 de 516.
- **`fact_rewards` solo carga los canjes consumidos**, así que la tasa de
  conversión de una campaña no se puede calcular desde el modelo de BI. Ver
  `HALLAZGOS_ETL.md` en el repo del dashboard.
- **El ETL une por fecha natural, no por noche de negocio**, así que cualquier
  gráfica «por día» parte las noches por la mitad.

---

## De dónde han salido los errores hasta ahora

Sirve para saber dónde mirar la próxima vez:

| Origen | Ejemplos |
| :-- | :-- |
| **Una regla comparaba la magnitud equivocada** | Elegir la oferta por euros cuando se paga en fichas |
| **Un dato se cae al copiarlo de una tabla a otra** | El género al meter canciones en una fiesta |
| **Formato que redondea** | «3€» cuando son 2,50 € |
| **El cliente pregunta una sola vez** | La fiesta activa, que se queda vieja en el móvil |
| **Un valor de maqueta que sobrevivió** | «Día 1 de piloto» |
| **El orden de dos acciones importa y nadie lo dice** | Activar la fiesta antes de cargar las canciones |

Cuatro de los seis **no dan error**: devuelven un dato válido pero equivocado.
Por eso el QA tiene que comparar contra lo esperado, y no solo comprobar que
algo no revienta.
