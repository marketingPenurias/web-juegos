# ARCHITECTURE — Nightgraph (La Pocha · Pilot-Ready)

> **Status**: deployed in production, Cloudflare Pages auto-deploys from `main`.
> **Last reviewed**: 2026-05-29 (ES256 JWT + JIT profile + tier/day rules + welcome bonus 100t + QR attribution).
> **Scope**: full stack — frontend, edge worker, database, auth, security, economy, físico↔digital.

Este documento es el **mapa del tesoro**. Si un ingeniero entra nuevo
al equipo, debe poder leerlo y entender el sistema al 100% sin tener
que abrir un solo archivo más. Cada sección está deliberadamente
estructurada para ser una capa coherente del producto.

---

## 1. Visión General del Sistema (Tech Stack)

Nightgraph es una plataforma B2B2C **white-label** de gamificación
para discotecas. El primer tenant operativo es **La Pocha**. Los
usuarios entran a `https://<slug>.nightgraph.io` desde el móvil, hacen
login con Google, juegan (Tinder Musical, Jukebox, Live Battle,
Ruleta), ganan **tokens**, y los gastan en barra contra un catálogo de
copas y rewards configurado por la sala.

```
┌──────────────────────────────────────────────────────────────────────┐
│                       NAVEGADOR  (iOS / Android)                      │
│  ───────────────────────────────────────────────────────────────────  │
│   React Router 7 SPA   ·  Zustand store (sessionStorage)             │
│   GSAP + @gsap/react   ·  i18next (es / en)                          │
│   @supabase/supabase-js (PKCE flow, localStorage)                    │
└─────────────────────┬────────────────────────────────────────────────┘
                      │ HTTPS · Authorization: Bearer <JWT ES256>
                      │ X-Tenant-Slug: lapocha
                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│            CLOUDFLARE WORKERS · Edge global (auto-deploy)            │
│  ───────────────────────────────────────────────────────────────────  │
│   workers/app.ts                                                     │
│     ↳ react-router/createRequestHandler                              │
│         ↳ root.loader            → tenant resolution + theme         │
│         ↳ routes/home            → SSR splash + hydrate              │
│         ↳ routes/auth.callback   → PKCE exchangeCodeForSession       │
│         ↳ routes/api.session     → JIT profile + welcome bonus       │
│         ↳ routes/api.auth-sync   → upsert + consumir ?ref            │
│         ↳ routes/api.catalog     → tenant_products visibles          │
│         ↳ routes/api.rewards     → purchase / start-redemption       │
│         ↳ routes/api.music       → swipe deck + vote_track RPC       │
│         ↳ routes/api.wallet      → spend / earn atómico              │
│         ↳ routes/api.history     → ledger paginado                   │
│         ↳ routes/api.analytics   → behavior_events append-only       │
│         ↳ routes/tv.music        → Jumbotron cookie-auth + Realtime  │
│   lib/api.server.ts                                                  │
│     ↳ verifyAuthToken            → ES256 verify via Web Crypto       │
│   lib/supabase.server.ts                                             │
│     ↳ getSupabase                → publishable key (RLS-bound reads) │
│     ↳ getServiceSupabase         → SECRET key (bypassea RLS)         │
└─────────────────────┬─────────────────────────┬──────────────────────┘
                      │ SECRET KEY              │ Realtime WS (postgres_changes)
                      ▼                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  SUPABASE / POSTGRES (eu-west-x)                      │
│  ───────────────────────────────────────────────────────────────────  │
│   Auth (Google OAuth · ES256 / ECDSA P-256 JWK)                       │
│   Tablas:                                                             │
│     · tenants, user_profiles, tenant_events, tenant_staff             │
│     · wallet_ledger (append-only)                                     │
│     · tenant_products + tenant_tier_thresholds + tenant_token_rewards │
│     · event_tracks, track_votes, user_rewards                         │
│     · tracking_campaigns, promoter_codes, audit_logs                  │
│   RPCs (SECURITY DEFINER, lockdown a service_role):                   │
│     · spend_tokens, vote_track, purchase_reward                       │
│     · start_reward_redemption, grant_signup_bonus, get_user_tier      │
│     · resolve_tracking_campaign, business_night                       │
│   RLS en cada tabla → current_tenant_id() lee el claim del JWT        │
│   Realtime publication: event_tracks + behavior_events                │
└──────────────────────────────────────────────────────────────────────┘
```

Comunicación a alto nivel:

| Trayecto | Transporte | Auth | Datos |
|---|---|---|---|
| Navegador → Worker | HTTPS / fetch (`keepalive: true`) | `Authorization: Bearer <JWT ES256>` | JSON; tenant via header `X-Tenant-Slug` o body |
| Worker → Supabase (writes) | HTTPS / PostgREST | `SUPABASE_SECRET_KEY` (bypassea RLS) | RPC con prefijo `p_*` |
| Worker → Supabase (reads RLS) | HTTPS / PostgREST | `SUPABASE_PUBLISHABLE_KEY` | RLS por `current_tenant_id()` |
| Navegador → Supabase (Realtime) | WebSocket | JWT en el handshake | `postgres_changes` filtrado server-side |
| Navegador → Supabase (Auth) | HTTPS | Google OAuth PKCE | Sesión en `window.localStorage` |

**Despliegue cero-toque**: push a `main` → Cloudflare Pages compila
(`npm run build`) → publica el Worker. **No hay que ejecutar
`npm run deploy` manual** (ver memoria `project_cf_workers_builds`).

---

## 2. Autenticación y Seguridad en el Edge (CRÍTICO)

El motor de autenticación es la pieza más delicada de Nightgraph:
emite identidades distribuidas que viajan por el navegador, el edge y
la BD, y un solo eslabón débil rompe la cadena de confianza
multi-tenant. Esta sección documenta el flujo **completo** y las
razones de cada decisión.

### 2.1 Flujo de Login (Google OAuth → Subdominio del Tenant → JWT)

```
┌────────────────────────────────────────────────────────────────┐
│ 1. El usuario entra a https://lapocha.nightgraph.io           │
│    (la URL puede llevar ?ref=BATHROOM_VIP para atribución)    │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ 2. root.loader (Cloudflare Worker)                            │
│    · Lee ?ref → Set-Cookie ng_tracking_ref HttpOnly Lax 24h    │
│    · 303 redirect a la URL limpia                             │
│    · extractSlugFromHost("lapocha.nightgraph.io") → "lapocha" │
│    · SELECT id, theme FROM tenants WHERE slug='lapocha'       │
│    · Devuelve { tenant } como loader data                     │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ 3. Onboarding.tsx                                              │
│    [Continuar con Google]                                      │
│    supabase.auth.signInWithOAuth({                             │
│      provider: 'google',                                       │
│      options: {                                                │
│        redirectTo: `${origin}/auth/callback`,                  │
│        queryParams: { prompt: 'select_account' }               │
│      }                                                         │
│    })                                                          │
│    · PKCE flow: el cliente genera code_verifier y lo guarda    │
│      en localStorage ANTES de saltar a Google.                 │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ 4. accounts.google.com  →  consent  →  redirect               │
│    https://lapocha.nightgraph.io/auth/callback?code=…&state=… │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ 5. /auth/callback (app/routes/auth.callback.tsx)              │
│    · Guard de Strict Mode (exchangedRef.current)              │
│    · supabase.auth.exchangeCodeForSession(code)               │
│      → Supabase lee code_verifier de localStorage             │
│      → Devuelve { access_token, refresh_token, user }         │
│    · supabase.auth.setSession({access, refresh})               │
│      Refuerzo manual porque hemos visto el storage             │
│      "evaporarse" entre exchange y siguiente getSession()      │
│    · navigate('/', { replace: true })                          │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ 6. LaPochaApp monta useSession()                              │
│    · getAccessToken() → JWT ES256                              │
│    · fetch /api/session                                        │
│        Authorization: Bearer <JWT>                             │
│        X-Tenant-Slug: lapocha                                  │
│        Cookie: ng_tracking_ref=BATHROOM_VIP   (si quedaba)    │
└────────────────────────────────────────────────────────────────┘
```

**Por qué `detectSessionInUrl: false`** — Si supabase-js procesa el
`?code=…` en cada navegación, consume el `code_verifier` antes de que
`/auth/callback` lo necesite, y el usuario aterriza sin sesión.
Forzando `false` y manejando el exchange manualmente en una sola ruta
(`/auth/callback`), garantizamos un único exchange exitoso y
reproducible.

**Por qué `setSession()` explícito tras el exchange** — En Cloudflare
Workers + React 19 hemos observado que el adaptador de storage de
supabase-js a veces "olvida" persistir la sesión entre el
`exchangeCodeForSession` y el siguiente `getSession()`. Re-inyectar la
sesión a mano fija el bug definitivamente. Esta es deuda conocida del
ecosistema, no nuestra.

### 2.2 Validación nativa ES256 (P-256 ECDSA) en Cloudflare Workers

**El problema que resolvimos**: la versión inicial llamaba a
`supabase.auth.getUser(token)` en cada request. Ese método hace un
round-trip a `<proyecto>.supabase.co/auth/v1/user`. En el runtime de
Cloudflare Workers ese fetch fallaba intermitentemente (cold-start,
rate-limit, latencia variable de la región), produciendo el 401
misterioso que bloqueaba el JIT del perfil y dejaba a los usuarios sin
sesión en producción.

**La solución**: verificar la firma del JWT **localmente** en el
Worker, sin red, usando Web Crypto API (`crypto.subtle.verify`) contra
la clave pública del proyecto Supabase.

#### 2.2.1 Por qué ES256 (asimétrica) y no HS256 (simétrica)

