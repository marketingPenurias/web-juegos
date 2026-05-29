# AUTH_VERIFY_DEBUG

> Cuaderno de deuda técnica intencional para el rastreo del 401 en
> `/api/session` y, por extensión, en cualquier ruta que pase por
> `verifyAuthToken`.  Cada bloque añadido está marcado en línea con:
>
> ```
> // TODO: CLEANUP AUTH VERIFY DEBUG
> ```
>
> Filtrar por `[AUTH VERIFY]` o `[SESSION]` en los logs del Worker
> (Cloudflare Dashboard → Workers → Logs) aísla únicamente el ruido
> de diagnóstico.  El de `[SESSION ERROR]` del tracker anterior ya
> está integrado en el flujo y queda como parte del rastreo activo.

## Archivos modificados

| Fichero | Qué hay marcado |
|---|---|
| [app/lib/api.server.ts](app/lib/api.server.ts) | 3 `console.warn/error` en `verifyAuthToken`: (a) header Authorization ausente o no-Bearer, (b) `getSupabase()` throw por env vars faltantes, (c) `supabase.auth.getUser(token)` rechaza el JWT. |
| [app/lib/useSession.ts](app/lib/useSession.ts) | 1 `console.log` antes del fetch a `/api/session` confirmando que se envía el Bearer y con qué prefijo de token. |
| [app/routes/api.session.ts](app/routes/api.session.ts) | 1 `console.error` cuando `getServiceSupabase()` throw — significa que falta `SUPABASE_SECRET_KEY` en producción (causa raíz típica del 401 + JIT que no se ejecuta). |

## Matriz de diagnóstico

| Síntoma en consola/logs | Causa probable |
|---|---|
| `[SESSION] sending Bearer …` pero **no aparece** `[AUTH VERIFY]` | El request nunca llega al Worker — revisar deploy / cache CDN. |
| `[AUTH VERIFY] no Authorization header` | El navegador no manda el header — CORS / preflight bloqueando. |
| `[AUTH VERIFY] getSupabase threw` | Faltan `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` en CF env. |
| `[AUTH VERIFY] supabase.auth.getUser rejected` con `error.status: 401` | El JWT está expirado o el proyecto Supabase no lo reconoce. |
| `[AUTH VERIFY] getServiceSupabase threw — falta SUPABASE_SECRET_KEY` | Sin `SUPABASE_SECRET_KEY` el JIT no puede crear el `user_profile` y el RLS bloquea cualquier lectura posterior. |

## Procedimiento de limpieza

1. `grep -rn "CLEANUP AUTH VERIFY DEBUG" app/` para localizar marcas.
2. Eliminar cada `console.*` (o el bloque entero) inmediatamente debajo.
3. Borrar este archivo: `rm AUTH_VERIFY_DEBUG.md`.
4. `grep -rn "AUTH VERIFY\|^.SESSION." app/` para verificar.
5. `npm run build && npx tsc -b` para confirmar.

## Fecha

Creado: 2026-05-29
