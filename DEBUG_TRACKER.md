# DEBUG_TRACKER

> Cuaderno de deuda técnica intencional.  Todo el código de rastreo
> añadido para diagnosticar el bug de captura de sesión OAuth está
> marcado en línea con el comentario:
>
> ```
> // TODO: CLEANUP DEBUG
> ```
>
> Para revertir la trazabilidad de un plumazo, eliminar cada bloque
> marcado por ese comentario en los archivos listados abajo.  El
> `setTimeout(500)` de `auth.callback.tsx` es parte del bloque debug
> y debe desaparecer junto con los logs (no es lógica de producción).

## Archivos modificados con código de rastreo

| Fichero | Qué hay marcado |
|---|---|
| [app/routes/auth.callback.tsx](app/routes/auth.callback.tsx) | `console.log` en `render`, en `useEffect` inicial, en `getBrowserSupabase()`, en lectura de `code`, en `exchangeCodeForSession`, en post-sleep `getSession()`, y en `navigate("/")`.  Además incluye un `setTimeout(500)` intencional antes del `navigate` para descartar race de escritura de cookieStorage. |
| [app/screens/Onboarding.tsx](app/screens/Onboarding.tsx) | `console.log` al montar el `useEffect`, al instanciar el cliente Supabase, al llamar `getSession()`, en el resultado del check inicial, y en cada disparo de `onAuthStateChange`. |
| [app/routes.ts](app/routes.ts) | Un único comentario `TODO: CLEANUP DEBUG` documentando la verificación de no-colisión de la ruta `auth/callback`.  Sin lógica añadida — sólo retirar el comentario al limpiar. |

## Prefijo de logs

Todos los `console.log` / `console.warn` / `console.error` de rastreo
comparten el prefijo:

```
[AUTH DEBUG]
```

Filtrar por ese string en DevTools → Console aísla únicamente el
ruido de diagnóstico.

## Procedimiento de limpieza

1. `grep -n "CLEANUP DEBUG" app/` para localizar todas las marcas.
2. Eliminar el `console.*` (o el bloque entero) inmediatamente debajo
   de cada `// TODO: CLEANUP DEBUG`.
3. En `auth.callback.tsx`, eliminar también el `await new Promise(...)`
   de 500 ms y la relectura de `getSession()` post-sleep — ambas son
   parte del rastreo, no de la lógica de producción.
4. `grep -n "AUTH DEBUG"` para verificar que no queda nada.
5. `npm run build && npx tsc -b` para confirmar.

## Fecha

Creado: 2026-05-28 · Última actualización: 2026-05-28