El proyecto Supabase está configurado en modo **"ECC P-256 Current
Key, HS256 Legacy"**. Esto significa que **los JWT nuevos llevan firma
ECDSA P-256 (ES256)**, mientras que el material HS256 sólo se mantiene
por compatibilidad para tokens viejos en circulación.

| Característica | HS256 (legacy) | ES256 (current) |
|---|---|---|
| Algoritmo | HMAC-SHA256 simétrico | ECDSA con curva P-256 |
| Material del Worker | Secret compartido (idéntico al usado para firmar) | Sólo la clave **pública** |
| Riesgo de filtración del Worker | Crítico: permite emitir tokens válidos | Bajo: no permite firmar nada |
| Formato esperado | Hex / base64 / utf8 | JWK (JSON Web Key) o JWKS wrapper |

Asimétrica es estrictamente mejor: si la clave del Worker se filtra,
el atacante NO puede emitir tokens válidos porque no tiene la privada
(que sólo vive en Supabase).

#### 2.2.2 Pipeline criptográfico (Web Crypto API en Workers)

```ts
// app/lib/api.server.ts (extracto)

async function importPublicKey(jwkJsonString: string): Promise<CryptoKey> {
  const jwkData = JSON.parse(jwkJsonString);
  const keyToImport =
    "keys" in jwkData ? jwkData.keys[0] : jwkData;   // JWKS wrapper OR JWK plano
  return crypto.subtle.importKey(
    "jwk",
    keyToImport,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

async function verifySupabaseJwtLocally(token, jwk) {
  const [h, p, s] = token.split(".");
  const key       = await importPublicKey(jwk);
  const data      = new TextEncoder().encode(`${h}.${p}`);
  const signature = b64urlToBytes(s);
  const isValid   = await crypto.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key,
    signature,
    data,
  );
  if (!isValid) return null;
  const payload = JSON.parse(b64urlDecode(p));
  if (payload.exp * 1000 < Date.now()) return null;     // expirado
  return payload;
}
```

Notas finas:

- **Firma JWT ECDSA viene en IEEE P1363 raw** (r||s, 64 bytes para
  P-256), que es exactamente el formato que espera
  `crypto.subtle.verify` con algoritmo ECDSA. No hay que convertir
  desde DER.
- **El parser acepta dos formas** en `SUPABASE_JWT_PUBLIC_KEY`:
  - JWK plano: `{ "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }`
  - JWKS wrapper: `{ "keys": [ {...}, ... ] }` → tomamos `keys[0]`
- **Verificación local = equivalente criptográfico** a
  `supabase.auth.getUser(token)`. No hay degradación de seguridad.
- **La clave PÚBLICA en el Worker es segura por diseño** — copia desde
  Supabase Dashboard → API → JWT Settings → Signing Keys → Current Key
  → Show public key → JWK.

#### 2.2.3 Cinco códigos de error semánticos (zero-trust)

`verifyAuthToken` **NO retorna `null`** ante fallo — lanza un
`Response` con un código concreto que React Router propaga al cliente
y queda visible en la pestaña Network del navegador.

| `payload.error` | HTTP | Causa raíz |
|---|---|---|
| `NO_TOKEN_HEADER` | 401 | El navegador no manda `Authorization`, o no empieza por `Bearer ` |
| `JWT_PUBLIC_KEY_MISSING` | 500 | `SUPABASE_JWT_PUBLIC_KEY` no está provisionado en Cloudflare env |
| `JWT_INVALID_OR_EXPIRED` | 401 | Firma ES256 no verifica o `exp` ya pasó |
| `JWT_NO_SUB` | 401 | Token válido y firmado pero sin claim `sub` |
| `ENV_VARS_MISSING_IN_CLOUDFLARE` | 401 | `SUPABASE_URL` / publishable / secret no provisionados |

Cada error lleva un `console.warn/error` con prefijo `[AUTH VERIFY]`
para que `wrangler tail` y los logs de CF Dashboard sean grepables.

#### 2.2.4 Configuración productiva

**Cloudflare Pages → Settings → Environment variables** (Production +
Preview):

```
SUPABASE_URL                = https://<proyecto>.supabase.co
SUPABASE_PUBLISHABLE_KEY    = sb_publishable_…           (anon RLS-bound)
SUPABASE_SECRET_KEY         = sb_secret_…                (NEVER en bundle)
SUPABASE_JWT_PUBLIC_KEY     = {"keys":[{"kty":"EC","crv":"P-256",
                               "x":"…","y":"…","kid":"…","alg":"ES256"}]}
```

Y en el bundle del navegador (Vite `.env`):

```
VITE_SUPABASE_URL              = https://<proyecto>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY  = sb_publishable_…
```

Cero secretos del servidor llegan al navegador. La SECRET KEY sólo
existe en el contexto del Worker.

### 2.3 JIT (Just-In-Time) User Profile Creation y el catch-22 del `unknown_tenant`

#### 2.3.1 El problema

El flujo idealizado es:

1. Usuario hace OAuth → Supabase crea fila en `auth.users`.
2. Usuario llega al subdominio y dispara `/api/session`.
3. El Worker consulta `user_profiles` → encuentra fila → devuelve perfil.

Pero **el paso 1 no crea fila en `user_profiles`** (esa tabla vive en
`public.*` y es nuestra, no de Supabase Auth). En el primer login el
usuario tiene una identidad en `auth.users` pero **NO tiene perfil en
nuestro esquema**. Si dejamos que el Worker simplemente devuelva 404
("perfil no existe"), el usuario nunca puede jugar — porque ninguna
otra ruta crea el perfil tampoco.

**Opción rechazada A**: usar un trigger Postgres
`AFTER INSERT ON auth.users` que cree la fila en `user_profiles`.
Problema: el trigger no sabe el `tenant_id` (Supabase Auth es
multi-tenant agnóstico — la misma cuenta de Google puede entrar a
`lapocha.nightgraph.io` y a `kapital.nightgraph.io`). Acoplar trigger
de Auth a un único tenant rompe la promesa SaaS.

**Opción rechazada B**: usar `getSupabase()` con la clave
`PUBLISHABLE_KEY` desde el Worker para hacer el INSERT del perfil.
**Esto produce el catch-22**:

```
INSERT INTO user_profiles (tenant_id, auth_user_id, ...)
  ↓
RLS policy: WITH CHECK (tenant_id = public.current_tenant_id())
  ↓
current_tenant_id() lee request.jwt.claims->>'tenant_id'
  ↓
El JWT del usuario NO TIENE custom claim 'tenant_id' (Supabase Auth
no lo emite — nuestro tenancy vive en public.*, no en auth.*)
  ↓
current_tenant_id() devuelve NULL
  ↓
RLS bloquea el INSERT → "new row violates row-level security policy"
  ↓
/api/session devuelve 404 unknown_tenant / profile_not_found
  ↓
Cliente entra en bucle de retries que nunca convergen
```

#### 2.3.2 La solución: `getServiceSupabase()` para el JIT

Para crear el perfil del recién llegado **NO podemos pasar por RLS**
porque RLS no tiene contexto suficiente. Usamos el cliente con
**`SUPABASE_SECRET_KEY`** (service_role-equivalent) que bypassea RLS
por diseño. La seguridad NO se pierde porque:

1. El `tenant_id` que insertamos NO viene del cliente — viene de
   resolver `tenants.slug` server-side desde el hostname o el header
   `X-Tenant-Slug` validado.
2. El `auth_user_id` viene del JWT YA verificado por `verifyAuthToken`
   (la pieza criptográfica de §2.2). El cliente NO puede inyectar
   identidad de otro.
3. La fila se crea con `token_balance=0` — no se regalan tokens hasta
   que la economía decida hacerlo en el siguiente paso.

```ts
// app/routes/api.session.ts (extracto)

const supabase = getServiceSupabase(context);   // <-- SECRET KEY

// Resolve tenant from validated slug
const { data: tenant } = await supabase
  .from("tenants")
  .select("id")
  .eq("slug", slugResult.slug)
  .maybeSingle();

// Look up existing profile
const { data: existing } = await supabase
  .from("user_profiles")
  .select("id, token_balance, lifetime_earned")
  .eq("tenant_id", tenant.id)
  .eq("auth_user_id", verified.id)                // <-- del JWT verificado
  .maybeSingle();

if (!existing) {
  // ── JIT INSERT ───────────────────────────────────────────────
  const { data: created } = await supabase
    .from("user_profiles")
    .insert({
      tenant_id,
      auth_user_id: verified.id,
      email: verified.email ?? `${verified.id}@anon.nightgraph`,
      token_balance: 0,
      lifetime_earned: 0,
    })
    .select("id, token_balance, lifetime_earned")
    .single();

  // ── Welcome bonus +100 tokens (RPC idempotente) ─────────────
  await supabase.rpc("grant_signup_bonus", { p_user_id: created.id });

  // Re-leer para capturar el bonus aplicado por el trigger
  const { data: refreshed } = await supabase
    .from("user_profiles")
    .select("id, token_balance, lifetime_earned")
    .eq("id", created.id)
    .maybeSingle();

  profile = refreshed;
}
```

#### 2.3.3 Por qué `getServiceSupabase` está separado de `getSupabase`

```ts
// app/lib/supabase.server.ts (extracto)

export function getSupabase(ctx) {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  // Fallback "best effort" para entornos sin secret aún.
}

export function getServiceSupabase(ctx) {
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Response("Supabase secret key not configured", { status: 503 });
  // Strict — falla loud cuando falta.
}
```

Esta separación es deliberada: los handlers que escriben (JIT,
purchase_reward, spend_tokens, vote_track) llaman `getServiceSupabase`
y se vuelven `503` ruidosos si falta la clave, en lugar de degradar
silenciosamente a una llamada que el RLS bloquearía con un error
críptico.

#### 2.3.4 Bonus de bienvenida idempotente (`grant_signup_bonus`)

