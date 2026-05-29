# SESSION_DEBUG_TRACKER

> Cuaderno de deuda técnica intencional para el rastreo de errores
> de `/api/session`.  Cada bloque añadido está marcado en línea con:
>
> ```
> // TODO: CLEANUP SESSION DEBUG
> ```
>
> Filtrar por `[SESSION ERROR]` en DevTools → Console aísla únicamente
> el ruido de diagnóstico.

## Archivos modificados

| Fichero | Qué hay marcado |
|---|---|
| [app/lib/useSession.ts](app/lib/useSession.ts) | Dos `console.error` con prefijo `[SESSION ERROR]`: uno en el catch del fetch (excepción de red) y otro en la rama `!res.ok` o `payload.ok === false` (fallo del backend con status + payload). |

## Procedimiento de limpieza

1. `grep -n "CLEANUP SESSION DEBUG" app/` para localizar las marcas.
2. Eliminar el `console.error` (y restaurar el `catch {}` silencioso si
   se quiere volver al comportamiento original).
3. Borrar este archivo: `rm SESSION_DEBUG_TRACKER.md`.
4. `grep -n "SESSION ERROR"` para verificar que no queda nada.
5. `npm run build && npx tsc -b` para confirmar.

## Fecha

Creado: 2026-05-29
