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

## ✅ Estado actual de la seguridad

**Verificación ES256 (ECDSA P-256) ACTIVA** vía Web Crypto API
(`crypto.subtle.verify`) contra la clave pública en formato **JWK**
en `SUPABASE_JWT_PUBLIC_KEY`.  El proyecto Supabase está en modo
"ECC P-256 Current Key, HS256 Legacy" — la firma de los nuevos
tokens es ES256 y la clave se exporta como JWK / JWKS JSON.  La
validación criptográfica es equivalente a la que hace Supabase
internamente; cero suplantación posible aunque el atacante conozca
un `sub` legítimo.  La clave PÚBLICA puede vivir en el Worker sin
riesgo (sólo la privada permite emitir tokens, y vive en Supabase).

El importador acepta dos formas:
- JWK plano: `{ "kty": "EC", "crv": "P-256", "x": "…", "y": "…" }`
- JWKS wrapper: `{ "keys": [ { … }, … ] }` (toma `keys[0]`)

La deuda anterior (`TODO: SECURITY HARDENING`) queda **cerrada** con este
cambio.

## ⚠️ Cambios de comportamiento activos en producción (rastreo)

1. **`verifyAuthToken` ya NO retorna `null` ante fallo** — lanza un
   `Response(401)` (o `500` si falta el secreto) con un código `error`
   concreto.  React Router propaga el throw al cliente y el navegador
   puede leerlo en la Network tab.
2. **`verifyAuthToken` ya NO llama a `supabase.auth.getUser(token)`** —
   verifica HS256 localmente con `crypto.subtle.verify`.  Cero
   round-trip de red.
3. **Requisito de configuración:** `SUPABASE_JWT_PUBLIC_KEY` debe estar
   provisionado en Cloudflare Pages → Settings → Environment
   variables (Production + Preview).  Si falta, `verifyAuthToken`
   lanza `JWT_PUBLIC_KEY_MISSING` con status 500 y `console.error`.

## Archivos modificados

| Fichero | Qué hay marcado |
|---|---|
| [app/lib/api.server.ts](app/lib/api.server.ts) | 6 ramas con `console.warn/error` + `throw jsonResponse` (códigos `NO_TOKEN_HEADER`, `JWT_PUBLIC_KEY_MISSING`, `JWT_INVALID_OR_EXPIRED`, `JWT_NO_SUB`, `ENV_VARS_MISSING_IN_CLOUDFLARE`).  Firma temporal `Promise<VerifiedUser>`.  Nuevas helpers `decodeB64Url`, `verifySupabaseJwtLocally`, `readJwtSecret`. |
| [app/lib/useSession.ts](app/lib/useSession.ts) | 1 `console.log` antes del fetch a `/api/session` + 2 `console.error` con prefijo `[SESSION ERROR]` (excepción de red y fallo `!res.ok`). |
| [app/routes/api.session.ts](app/routes/api.session.ts) | 1 `console.error` cuando `getServiceSupabase()` throw — significa que falta `SUPABASE_SECRET_KEY` en producción. |

## Códigos de error que el cliente ve ahora (Network → Response)

| `payload.error` | HTTP | Causa raíz |
|---|---|---|
| `NO_TOKEN_HEADER` | 401 | El navegador no manda el header / `useSession` se ejecuta sin sesión / CORS strippea. |
| `JWT_PUBLIC_KEY_MISSING` | 500 | `SUPABASE_JWT_PUBLIC_KEY` no provisionado en CF env. **Configuración**, no usuario. |
| `JWT_INVALID_OR_EXPIRED` | 401 | Firma ES256 no verifica o `exp` pasó.  El cliente debe refrescar sesión y reintentar. |
| `JWT_NO_SUB` | 401 | Token válido y firmado pero sin `sub`.  Token raro. |
| `ENV_VARS_MISSING_IN_CLOUDFLARE` | 401 | `SUPABASE_URL` o las dos keys (PUBLISHABLE/SECRET) no están provisionadas. |

## Matriz extendida (logs del Worker)

| Síntoma en consola/logs | Causa probable |
|---|---|
| `[SESSION] sending Bearer …` pero **no aparece** `[AUTH VERIFY]` | Request no llega al Worker — deploy stale / CDN. |
| `[AUTH VERIFY] no Authorization header` | El navegador no manda el header. |
| `[AUTH VERIFY] SUPABASE_JWT_PUBLIC_KEY no provisionado` | Configurar la variable en CF Pages. |
| `[AUTH VERIFY] JWT no verifica ES256 o está expirado` | Firma mal o `exp` pasado.  Reintentar tras refresh. |
| `[AUTH VERIFY] JWT válido pero sin sub` | Token de otro emisor / corrupto. |
| `[AUTH VERIFY] getSupabase threw` | Faltan `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` en CF env. |
| `[AUTH VERIFY] getServiceSupabase threw` | Sin `SUPABASE_SECRET_KEY` el JIT no puede crear `user_profiles`. |

## ⚠️ Acción manual en Cloudflare Pages (sin esto, todos los 401)

**Pages → Settings → Environment variables** (Production + Preview):

```
SUPABASE_JWT_PUBLIC_KEY = {"keys":[{"kty":"EC","crv":"P-256","x":"...","y":"...","kid":"...","alg":"ES256"}]}
```

(o bien una sola entrada sin wrapper `keys`).

Copiar desde Supabase Dashboard → Project Settings → API → JWT Settings
→ "Signing Keys" → entrada **Current Key (P-256)** → "Show public key"
→ pestaña **JWK** → copiar el JSON completo de una sola línea.  La
clave PÚBLICA puede vivir en el Worker sin riesgo de seguridad
(emitir tokens requiere la privada, que vive en Supabase).

## Procedimiento de limpieza (cuando cerremos el rastreo)

1. `grep -rn "CLEANUP AUTH VERIFY DEBUG\|CLEANUP SESSION DEBUG" app/`
   para localizar marcas.
2. Eliminar cada `console.*` inmediatamente debajo.
3. Decidir si **conservar** el `throw jsonResponse(...)` con códigos
   concretos (recomendado — mejor DX que `null`) o restaurar `return
   null` y firma `Promise<VerifiedUser | null>`.
4. **Conservar** las funciones `decodeB64Url`, `importPublicKey`,
   `verifySupabaseJwtLocally` y `readJwtPublicKey` — son código de
   producción, no rastreo.  Mantenerlas tras el cleanup.
5. Borrar este archivo: `rm AUTH_VERIFY_DEBUG.md`.
6. `grep -rn "AUTH VERIFY\|SESSION ERROR\|\[SESSION\]" app/` para
   confirmar limpieza total de los logs (no de las helpers HS256).
7. `npm run build && npx tsc -b`.

## Fecha

Creado: 2026-05-29 · Última actualización: 2026-05-29 (ES256 / ECDSA P-256 con JWK)