El JIT está acoplado al motor de economía: tras crear la fila del
perfil, el handler llama a un RPC `SECURITY DEFINER` que aplica el
bonus configurado en `tenant_token_rewards.signup_bonus` (default
**100 tokens** según `BRONCE.pdf`):

```sql
create or replace function public.grant_signup_bonus(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_tenant_id uuid; v_amount int; v_ledger_id bigint;
begin
  -- 1. Tenant del perfil
  select tenant_id into v_tenant_id from user_profiles where id = p_user_id;
  if v_tenant_id is null then
    return jsonb_build_object('ok', false, 'error', 'profile_not_found');
  end if;

  -- 2. Idempotencia — si ya hay signup_bonus en el ledger, no doble bonus
  if exists (
    select 1 from wallet_ledger where user_id = p_user_id and reason = 'signup_bonus'
  ) then
    return jsonb_build_object('ok', true, 'already_granted', true);
  end if;

  -- 3. Leer la economía configurada
  select amount into v_amount
  from tenant_token_rewards
  where tenant_id = v_tenant_id and event_code = 'signup_bonus' and is_active;
  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  -- 4. Asentar el bonus (trigger recalcula token_balance + lifetime_earned)
  insert into wallet_ledger (tenant_id, user_id, amount, reason, metadata)
  values (v_tenant_id, p_user_id, v_amount, 'signup_bonus',
          jsonb_build_object('source', 'jit'))
  returning id into v_ledger_id;

  return jsonb_build_object('ok', true, 'amount', v_amount, 'ledger_id', v_ledger_id);
end;
$$;

revoke execute on function public.grant_signup_bonus(uuid) from public, anon, authenticated;
grant  execute on function public.grant_signup_bonus(uuid) to service_role;
```

**Garantías**:
- **Idempotente**: la guarda `EXISTS … reason='signup_bonus'` impide
  doble bonus si `api.session` se llama dos veces durante un retry o
  StrictMode.
- **Configurable sin redeploy**: el amount vive en
  `tenant_token_rewards`. Si el negocio quiere subir/bajar el welcome
  bonus, lo cambia en BD y los siguientes signups lo cogen al vuelo.
- **Lockdown**: el RPC sólo es invocable con la `SECRET_KEY` desde el
  Worker. `anon` / `authenticated` no pueden llamarlo vía PostgREST.

#### 2.3.5 Recuperación TOCTOU del INSERT

En `/api/auth-sync` el INSERT del perfil puede colisionar con un
re-disparo de `SIGNED_IN` (React StrictMode dispara el listener dos
veces en dev). La segunda llamada choca con el partial UNIQUE index en
`(auth_user_id)` y Postgres devuelve SQLSTATE 23505. Lo recuperamos
tratándolo como si fuera el branch "existing":

```ts
if (insertErr && insertErr.code === "23505") {
  const { data: recovered } = await supabase
    .from("user_profiles")
    .select(...)
    .eq("tenant_id", tenant_id)
    .eq("auth_user_id", verified.id)
    .maybeSingle();
  return jsonResponse({ ok: true, profile: { ...recovered, is_new: false } });
}
```

---

## 3. Multi-Tenancy y Eventos

Nightgraph es **multi-tenant nativo**: una sola instancia del Worker
sirve a N discotecas, cada una con su subdominio, su tema visual, su
catálogo, su economía y sus reglas. El aislamiento NO es opcional —
es la propiedad core que vendemos a las salas.

### 3.1 Modelo de tenancy

```
promoters (grupo empresarial)
   │  1 → N
   ▼
tenants  (discoteca individual: lapocha, kapital, coliseum, …)
   │  1 → N
   ▼
tenant_events (sesiones: "Halloween 2026", "Viernes Techno")
   │  1 → N
   ▼
event_tracks  (catálogo musical del evento)
track_votes   (audit de cada voto)
user_rewards  (rewards comprados, scoped por evento)
```

| Tabla | Identidad | Notas |
|---|---|---|
| `promoters` | `id uuid PK`, `name`, `contact_email` | Grupo (RRPP corporativa que opera N salas) |
| `tenants` | `id uuid PK`, `slug text unique`, `name`, `status (active\|paused\|churned)`, `theme jsonb`, `features jsonb`, `promoter_id` | Una sala. `slug` es el subdominio (`lapocha` → `lapocha.nightgraph.io`) |
| `tenant_events` | `id uuid PK`, `tenant_id`, `name`, `start_time`, `end_time`, `status (draft\|active\|closed)` | Sesiones de la sala — todo lo musical y los rewards van scopeados a un evento activo |
| `tenant_staff` | `(tenant_id, user_id)` UNIQUE | RBAC: `admin\|manager\|door\|bar\|dj\|promoter\|display` |

### 3.2 Resolución de slug (4 capas, sin defaults)

`pickTenantSlug(bodySlug, request)` en `tenant-resolver.server.ts`
elige el slug en este orden:

1. **Body** — `tenant_slug` en el payload JSON (cuando el cliente lo
   pasa explícitamente).
2. **Header** — `X-Tenant-Slug` (analítica móvil con `keepalive`).
3. **Hostname** — `extractSlugFromHost(request.url.hostname)`:
   - `lapocha.nightgraph.io` → `lapocha`
   - `kapital.nightgraph.io` → `kapital`
   - `localhost`, `127.0.0.1` → `lapocha` (demo dev)
   - `*.pages.dev` (preview CF) → `lapocha`
   - apex `nightgraph.io` → `""` → 404
4. **Normalización**: `trim → toLowerCase → slice(0,64)`.

Si nada resuelve, los handlers devuelven `400 missing_tenant`. **No
hay default silente** — un fallback automático a "lapocha" podría
hacer que datos de una sala acaben en otra. Mejor fallar ruidoso.

### 3.3 Aislamiento por RLS

Cada tabla con `tenant_id` lleva habilitada Row Level Security con la
política canónica:

```sql
create policy <name>_tenant_read on public.<table>
  for select using (tenant_id = public.current_tenant_id());

create policy <name>_tenant_write on public.<table>
  for insert with check (tenant_id = public.current_tenant_id());

create policy <name>_tenant_update on public.<table>
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
```

`current_tenant_id()` lee el claim del JWT:

```sql
create or replace function public.current_tenant_id() returns uuid
language sql stable as $$
  select nullif(
    current_setting('request.jwt.claims', true)::json->>'tenant_id',
    ''
  )::uuid
$$;
```

**Defense in depth en dos capas**:

| Cliente | Aislamiento |
|---|---|
| Worker con `SECRET_KEY` (writes privilegiados) | El Worker pone `tenant_id` explícito en cada insert/update. RLS es secundaria pero queda enabled por si la SECRET key se filtra. |
| PostgREST con `PUBLISHABLE_KEY` (reads desde browser, futuras dashboards) | RLS es la única defensa — el cliente no puede saltarse `WHERE tenant_id = current_tenant_id()`. |
| Realtime WS desde browser | RLS se evalúa con el JWT del usuario en el handshake — el WS sólo recibe filas que pasen la política. |

### 3.4 Theming por tenant

```sql
alter table tenants add column theme jsonb default '{}';
update tenants set theme = jsonb_build_object(
  'primary',    '#7DF9FF',
  'secondary',  '#39FF14',
  'accent',     '#FFD700',
  'background', '#050505'
) where slug = 'lapocha';
```

El `root.loader` mete el `theme` en `useLoaderData()` y `AppFrame`
inyecta CSS custom properties (`--tenant-primary`, etc.) que las
utilidades Tailwind v4 consumen con `bg-(--tenant-primary)/20`. Añadir
una sala con tema propio es 1 fila SQL + 1 CNAME DNS.

### 3.5 Feature flags por tenant

```jsonb
tenants.features = {
  "games":  { "tinder_musical": true, "roulette": false, "flash_drops": true },
  "limits": { "max_vip_users": 100 }
}
```

El frontend lee `tenant.features.games.*` y oculta tiles del Hub
cuando una sala no contrata un módulo. El mismo deploy ejecuta dos
salas con productos distintos sin un cambio de código.

---

## 4. Módulos Core del Usuario (Gamificación y Música)

Esta sección documenta los juegos y la pantalla de TV. Todos
comparten dos patrones:

1. **Identidad** — El user_profile_id viene de
   `resolveTenantProfile(supabase, slug, verified.id)`, que es el
   helper compartido. NUNCA del body.
2. **Atomicidad** — Toda mutación de tokens pasa por un RPC con
   `SELECT FOR UPDATE`; el Worker nunca inserta directamente en
   `wallet_ledger` desde los handlers de juego.

### 4.1 Tinder Musical

**Concepto**: el usuario ve cartas con tracks (cover, título, artista)
y hace swipe-right (like / vote) o swipe-left (skip). Cada like cuenta
como voto en `track_votes`. Al completar 5 swipes recibe +25 tokens
(`tinder_completion`).

#### Tipos de voto

| `vote_type` | Coste | `event_tracks.total_votes` | Cuándo se usa |
|---|---|---|---|
| `free` | 0 tokens | +1 | Swipe-right normal en Tinder Musical |
| `boost` | configurable (Jukebox 50t, LiveBattle 30t) | +5 | Botón "Boost" en Jukebox / Live Battle |

#### Backend: `GET /api/music?event_id=…&mode=swipe`

```ts
// Devuelve unplayed tracks que este usuario NO ha votado todavía
const votedIds = await supabase
  .from("track_votes").select("track_id")
  .eq("event_id", event_id).eq("user_id", user_profile_id);

let query = supabase
  .from("event_tracks")
  .select("id, spotify_id, title, artist, cover_image_url, total_votes, is_played")
  .eq("tenant_id", tenant_id).eq("event_id", event_id).eq("is_played", false);

if (votedIds.length > 0)
  query = query.not("id", "in", `(${votedIds.join(",")})`);

return query.order("total_votes", { ascending: false }).limit(40);
```

