# El servicio se cae los días que hay fútbol

Investigado el **5 de septiembre de 2026**, a raíz del informe de Lucía: la app
estuvo caída en La Pocha de **21:00 a 00:30** durante el Madrid–Betis.

**No es un fallo nuestro, y no se arregla con código.** Pero sí es una decisión
que tenemos que tomar, porque nos cae encima justo en nuestra franja horaria.

---

## Qué pasa

Desde una resolución judicial de diciembre de 2024, LaLiga puede exigir a
Movistar, Vodafone, Orange y Digi que bloqueen direcciones IP los días de
partido. Se bloquean hasta 3.000 IPs, y **entre el 35 % y el 45 % son de
Cloudflare**.

Como Cloudflare comparte cada IP entre cientos o miles de webs, bloquear una
sola dirección tumba a todas las que estén detrás. Miles de negocios legítimos
caen cada fin de semana.

El pico de bloqueos está **alrededor de medianoche**. Que es exactamente
nuestra hora punta.

## Por qué nos afecta a nosotros

Los cuatro subdominios resuelven a las mismas dos direcciones:

```
nightgraph.io            188.114.96.5   188.114.97.5
prueba.nightgraph.io     188.114.96.5   188.114.97.5
lapocha.nightgraph.io    188.114.96.5   188.114.97.5
dashboard.nightgraph.io  188.114.96.5   188.114.97.5
```

Ambas están en `188.114.96.0/20`, un rango **compartido** de Cloudflare y de
los que más aparecen en las listas de bloqueo. Cuando cae, **cae todo a la vez**:
la app de los clientes, el panel del DJ y el dashboard de la sala.

## Por qué el remedio habitual no nos sirve

A la mayoría de las webs afectadas se les dice lo mismo: quita el proxy de
Cloudflare (la nubecita naranja del DNS) y que el tráfico vaya directo a tu
servidor.

**Nosotros no podemos.** La app *es* un Worker de Cloudflare: se ejecuta en su
borde y no hay ningún servidor de origen detrás al que apuntar. Es la misma
razón por la que es barata y rápida.

## Las opciones, con lo que cuesta cada una

### A · No hacer nada

Aceptar que los días de partido puede haber horas sin servicio. Los bloqueos
están autorizados **hasta el 20 de junio de 2027**, así que esto es toda la
temporada que viene, no un mal fin de semana.

*Coste: cero. Riesgo: que una sala nos eche por algo que no controlamos.*

### B · Sacar la app de Cloudflare Workers

Llevarla a un alojamiento convencional con IP propia. React Router 7 corre en
otros sitios sin drama, y **Supabase no está afectado** —vive en AWS—, así que
la base de datos y las RPC seguirían igual.

*Coste: trabajo de migración y una factura de servidor donde antes había casi
cero. Es la única opción que quita el riesgo del todo.*

### C · Un espejo fuera de Cloudflare

Mantener la app donde está y tener una copia en otro proveedor a la que apuntar
cuando haya bloqueo. El problema es el QR: está impreso y apunta a un dominio
concreto.

*Coste: mantener dos despliegues, y un mecanismo para redirigir que a su vez
tiene que ser alcanzable.*

### D · Reclamar

Hay vía para reclamar los daños, y Cloudflare está peleándolo en los
tribunales. No arregla el sábado que viene.

---

## Lo que yo haría

**La B, y pronto.** No por gusto técnico: porque nuestro producto solo existe
de viernes a sábado de once a seis, y el pico de bloqueos es a medianoche. Un
producto de ocio nocturno que se cae los días de fútbol tiene un problema de
raíz, no un incidente.

Y hay un ángulo comercial: **esto va a salir en una reunión de ventas.** Un
dueño de sala te va a preguntar «¿y si se cae?». Tener respuesta —«no estamos
en los rangos que bloquean»— vale más que el ahorro de la factura.

## Lo que hizo Lucía mientras tanto

Instaló **Cloudflare WARP** (VPN gratuita) en los dos ordenadores de La Pocha.
Eso arregla las pantallas del local, y está bien como parche.

Pero **no arregla los móviles de los clientes**, que son los que importan: nadie
va a instalarse una VPN en la puerta de una discoteca para jugar a la ruleta.
