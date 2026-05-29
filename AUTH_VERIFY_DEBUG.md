# AUTH_VERIFY_DEBUG

> Cuaderno de deuda técnica intencional para el rastreo del 401 en
> `/api/session` y, por extensión, en cualquier ruta que pase por
> `verifyAuthToken`.  Cada bloque añadido está marcado en línea con:
>
> ```
> // TODO: CLEANUP AUTH VERIFY DEBUG
> ```
>
> Filtrar por `[AUTH VERIFY]`, `[SESSION]` o `[SESSION ERROR]` en los
> logs del Worker (Cloudflare Dashboard → Workers → Logs / `wrangler
> tail`) aísla únicamente el ruido de diagnóstico.

## ⚠️ Cambios de comportamiento activos en producción

1. **`verifyAuthToken` ya NO retorna `null` ante fallo** — lanza un
   `Response(401)` con un código `error` concreto.  React Router
   propaga el throw al cliente y el navegador puede leerlo en la
   Network tab.
2. **`verifyAuthToken` ya NO llama a `supabase.auth.getUser(token)`** —
   en su lugar hace decode local del payload del JWT con `atob` +
   `JSON.parse`.  Eso elimina el round-trip de red a Supabase que
   estaba fallando intermitentemente en Cloudflare Workers.
3. **Riesgo de seguridad asumido:** la firma del JWT NO se verifica.
   En el piloto cerrado de hoy el riesgo es asumible; en producción
   abierta hay que verificar HS256 con `SUPABASE_JWT_SECRET` antes de
   confiar en `payload.sub`.  Marcado como `TODO: SECURITY HARDENING`
   en `verifyAuthToken`.

## Archivos modificados

| Fichero | Qué hay marcado |
|---|---|
| [app/lib/api.server.ts](app/lib/api.server.ts) | 6 ramas con `console.warn/error` + `throw jsonResponse` (códigos `NO_TOKEN_HEADER`, `JWT_MALFORMED`, `JWT_NO_SUB`, `JWT_EXPIRED`, `ENV_VARS_MISSING_IN_CLOUDFLARE`).  Firma temporal `Promise<VerifiedUser>`. |
| [app/lib/useSession.ts](app/lib/useSession.ts) | 1 `console.log` antes del fetch a `/api/session` + 2 `console.error` con prefijo `[SESSION ERROR]` (excepción de red y fallo `!res.ok`). |
| [app/routes/api.session.ts](app/routes/api.session.ts) | 1 `console.error` cuando `getServiceSupabase()` throw — significa que falta `SUPABASE_SECRET_KEY` en producción. |

## Códigos de error que el cliente ve ahora (Network → Response)

| `payload.error` | Causa raíz |
|---|---|
| `NO_TOKEN_HEADER` | El navegador no manda el header / `useSession` se ejecuta sin sesión / CORS strippea. |
| `JWT_MALFORMED` | El token no tiene 3 partes separadas por `.` o el payload no decodifica con `atob`.  Probable token corrupto. |
| `JWT_NO_SUB` | El payload no tiene `sub`.  No es un JWT emitido por Supabase Auth. |
| `JWT_EXPIRED` | `exp` ya pasó.  El cliente debería refrescar la sesión y reintentar. |
| `ENV_VARS_MISSING_IN_CLOUDFLARE` | `SUPABASE_URL` o las dos keys (PUBLISHABLE/SECRET) no están provisionadas en CF. |

## Matriz extendida (logs del Worker)

| Síntoma en consola/logs | Causa probable |
|---|---|
| `[SESSION] sending Bearer …` pero **no aparece** `[AUTH VERIFY]` en logs del Worker | El request nunca llega al Worker — revisar deploy / cache CDN. |
| `[AUTH VERIFY] no Authorization header` | El navegador no manda el header. |
| `[AUTH VERIFY] JWT no tiene 3 partes` | Token corrupto antes de llegar al backend. |
| `[AUTH VERIFY] JWT payload no decodifica` | base64url o JSON corruptos. |
| `[AUTH VERIFY] JWT sin sub` | Token de otro emisor. |
| `[AUTH VERIFY] JWT expirado` | Refrescar sesión en cliente. |
| `[AUTH VERIFY] getSupabase threw` | Faltan env vars en CF. |
| `[AUTH VERIFY] getServiceSupabase threw — falta SUPABASE_SECRET_KEY` | Sin SECRET el JIT no puede crear `user_profiles`. |

## Procedimiento de limpieza

1. `grep -rn "CLEANUP AUTH VERIFY DEBUG\|CLEANUP SESSION DEBUG" app/`
   para localizar marcas.
2. Eliminar cada `console.*` y/o el `throw jsonResponse(...)` (restaurar
   los `return null` originales).
3. Restaurar `verifyAuthToken` para llamar a `supabase.auth.getUser()`
   con verificación real de firma — o, mejor, migrar a verificación
   HS256 local contra `SUPABASE_JWT_SECRET` (más rápido + sin red).
4. Cambiar firma a `Promise<VerifiedUser | null>` y los callers
   recuperan su branch `if (!verified) return jsonResponse({ error:
   'unauthorized' }, …)`.
5. Borrar este archivo: `rm AUTH_VERIFY_DEBUG.md`.
6. `grep -rn "AUTH VERIFY\|SESSION ERROR\|\[SESSION\]" app/` para
   confirmar limpieza total.
7. `npm run build && npx tsc -b`.

## TODO: SECURITY HARDENING (post-piloto)

Migrar el decode local a verificación HS256 (Web Crypto API) contra
`SUPABASE_JWT_SECRET` antes de confiar en `payload.sub`.  Sin firma
verificada, un atacante puede emitir un JWT no firmado con cualquier
`sub` y suplantar a otro usuario en operaciones service_role.

## Fecha

Creado: 2026-05-29 · Última actualización: 2026-05-29 (decode local)