#### Backend: `POST /api/music` (voto)

Llama al RPC atómico `vote_track`:

```sql
create or replace function public.vote_track(
  p_tenant_id uuid, p_user_id uuid, p_event_id uuid,
  p_track_id uuid, p_vote_type text default 'free',
  p_tokens_spent int default 0
) returns jsonb language plpgsql security definer ...
as $$
begin
  -- 1. Input validation: free|boost, tokens_spent >= 0, free=>0t
  if p_vote_type not in ('free','boost') then raise exception 'invalid_vote_type'; end if;
  if p_tokens_spent < 0                then raise exception 'negative_tokens'; end if;
  if p_vote_type = 'free' and p_tokens_spent <> 0
                                       then raise exception 'free_votes_must_be_zero_tokens'; end if;

  -- 2. Lock track FOR UPDATE + verificar is_played=false
  select * into v_track from event_tracks
   where id=p_track_id and event_id=p_event_id and tenant_id=p_tenant_id and is_played=false
   for update;
  if not found then raise exception 'track_unavailable'; end if;

  -- 3. Dedupe — UNIQUE (track_id, user_id) es el backstop final
  if exists (select 1 from track_votes where track_id=p_track_id and user_id=p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'already_voted');
  end if;

  -- 4. Si es boost, débito atómico de tokens
  if p_vote_type='boost' and p_tokens_spent > 0 then
    select token_balance into v_balance from user_profiles
      where id=p_user_id and tenant_id=p_tenant_id for update;
    if v_balance < p_tokens_spent then
      return jsonb_build_object('ok', false, 'error', 'insufficient_funds', 'balance', v_balance);
    end if;
    insert into wallet_ledger (tenant_id, user_id, amount, reason, event_id, metadata, campaign_type)
    values (p_tenant_id, p_user_id, -p_tokens_spent, 'vote_boost', p_event_id,
            jsonb_build_object('track_id', p_track_id), 'song_vote');
  end if;

  -- 5. Insertar voto
  insert into track_votes (tenant_id, event_id, track_id, user_id, vote_type, tokens_spent)
  values (p_tenant_id, p_event_id, p_track_id, p_user_id, p_vote_type, p_tokens_spent)
  returning id into v_vote_id;

  -- 6. Bump total_votes (boost=+5, free=+1)
  update event_tracks set total_votes = total_votes
    + case when p_vote_type='boost' then 5 else 1 end
   where id=p_track_id
  returning total_votes into v_track.total_votes;

  return jsonb_build_object('ok', true, 'vote_id', v_vote_id,
                            'total_votes', v_track.total_votes, 'balance', v_balance);
end; $$;

revoke execute on function public.vote_track(uuid,uuid,uuid,uuid,text,int) from public, anon, authenticated;
grant  execute on function public.vote_track(uuid,uuid,uuid,uuid,text,int) to service_role;
```

Mapeo de errores en `lib/music-handler.server.ts`:

| `error` SQL | HTTP | Significado UX |
|---|---|---|
| `track_unavailable` | 409 | Track ya reproducido o no existe |
| `already_voted` | 409 | El usuario ya votó este track |
| `insufficient_funds` | 400 | No tiene tokens para el boost |
| `invalid_vote_type` / `free_votes_must_be_zero_tokens` | 400 | Bug del cliente |
| `negative_tokens` | 400 | Bug del cliente |
| `fk_violation` / `duplicate_key` | 500 / 409 | Llega literal el mensaje raw para que el operador diagnostique sin abrir tail |

### 4.2 Jukebox & Live Battle (consumo de tokens)

| Acción | RPC / endpoint | Coste tokens | `event_tracks.total_votes` |
|---|---|---|---|
| Tinder swipe (vote free) | `vote_track('free', 0)` | 0 | +1 |
| Voto Live Battle | `wallet_ledger insert reason='livebattle_vote'` (+10) | gana +10 | — |
| Boost Live Battle | `vote_track('boost', 30)` | −30 | +5 |
| Pedir canción Jukebox | `wallet_ledger insert reason='jukebox_request'` (+20) | gana +20 | — |
| Boost Jukebox (saltar cola) | `vote_track('boost', 50)` | −50 | +5 |

Los costes y premios viven en `tenant_token_rewards` (ver §5). El
cliente lee `reward_rules` desde `/api/session` y los usa como
single-source-of-truth (en lugar de constantes hardcoded).

### 4.3 Pantallas de TV / DJ — `/tv/music` (Jumbotron)

Pantalla "para el proyector". Página standalone que la sala lanza en
un portátil conectado al HDMI del cañón.

**Diferencias clave con el resto de la app**:

| Propiedad | Valor |
|---|---|
| Auth | Cookie-based (`sb-<projectRef>-auth-token`) parseada en `cookie-auth.server.ts`. **No header Bearer** — un proyector no inyecta tokens. |
| Role required | `tenant_staff.role IN ('display','admin')`. Una cuenta dedicada `tv@lapocha.nightgraph.io` se asigna como `display`. |
| Read-only | Cero `POST` en la página. Si el proyector "vota", es un bug. |
| Realtime | Una sola WS — `supabase.channel('tv:event_tracks:<eventId>').on('postgres_changes', …)` filtrada server-side por `event_id`. **No polling.** |
| SSR-painted | El loader hidrata con el top-20 inicial para que el proyector nunca muestre void si la WS tarda en conectar. |
| Animaciones | GSAP: el ranking re-ordena con `gsap.to(row, { y: idx * 96 })`, contadores con `snap-tween`, pulso ambiental en el líder. |

```ts
// Suscripción WS (frontend)
supabase
  .channel(`tv:event_tracks:${eventId}`)
  .on("postgres_changes",
      { event: "*", schema: "public", table: "event_tracks",
        filter: `event_id=eq.${eventId}` },
      applyDiff)
  .subscribe();
```

El filtro se aplica en el **servidor de Realtime** — el WS sólo
recibe cambios que matchean el evento. Cero over-fetching, cero
filtrado cliente.

**DJ Dashboard** — Un dashboard separado polea `mode=leaderboard`
cada 5s (suficiente para el monitor del DJ). El endpoint exige
`role='dj'` con `hasTenantRole(supabase, tenant_id, auth_user_id,
'dj')`. 403 si no tiene rol.

---

## 5. Economía de Tokens (Wallet & Ledger)

La economía es un **ledger contable append-only**. Cada movimiento
crea una fila; nunca se actualiza ni se borra una fila existente. El
balance de un usuario es la suma del ledger; pero no la calculamos en
cada lectura — la materializamos en `user_profiles` vía trigger
(CQRS).

### 5.1 Cómo NACEN los tokens

Cada premio configurado en **`tenant_token_rewards`** (introducido en
`08c_economy_and_fixes.sql`):

```sql
create table public.tenant_token_rewards (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  event_code  text not null,
  amount      int  not null,             -- + gana, − gasta
  description text not null,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, event_code)
);
```

Seed para `lapocha` (de `08d_pilot_friday_ready.sql`, alineado con
`BRONCE.pdf`):

| `event_code` | `amount` | Descripción | Disparado por |
|---|---:|---|---|
| `signup_bonus` | **+100** | Regalo de bienvenida al registrarte | JIT `grant_signup_bonus` |
| `checkin_la_pocha` | +50 | Check-in en La Pocha | QR físico de entrada (ver §7.1) |
| `ruleta_spin` | +15 | Premio fijo por girar la ruleta | Botón "Girar" → wallet earn |
| `tinder_completion` | +25 | Completar 5 swipes en Tinder Musical | Cliente al cerrar el deck |
| `tinder_vote_free` | 0 | Voto libre Tinder (sin coste) | `vote_track('free')` |
| `livebattle_vote` | +10 | Voto en batalla de temas | wallet earn |
| `jukebox_request` | +20 | Pedir canción al DJ (gratis) | wallet earn |
| `jukebox_boost` | **−50** | Boost en Jukebox | `vote_track('boost', 50)` |
| `livebattle_boost` | **−30** | Boost en Live Battle | `vote_track('boost', 30)` |
| `reto_mesa` | +40 | Participar en reto de mesa | wallet earn manual del camarero |
| `friend_referral` | +100 | Amigo registrado que invitaste | RRPP / referral (futuro pipeline) |

**Reglas críticas**:
- **El cliente NUNCA decide cuántos tokens ganar** — sólo dispara
  `event_code` y el handler busca el `amount` en `tenant_token_rewards`.
  Si el negocio quiere subir el premio de la Ruleta de 15 a 25, lo
  cambia en SQL y los siguientes spins lo cogen sin redeploy.
- **`amount` negativo** representa coste — `tenant_token_rewards`
  unifica premio y coste en una sola tabla; las RPCs llaman al code
  apropiado.

### 5.2 Cómo se GASTAN los tokens

Tres caminos atómicos, todos con `SELECT FOR UPDATE` server-side:

1. **`spend_tokens`** (genérico) — usado por `/api/wallet` para
   gastos arbitrarios (rondas, retos manuales). Devuelve nuevo
   balance o `NULL` si overdraft.
2. **`vote_track('boost', N)`** — usado por Jukebox / Live Battle /
   Tinder Boost. Hace débito + insert de voto + bump de
   `total_votes` en una sola transacción.
3. **`purchase_reward(product_id, event_id)`** — usado por el
   catálogo (Secret Menu). Valida tier, día, límites, saldo, y crea
   el `user_rewards` row (ver §6).

Cada uno asienta una fila en `wallet_ledger` con `amount` negativo y
un `reason` semántico (`reward_purchase`, `vote_boost`, etc.). El
trigger se encarga de mantener `user_profiles.token_balance` al día.

### 5.3 CQRS: ledger append-only + projection materializada

```
                                wallet_ledger
                                 (append-only)
                                       │
                                       │ trigger
                                       │ AFTER INSERT
                                       ▼
                          user_profiles.token_balance      (= sum(amount))
                          user_profiles.lifetime_earned    (= sum(greatest(amount,0)))
```

Trigger SECURITY DEFINER con `search_path` pinneado para que pueda
cruzar RLS sin ser un attack surface:

```sql
create or replace function public.update_user_token_balance()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.user_profiles
  set token_balance   = token_balance   + new.amount,
      lifetime_earned = lifetime_earned + greatest(new.amount, 0)
  where id = new.user_id;
  return new;
end;
$$;

create trigger wallet_ledger_after_insert
  after insert on public.wallet_ledger
  for each row execute function public.update_user_token_balance();
```

**Garantías**:
- **`token_balance` siempre refleja `SUM(amount)`** del ledger del
  usuario.
- **`lifetime_earned` sólo crece** — los spends no la mueven, por eso
  funciona como base de los tiers (§6.2).
- **Lectura O(1)** — el Hub, el leaderboard y los tier locks NO suman
  el ledger; leen la projection directamente.

### 5.4 Integridad financiera del RPC genérico `spend_tokens`

```sql
create or replace function public.spend_tokens(
  p_tenant_id uuid, p_user_id uuid, p_amount int,
  p_reason text, p_metadata jsonb default '{}'::jsonb
) returns int language plpgsql security definer set search_path = public
as $$
declare v_balance int;
begin
  if p_amount >= 0 then raise exception 'spend_tokens expects negative, got %', p_amount; end if;

  select token_balance into v_balance from user_profiles
    where id = p_user_id and tenant_id = p_tenant_id for update;
  if v_balance is null then raise exception 'profile not found'; end if;

  if v_balance + p_amount < 0 then return null; end if;   -- caller treats NULL = insufficient

  insert into wallet_ledger (tenant_id, user_id, amount, reason, metadata)
  values (p_tenant_id, p_user_id, p_amount, p_reason, p_metadata);

  select token_balance into v_balance from user_profiles where id = p_user_id;
  return v_balance;
end;
$$;

revoke execute on function public.spend_tokens(uuid,uuid,int,text,jsonb) from public, anon, authenticated;
grant  execute on function public.spend_tokens(uuid,uuid,int,text,jsonb) to service_role;
```

Propiedades clave:
- **`SELECT FOR UPDATE`** elimina TOCTOU: dos clientes intentando
  gastar el último token en paralelo se serializan en el row-lock; el
  segundo verá el balance reducido y devolverá `NULL`.
- **Bound by `tenant_id`** — la query exige que la fila pertenezca al
  tenant correcto; aunque el caller manipulara `p_user_id`, no podría
  drenar tokens de otra sala.
- **Lockdown a `service_role`** — REVOKE PUBLIC/anon/authenticated +
  GRANT service_role. Imposible llamarlo directo desde el navegador
  con la publishable key.

### 5.5 Endpoint `/api/wallet`

| Método | POST |
|---|---|
| Auth | Bearer JWT obligatorio (401 si no) |
| Body | `{ tenant_slug?, amount: int, reason: string, metadata? }` |
| Bounds | `[-10_000, +10_000]`, non-zero, integer |
| Spend (`amount < 0`) | `rpc('spend_tokens', …)`; NULL → 400 `insufficient_funds` |
| Earn (`amount > 0`) | INSERT directo (los créditos no overdraft); el trigger sincroniza projection |

Response unificada: `{ ok, amount, reason, balance, lifetime_earned }`.

### 5.6 Endpoint `/api/history`

Cursor-based pagination sobre `wallet_ledger`:

```
GET /api/history?limit=50&before=<iso-created_at>
```

Devuelve filas con **snapshot intacto** (`product_name_at_time`,
`price_tokens_at_time`, `campaign_type`) para que la UI muestre "Copa
Nacional 6€ — Plata · 700t" aunque el producto se haya renombrado
después de la compra. Esto es la **diferencia entre un ledger y una
hoja de cálculo**: el pasado no se mueve.

---

## 6. Catálogo y Secret Menu

El catálogo es **per-tenant** y vive en `tenant_products`. La regla
estrella es: **toda visibilidad y validación es por contrato SQL** —
el cliente puede deshabilitar items en la UI por UX, pero el servidor
re-valida en cada `purchase_reward`. Defense in depth.

### 6.1 Esquema de `tenant_products`

```sql
create table public.tenant_products (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  product_type       text not null check (product_type in ('drink','reward','game_ticket','vip_access')),
  name               text not null,
  price_tokens       int  not null,
  reference_fiat     numeric(10,2),         -- INFORMATIVO (lo que cobra el camarero)
  is_active          boolean not null default true,

  -- Reglas de visibilidad (añadidas en 08_loyalty_and_tiers.sql)
  min_tier_required  text     check (min_tier_required in ('bronce','plata','oro','platino') or min_tier_required is null),
  available_days     smallint[],            -- ISO 1=Mon..7=Sun. NULL = todos los días.
  max_per_night      smallint,              -- por business_night
  max_per_week       smallint,              -- rolling 7d
  max_per_month      smallint,              -- rolling 30d
  created_at         timestamptz default now()
);
```

### 6.2 Tiers de fidelidad

```sql
create table public.tenant_tier_thresholds (
  tenant_id      uuid not null references tenants(id) on delete cascade,
  tier_code      text not null check (tier_code in ('bronce','plata','oro','platino')),
  min_lifetime   int  not null check (min_lifetime >= 0),
  display_name   text not null,
  color_primary  text not null,
  color_accent   text not null,
  badge_emoji    text,
  sort_order     smallint not null,
  primary key (tenant_id, tier_code)
);
```

Seed para `lapocha`:

| Tier | `min_lifetime` | Badge | Color | Tokens necesarios |
|---|---:|---|---|---|
| **Bronce** | 0 | 🥉 | `#CD7F32` | Inicio |
| **Plata** | 500 | 🥈 | `#C0C0C0` | 500 lifetime |
| **Oro** | 1500 | 🥇 | `#FFD700` | 1500 lifetime |
| **Platino** | 4000 | 💎 | `#E5E4E2` | 4000 lifetime |

`lifetime_earned` (no `token_balance`) determina el tier — gastar
NO te baja de nivel.

Helper SQL:

```sql
create or replace function public.get_user_tier(
  p_tenant_id uuid, p_lifetime_earned int
) returns text language sql stable security definer set search_path = public
as $$
  select tier_code from public.tenant_tier_thresholds
  where tenant_id = p_tenant_id and min_lifetime <= coalesce(p_lifetime_earned, 0)
  order by sort_order desc limit 1
$$;
```

### 6.3 Reglas de visibilidad y bloqueo

| Campo | Significado | Ejemplo La Pocha |
|---|---|---|
| `min_tier_required` | Tier mínimo para verlo / comprarlo | `'plata'` → Bronces lo ven bloqueado |
| `available_days` | ISO weekday Europe/Madrid (1=Lun..7=Dom) | `[2,3,4,5,6]` Mar-Sáb |
| `max_per_night` | Por `business_night(now())` | `1` para "1 chupito por noche" |
| `max_per_week` | Rolling 7d (`created_at >= now() - 7 days`) | `3` |
| `max_per_month` | Rolling 30d | `2` |

**`business_night(p_ts)`** define "una misma noche" como el bloque
06:00→06:00 de Madrid:

```sql
create or replace function public.business_night(p_ts timestamptz)
returns date language sql immutable as $$
  select (((p_ts at time zone 'Europe/Madrid') - interval '6 hours')::date)
$$;
```

→ Canjear a las 23:00 del sábado y a las 02:00 del domingo cuenta
como **la misma noche**. Indispensable para que "1 por noche" tenga
sentido humano en hora de discoteca.

#### 6.3.1 Endpoint `/api/catalog`

`GET /api/catalog` devuelve todos los productos `is_active=true` del
tenant con **todas las columnas de reglas**, ordenados por
`price_tokens ASC`. El cliente decide cómo renderizar (bloqueado por
tier, por día, por límite alcanzado). El servidor re-valida igual al
comprar — UI hints, no autorización.

### 6.4 `purchase_reward` — la cadena de validación

Cuando el usuario tap-a "Canjear" en el Secret Menu, el cliente llama
`POST /api/rewards { action_type: 'purchase', product_id, event_id }`
y el handler invoca el RPC. **Cadena en orden — el primer fallo
aborta**:

```
(1) Producto existe + is_active + tenant correcto       → "Producto no encontrado"
(2) Lock FOR UPDATE del user_profile                    → "Perfil no encontrado"
(3) Tier mínimo (si min_tier_required NOT NULL)         → "Nivel insuficiente: requiere X, tienes Y"
(4) ISO weekday Madrid ∈ available_days                 → "Producto no disponible hoy (ISO dow = N)"
(5) Count user_rewards business_night ≤ max_per_night   → "Límite por noche alcanzado (X de Y)"
(6) Count user_rewards rolling 7d ≤ max_per_week        → "Límite semanal alcanzado"
(7) Count user_rewards rolling 30d ≤ max_per_month      → "Límite mensual alcanzado"
(8) token_balance ≥ price_tokens                        → "Saldo insuficiente"
─────────────────────────────────────────────────────────────────────
(9) INSERT wallet_ledger amount=-price_tokens reason='reward_purchase'
    + snapshot product_name_at_time + price_tokens_at_time
(10) INSERT user_rewards status='available' RETURNING id
(11) RETURN { reward_id, new_balance, product_name }
```

Los mensajes de excepción están deliberadamente alineados con los
`msg.includes(…)` que `api.rewards.ts` mapea a errores semánticos:

| Mensaje SQL (substring) | `error` JSON | HTTP |
|---|---|---|
| "saldo" | `insufficient_funds` | 400 |
| "perfil" | `profile_not_found` | 404 |
| "nivel insuficiente" | `tier_required` | 403 |
| "no disponible hoy" | `product_wrong_day` | 400 |
| "límite por noche" | `night_limit_reached` | 429 |
| "límite semanal" | `week_limit_reached` | 429 |
| "límite mensual" | `month_limit_reached` | 429 |
| "producto" | `product_unavailable` | 404 |

### 6.5 Canjeo (start_reward_redemption) + Self-Redemption Visual

Cuando el usuario presenta el reward en barra:

```
POST /api/rewards { action_type: 'redeem', reward_id }
   ↓
rpc('start_reward_redemption', ...)
   ↓
UPDATE user_rewards
   SET status = 'redeeming',
       redeemed_at = now(),
       expires_at  = now() + interval '5 minutes'
 WHERE id = p_reward_id AND status = 'available'    -- idempotency-safe
   ↓
Devuelve { expires_at }
   ↓
Cliente abre RedemptionScreen.tsx (overlay full-screen):
  · Background wave GSAP (linear-gradient con backgroundPosition animado)
  · Pulsating short-code 6 chars (derivado del UUID, opacity 0.45 yoyo)
  · Conic ring rotación continua 18s
  · Countdown MM:SS basado en (expires_at - now())
  · onExpire → tearDown overlay
```

**Anti-screenshot por diseño**: un screenshot es por definición
estático. Las tres animaciones simultáneas hacen obvio al camarero
que la pantalla está viva. Si el usuario intenta enseñar una foto
hecha minutos antes, el countdown no avanza, el wave no se mueve, el
ring no rota — al camarero le saltan tres alertas visuales a la vez.

---

## 7. Flujos de QR (El puente Físico ↔ Digital)

Nightgraph está diseñado para **resolver el gap físico-digital del
ocio nocturno**. El producto se sienta sobre tres familias de QR
claramente diferenciadas. Algunas están implementadas, otras vivirán
sobre la misma infraestructura `tracking_campaigns` ya desplegada.

### 7.1 QR de Check-in (ganar puntos al entrar / por zonas)

**Caso de uso**: Pegatinas en la entrada, en el baño VIP, en mesas
premium. El usuario escanea con la cámara nativa, aterriza en
`https://lapocha.nightgraph.io/?ref=BATHROOM_VIP`, y gana **+50
tokens** (`checkin_la_pocha` en `tenant_token_rewards`).

**Infraestructura compartida con atribución** — usamos
`tracking_campaigns` como tabla universal de "¿de dónde viene este
usuario?". Cada QR es una fila:

```sql
create table public.tracking_campaigns (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  code          text not null,                       -- 'BATHROOM_VIP', 'ENTRADA_PRINCIPAL'
  campaign_type text not null check (campaign_type in ('location','promoter','game','social','paid_ads')),
  metadata      jsonb default '{}'::jsonb,           -- { "label":"QR baño VIP", "placement":"restroom_door" }
  is_active     boolean default true,
  unique (tenant_id, code)
);
```

Seed (`07_growth_and_realtime.sql`):

```sql
('BATHROOM_VIP', 'location', '{"label":"QR baño VIP","placement":"restroom_door"}'),
('JUAN_RRPP',    'promoter', '{"label":"WhatsApp Juan RRPP"}'),
('TINDER_SHARE', 'game',     '{"label":"Compartir Tinder Musical"}')
```

#### Flujo end-to-end

```
┌──────────────────────────┐
│ 1. Usuario escanea QR    │
│    /?ref=BATHROOM_VIP    │
└──────────────┬───────────┘
               ▼
┌─────────────────────────────────────────────────┐
│ 2. root.loader (Cloudflare Worker)             │
│    · Lee ?ref del query string                 │
│    · Set-Cookie ng_tracking_ref=BATHROOM_VIP   │
│       Max-Age=86400 HttpOnly SameSite=Lax      │
│    · 303 redirect a URL limpia                 │
└──────────────┬─────────────────────────────────┘
               ▼
┌──────────────────────────┐
│ 3. Si no autenticado:    │
│    Onboarding → Google   │
│    Si autenticado:       │
│    Sigue a la app        │
└──────────────┬───────────┘
               ▼
┌─────────────────────────────────────────────────┐
│ 4. Tras SIGNED_IN, /api/auth-sync             │
│    · Lee Cookie ng_tracking_ref=BATHROOM_VIP   │
│    · resolve_tracking_campaign(tenant, code)   │
│    · INSERT user_profiles                      │
│         acquisition_campaign_id = <uuid>       │
│    · Set-Cookie ng_tracking_ref=; Max-Age=0    │
└──────────────┬─────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────┐
│ 5. Reward de check-in (FUTURO — wire pending):│
│    POST /api/wallet                            │
│    { amount: 50, reason: 'checkin_la_pocha', │
│      metadata: { campaign_code: 'BATHROOM_VIP'}}│
│    El amount viene de tenant_token_rewards    │
└─────────────────────────────────────────────────┘
```

**Bermuda Triangle del OAuth**: el cookie HttpOnly sobrevive la
redirección a Google y vuelve con la sesión. El frontend nunca lo lee
(HttpOnly), el Worker lo lee server-side en `/api/auth-sync` y lo
consume escribiendo `Set-Cookie ng_tracking_ref=; Max-Age=0`.
**Atribución once-and-done**: si el usuario es un perfil existente,
sólo PATCHeamos `acquisition_campaign_id` cuando era NULL (no se
re-atribuye un usuario mid-relationship).

**Resolver SQL** — `SECURITY DEFINER stable`:

```sql
create or replace function public.resolve_tracking_campaign(
  p_tenant_id uuid, p_code text
) returns uuid language sql stable security definer set search_path = public
as $$
  select id from tracking_campaigns
  where tenant_id = p_tenant_id and is_active and code = upper(trim(p_code))
  limit 1
$$;
```

→ Codes case-insensitive por construcción.

### 7.2 QR de Promotores (RRPP / referidos)

**Caso de uso**: Juan (RRPP) reparte tarjetas con QR
`https://lapocha.nightgraph.io/?ref=JUAN_RRPP`. Cada usuario que
entra por su QR queda **atribuido a Juan para siempre**, y Juan cobra
comisión por cada acción downstream.

Misma infraestructura que §7.1 (`tracking_campaigns` con
`campaign_type='promoter'`). Pero con tabla extra para la mecánica de
comisiones:

```sql
create table public.promoter_codes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  staff_id           uuid not null references tenant_staff(id) on delete cascade,
  code               text not null unique,
  commission_tokens  int default 0,             -- premio fijo al RRPP por nuevo signup
  commission_percent numeric(5,2) default 0.00, -- % sobre las compras del referido
  created_at         timestamptz default now()
);
```

`wallet_ledger` lleva una columna `promoter_code_id` FK para
**trazabilidad financiera**: cada vez que el referido compra algo, el
ledger guarda el RRPP que lo atrajo, y un job nocturno (futuro)
acumula las comisiones a pagar.

```sql
alter table public.wallet_ledger
  add column promoter_code_id uuid references promoter_codes(id),
  add column campaign_type    text;   -- 'flash_drop', 'tinder_musical', 'song_vote', etc.
```

### 7.3 QR de Canjeo en barra (validación de consumiciones)

**Caso de uso**: El usuario muestra al camarero un reward `redeeming`
en su pantalla. El camarero NO necesita confiar en un screenshot —
hay tres capas de validación:

#### Capa 1 — Visual (anti-screenshot, ver §6.5)
Wave continuo + countdown live + conic ring rotando. Un screenshot
está visualmente muerto.

#### Capa 2 — Short-code rotativo
El UUID del reward se proyecta a un código corto de 6 caracteres
visible en la pantalla del usuario. El camarero puede pedirle al
usuario que lo lea en voz alta y compararlo con el panel de barra.

#### Capa 3 — QR de barra (planteado, no implementado aún)
**Arquitectura propuesta**:

```
┌─────────────────────────────────────────────┐
│ Pantalla del cliente (RedemptionScreen):    │
│  - Wave anti-screenshot                     │
│  - Countdown 04:32                          │
│  - QR generado en runtime con el reward_id  │
│    + un HMAC time-bound (refrescado cada 5s)│
└──────────────────────┬──────────────────────┘
                       │ Camarero escanea con tablet de barra
                       ▼
┌─────────────────────────────────────────────┐
│ POST /api/rewards { action_type:'consume',  │
│                     reward_id, hmac }       │
│  · Tablet auth-ed como staff (role='bar')   │
│  · RPC consume_reward(p_reward_id, p_hmac)  │
│    - Verifica HMAC contra reward_id+tenant  │
│    - UPDATE status='consumed' WHERE         │
│        status='redeeming' AND expires_at>now│
│    - Devuelve confirmación al camarero      │
└─────────────────────────────────────────────┘
```

Estados terminales en `user_rewards.status`:

| Estado | Significado |
|---|---|
| `available` | Comprado, listo para canjear |
| `redeeming` | Mostrado al camarero, 5 min para consumirlo |
| `consumed` | Camarero validó el canjeo (TODO: wire backend) |
| `expired` | `expires_at` pasó sin consumir (TODO: reaper job) |

**Reaper** (deuda explícita §13): un `pg_cron` que cada minuto haga
`UPDATE user_rewards SET status='expired' WHERE status='redeeming'
AND expires_at < now()`.

### 7.4 Tabla resumen de QR

| QR | URL | Acción server-side | Reward usuario | Trazabilidad |
|---|---|---|---|---|
| **Check-in entrada** | `/?ref=ENTRADA_PRINCIPAL` | `tracking_campaigns` + atribución | +50t `checkin_la_pocha` | `acquisition_campaign_id` |
| **Check-in zona** | `/?ref=BATHROOM_VIP` | idem | +50t (o variable) | idem |
| **Promotor RRPP** | `/?ref=JUAN_RRPP` | idem + `promoter_codes` | +100t `friend_referral` (futuro) | `promoter_code_id` en ledger |
| **Compartir Tinder** | `/?ref=TINDER_SHARE` | idem | bonus viral | idem |
| **Canjeo barra** | QR generado en RedemptionScreen | `consume_reward(reward_id, hmac)` (futuro) | — | `user_rewards.status='consumed'` |

---

## 8. Esquema de Base de Datos y RLS

Esta sección documenta el modelo de datos completo y el contrato de
seguridad. Las migraciones viven en [database/](database/) y se
ejecutan en orden numérico.

### 8.1 Migraciones (orden de ejecución)

```
database/schema.sql                   # core schema + RLS + JWT helper
database/02_production_ready.sql      # CQRS, trigger, spend_tokens, auth_user_id
database/03_secure_rpc.sql            # REVOKE PUBLIC / GRANT service_role
database/04_tenant_theme.sql          # theme jsonb + Kapital demo
database/05_scalability_ready.sql     # NIGHTGRAPH: promoters, products, staff, events, audit
database/06_music_rpc.sql             # vote_track RPC + DJ leaderboard view
database/07_growth_and_realtime.sql   # tracking_campaigns + Realtime publication + display role
database/08_loyalty_and_tiers.sql     # tier_thresholds + product rules + business_night + purchase_reward v2
database/08b_seed_lapocha_data.sql    # catálogo real (Bronce/Plata/Oro/Platino) + evento piloto + tracks
database/08c_economy_and_fixes.sql    # tenant_token_rewards + spotify_id canónicos
database/08d_pilot_friday_ready.sql   # CHECK vote_type, economía BRONZE.pdf, welcome bonus 100t
```

Cada archivo es **idempotente** (`create … if not exists`, `add
column if not exists`, `do $$ … if not exists … $$`, `on conflict`).
Re-ejecutar es seguro.

### 8.2 Resumen de tablas clave

#### Identidad

| Tabla | PK | Notas |
|---|---|---|
| `tenants` | `id uuid` | `slug unique`, `theme jsonb`, `features jsonb`, `promoter_id` |
| `user_profiles` | `id uuid` | `tenant_id`, `email`, `auth_user_id uuid` (FK virtual a `auth.users`), `token_balance`, `lifetime_earned`, `acquisition_campaign_id` |
| `promoters` | `id uuid` | Grupo empresarial multi-sala |
| `tenant_staff` | `id uuid` | `(tenant_id, user_id)` UNIQUE, `role admin\|manager\|door\|bar\|dj\|promoter\|display` |

#### Económico

| Tabla | PK | Notas |
|---|---|---|
| `tenant_products` | `id uuid` | + reglas `min_tier_required`, `available_days`, `max_per_night/week/month` |
| `tenant_tier_thresholds` | `(tenant_id, tier_code)` | Bronce/Plata/Oro/Platino + `min_lifetime` |
| `tenant_token_rewards` | `(tenant_id, event_code)` | Economía externalizada — single source of truth de premios y costes |
| `wallet_ledger` | `id bigserial` | Append-only. Snapshot `product_name_at_time`, `price_tokens_at_time`, `event_id`, `product_id`, `promoter_code_id`, `campaign_type` |
| `user_rewards` | `id uuid` | `status available\|redeeming\|consumed\|expired`, `redeemed_at`, `expires_at` |

#### Musical

| Tabla | PK | Notas |
|---|---|---|
| `tenant_events` | `id uuid` | Sesión / noche temática, `status draft\|active\|closed` |
| `event_tracks` | `id uuid` | `spotify_id`, `title`, `artist`, `cover_image_url`, `total_votes int (CQRS)`, `is_played` |
| `track_votes` | `id uuid` | `vote_type free\|boost`, `tokens_spent`. UNIQUE `(track_id, user_id)` |

#### Crecimiento & analítica

| Tabla | PK | Notas |
|---|---|---|
| `venue_visits` | `id uuid` | Cohortes de retención semanal |
| `behavior_events` | `id bigserial` | Append-only, `metadata jsonb GIN-indexed` |
| `tracking_campaigns` | `id uuid` | `code unique per tenant`, `campaign_type location\|promoter\|game\|social\|paid_ads` |
| `promoter_codes` | `id uuid` | RRPP referrals con comisión |
| `audit_logs` | `id uuid` | Tamper-evident: `actor_id`, `action`, `table_name`, `record_id`, `old_data`, `new_data`, `ip_address` |

### 8.3 Foreign Keys CRÍTICAS — `user_profiles(id)` NO `auth.users`

**Este es el cambio arquitectónico más importante de la última
iteración**: todas las FK críticas (`wallet_ledger.user_id`,
`venue_visits.user_id`, `behavior_events.user_id`,
`track_votes.user_id`, `user_rewards.user_id`) **apuntan a
`user_profiles(id)`**, no a `auth.users(id)`.

**Por qué importa**:

```
auth.users (Supabase Auth)
   ↑
   │ NO FK directa
   │
user_profiles  ←──────────────── wallet_ledger.user_id
   ↑                              venue_visits.user_id
   │ auth_user_id (link blando)   behavior_events.user_id
   │                              track_votes.user_id
   │                              user_rewards.user_id
auth.users                        promoter_codes.staff_id → tenant_staff.id → auth.users
```

| Decisión | Por qué |
|---|---|
| **Tablas de negocio apuntan a `user_profiles(id)`** | Nuestra unidad de identidad **multi-tenant** es `user_profiles`, no `auth.users`. Un mismo `auth.users` puede tener N `user_profiles` (uno por tenant donde haya entrado). |
| **`user_profiles.auth_user_id` es un link blando** | Sin FK formal en algunos seeds (los user_profiles demo seedeados tienen `auth_user_id=NULL`). Partial UNIQUE index `WHERE auth_user_id IS NOT NULL`. |
| **Sólo `tenant_staff` y `audit_logs` apuntan a `auth.users(id)` directo** | Porque son tablas administrativas que sólo existen cuando hay un humano real autenticado; no hay "staff demo" sin cuenta. |

**Beneficios concretos**:

1. **El JIT no rompe FKs** — Al crear `user_profiles` con
   `auth_user_id=<uuid del JWT>`, no necesitamos verificar antes que
   exista el row en `auth.users` (existe por definición, pero no se
   chequea FK).
2. **Cross-tenant clean** — Un usuario que sale de `lapocha` y entra
   en `kapital` tiene dos `user_profiles` distintos con dos ledgers
   distintos. Los movimientos en una sala nunca contaminan la otra.
3. **El reaper de auth.users no destruye historia** — Si Supabase
   alguna vez purga un `auth.users` (raro pero posible: GDPR
   delete-account), nuestra historia financiera (ledger, votos,
   rewards) sobrevive porque NO tiene `ON DELETE CASCADE` desde
   `auth.users`.

### 8.4 RLS — patrón canónico y `current_tenant_id()`

Toda tabla con `tenant_id` lleva RLS habilitada y tres políticas
estándar:

```sql
alter table public.<tabla> enable row level security;

create policy <tabla>_tenant_read on public.<tabla>
  for select using (tenant_id = public.current_tenant_id());

create policy <tabla>_tenant_write on public.<tabla>
  for insert with check (tenant_id = public.current_tenant_id());

create policy <tabla>_tenant_update on public.<tabla>
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
```

Helper crítico:

```sql
create or replace function public.current_tenant_id() returns uuid
language sql stable as $$
  select nullif(
    current_setting('request.jwt.claims', true)::json->>'tenant_id',
    ''
  )::uuid
$$;
```

**Lee el claim custom `tenant_id` del JWT** que PostgREST inyecta en
la sesión. Cuando el cliente es:

| Cliente | Comportamiento |
|---|---|
| `SUPABASE_PUBLISHABLE_KEY` con JWT del usuario | RLS aísla por tenant del usuario |
| `SUPABASE_SECRET_KEY` (service_role) | **Bypassea RLS** — el Worker es el actor confiable que SIEMPRE pone `tenant_id` explícito |
| Realtime WS con JWT del usuario | Idéntico a publishable — RLS evalúa cada cambio de fila |

**Importante** — Los JWT de Supabase Auth NO incluyen `tenant_id`
custom claim por defecto (porque nuestra tenancy vive en `public.*`,
no en `auth.*`). En la práctica, eso significa:

- Las llamadas anónimas con `PUBLISHABLE_KEY` que pasan por RLS
  obtendrán `current_tenant_id() = NULL` y verán cero filas. **Es el
  comportamiento deseado**: las lecturas privilegiadas pasan siempre
  por el Worker con `SECRET_KEY`.
- Si en futuro queremos abrir dashboards directo PostgREST → browser,
  añadiremos el custom claim `tenant_id` vía un hook de auth de
  Supabase o un Edge Function que firme un JWT custom. Por ahora,
  defense in depth.

### 8.5 Lockdown de RPCs (SECURITY DEFINER funnel)

Cada RPC que toca dinero / fidelidad / votos sigue el mismo patrón:

```sql
-- 1. Función SECURITY DEFINER con search_path pinneado
create or replace function public.<rpc_name>(...) returns ...
language plpgsql security definer set search_path = public as $$
  -- 2. Validaciones + SELECT FOR UPDATE + INSERTs en una sola transacción
$$;

-- 3. REVOKE público + GRANT exclusivo a service_role
revoke execute on function public.<rpc_name>(...) from public, anon, authenticated;
grant  execute on function public.<rpc_name>(...) to service_role;
```

Inventario:

| RPC | Locked down | Caller único |
|---|---|---|
| `spend_tokens(tenant, user, amount, reason, metadata)` | ✅ | `/api/wallet` |
| `purchase_reward(tenant, user, product, event)` | ✅ | `/api/rewards` |
| `start_reward_redemption(tenant, user, reward)` | ✅ | `/api/rewards` |
| `vote_track(tenant, user, event, track, type, tokens)` | ✅ | `/api/music` |
| `grant_signup_bonus(user)` | ✅ | `/api/session` (JIT) |
| `get_user_tier(tenant, lifetime)` | ✅ | `/api/session` |
| `resolve_tracking_campaign(tenant, code)` | (planeado) | `/api/auth-sync` |
| `business_night(ts)` | público (immutable, sin secretos) | cualquier RPC |
| `tracks_voted_by(event, user)` | ✅ | `/api/music` (dedupe) |
| `update_user_token_balance()` | ✅ | trigger sólo |
| `tenant_id_by_slug(slug)` | público (sólo lectura de slugs públicos) | Worker fallback |

→ Aunque la `PUBLISHABLE_KEY` se filtre, ningún cliente puede mover
tokens, crear rewards, ni votar fuera del flujo del Worker autenticado.

### 8.6 Indexing strategy (read-pattern driven)

| Index | Propósito |
|---|---|
| `behavior_events (tenant_id, event_category, created_at DESC)` | Timeline por categoría |
| `behavior_events USING gin (metadata)` | Filtros `metadata->>'song_id' = …` |
| `venue_visits (tenant_id, entry_time DESC)` | Cohortes de retención |
| `wallet_ledger (tenant_id, created_at DESC)` | Timeline financiero |
| `wallet_ledger (tenant_id, event_id, created_at)` | Dashboards B2B por evento |
| `user_profiles (tenant_id, lifetime_earned DESC)` | Leaderboard O(1) |
| `user_profiles (auth_user_id) WHERE NOT NULL` | Lookup JIT (partial UNIQUE) |
| `user_profiles (tenant_id, acquisition_campaign_id) WHERE NOT NULL` | Cohorts de atribución |
| `track_votes UNIQUE (track_id, user_id)` | Backstop dedupe |
| `tenant_products (tenant_id, min_tier_required) WHERE is_active` | Catálogo filtrado por tier |
| `tenant_token_rewards (tenant_id) WHERE is_active` | Lookup económico rápido |
| `tracking_campaigns (tenant_id, code) WHERE is_active` | Resolver de cookies |

### 8.7 Realtime publication

```sql
alter publication supabase_realtime add table public.event_tracks;
alter publication supabase_realtime add table public.behavior_events;
```

→ El servidor de Realtime emite `INSERT/UPDATE/DELETE` de estas
tablas sobre el canal `supabase_realtime`. Los clientes
(`/tv/music`, futuro DJ dashboard) suscriben con filtros server-side
`event_id=eq.<uuid>`. Autorización vía RLS evaluada con el JWT del
handshake.

---

## 9. Decisiones arquitectónicas críticas (decision log)

| Decisión | Razón |
|---|---|
| **ES256 verify local en Worker** (no `getUser` round-trip) | Eliminó los 401 intermitentes de cold-start. La clave pública en el Worker no compromete la firma. |
| **JIT user_profiles con SECRET KEY** | Resuelve el catch-22 de RLS sin claim `tenant_id` en el JWT. Defense in depth en el Worker. |
| **`tenant_token_rewards` (no constantes hardcoded)** | El negocio ajusta premios sin redeploy. Welcome bonus pasó de 0 → 100 sin tocar código. |
| **FKs a `user_profiles(id)` no `auth.users`** | Identidad multi-tenant. Un humano = N perfiles (uno por sala). Sobrevive a GDPR deletes en `auth.users`. |
| **CQRS ledger + projection** | Append-only audit + O(1) reads. El trigger garantiza consistencia by construction. |
| **Service-role-only RPCs** | TOCTOU bloqueado en SQL. Aunque la publishable key se filtre, no se mueve un token. |
| **`available_days` ISO weekday Madrid** | El negocio piensa en "Martes-Sábado". Mapeo natural a `[2,3,4,5,6]`. `business_night` cubre el cruce medianoche. |
| **`tracking_campaigns` universal** | Un único embudo para QRs, RRPP, social, paid ads. La forma del cookie es la misma para todos. |
| **`detectSessionInUrl: false` + callback manual** | Evita que supabase-js consuma el `code_verifier` antes de tiempo. Auth bug-free. |
| **`localStorage` para Supabase Auth (no cookie SSO)** | El adaptador cookie "evaporaba" la sesión en CF Workers. El SSO cross-subdomain queda como deuda explícita Fase 2. |
| **No polling en Jumbotron** | Realtime WS + RLS server-side. Sostenible para N proyectores en M salas. |

---

## 10. Runbook operacional

### 10.1 Añadir un nuevo tenant

```sql
insert into tenants (slug, name, status, theme, features) values
  ('coliseum', 'Coliseum BCN', 'active',
   jsonb_build_object('primary','#FFD700','secondary','#FF3CAC','accent','#39FF14','background','#0A0A0A'),
   jsonb_build_object('games', jsonb_build_object('tinder_musical', true)));

-- Tier thresholds (idem que lapocha o custom)
insert into tenant_tier_thresholds (tenant_id, tier_code, min_lifetime, …)
  select id, 'bronce', 0, … from tenants where slug = 'coliseum';

-- Economía
insert into tenant_token_rewards (tenant_id, event_code, amount, description)
  select id, 'signup_bonus', 100, '…' from tenants where slug = 'coliseum';
```

Cloudflare DNS: añadir `coliseum.nightgraph.io` CNAME al Worker.
Supabase Auth → URL Configuration: añadir el origin a redirect URLs.
**No hay cambio de código.**

### 10.2 Rotar la SECRET KEY

```
wrangler secret put SUPABASE_SECRET_KEY
# (pega la nueva key cuando Cloudflare la pida)
```

Revocar la vieja en Supabase. Zero downtime — los Workers releen la
secret en la siguiente request.

### 10.3 Diagnosticar un 401 en `/api/session`

1. Mirar logs CF Dashboard → Workers → Logs y filtrar `[AUTH VERIFY]`.
2. Cruzar el `payload.error` con la tabla §2.2.3.
3. Si es `JWT_PUBLIC_KEY_MISSING`: configurar `SUPABASE_JWT_PUBLIC_KEY`.
4. Si es `JWT_INVALID_OR_EXPIRED`: el cliente debe refrescar sesión.
5. Si es `getServiceSupabase threw`: falta `SUPABASE_SECRET_KEY`.

Detalles completos en [AUTH_VERIFY_DEBUG.md](AUTH_VERIFY_DEBUG.md).

### 10.4 Inspeccionar el historial de un usuario

```sql
select created_at, amount, reason, product_name_at_time, price_tokens_at_time
from   wallet_ledger
where  tenant_id = (select id from tenants where slug = 'lapocha')
  and  user_id   = (
    select id from user_profiles
    where  tenant_id = (select id from tenants where slug = 'lapocha')
      and  email = 'someone@example.com')
order by created_at desc;
```

### 10.5 Subir un premio del Welcome Bonus

```sql
update tenant_token_rewards
   set amount = 150, updated_at = now()
 where tenant_id = (select id from tenants where slug = 'lapocha')
   and event_code = 'signup_bonus';
```

Los nuevos signups cogen 150t en lugar de 100t. Cero redeploy.

---

## 11. Glosario

| Término | Significado |
|---|---|
| **Tenant** | Una discoteca. Tiene slug, tema, features, economía, tiers. |
| **Promoter** | Grupo empresarial que opera N tenants. |
| **Slug** | Identificador URL-safe (`lapocha`, `kapital`). Es el subdominio. |
| **Token** | Moneda interna. Se gana jugando, se gasta en barra. |
| **CQRS** | Command Query Responsibility Segregation — write append-only, read materializado. |
| **TOCTOU** | Time-of-check / time-of-use. Bloqueado por `SELECT FOR UPDATE` en cada RPC. |
| **RLS** | Row Level Security. Aislamiento multi-tenant nativo de Postgres. |
| **JIT** | Just-In-Time. Creación del `user_profile` en el primer `/api/session`. |
| **ES256** | ECDSA con curva P-256 + SHA-256. Algoritmo de firma JWT actual de Supabase. |
| **JWK / JWKS** | JSON Web Key (formato de clave pública). JWKS = wrapper `{ "keys": [...] }`. |
| **`current_tenant_id()`** | Función SQL que lee el custom claim `tenant_id` del JWT. La base del RLS. |
| **`business_night`** | Bloque 06:00→06:00 de Madrid. Una "noche" para humanos. |
| **Boost** | Acción premium que consume tokens para resultado upgraded (vote x5, salto de cola). |
| **Ledger** | Tabla append-only `wallet_ledger`. Source of truth financiero. |
| **Projection** | `user_profiles.token_balance` / `lifetime_earned` mantenidos por trigger. |
| **Snapshot** | `product_name_at_time`, `price_tokens_at_time` en `wallet_ledger`. El pasado no se mueve. |
| **Tier** | Nivel de fidelidad: Bronce(0) / Plata(500) / Oro(1500) / Platino(4000). |
| **`tenant_token_rewards`** | Economía externalizada — premios y costes por `event_code`. |
| **`tracking_campaigns`** | Embudo universal de atribución (QR físicos, RRPP, social). |
| **NIGHTGRAPH** | Codename interno del upgrade enterprise multi-tenant. |
| **La Pocha** | Primer tenant del piloto. Discoteca real. |
