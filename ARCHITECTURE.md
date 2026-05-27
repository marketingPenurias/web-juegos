# ARCHITECTURE — Nightgraph (La Pocha Gamification MVP)

> **Status**: production-ready, deployed to Cloudflare Pages from `main`.
> **Last reviewed**: 2026-05-27 (universal attribution engine + Jumbotron / Realtime broadcasting).
> **Scope**: full-stack — frontend, edge worker, database, observability, security.

This document is the canonical technical reference for the project. It
covers the *as-built* architecture: the file tree, the data model, every
runtime boundary, the trust model, and the decisions behind each layer.
It is intentionally exhaustive — if a future engineer can't onboard from
this file alone, the file is wrong.

---

## 1. Product, in one paragraph

Nightgraph is a B2B2C white-label gamification platform for nightclubs.
The first tenant ("La Pocha") is the demo for the MVP. End users open
the venue's URL on their phone, log in with Google, and play live games
(song battles, music swipe, roulette, jukebox boosts, secret menu). Each
action earns or burns **tokens** — an internal currency that gates
upselling at the bar. The venue gets a CRM-grade event stream and
real-time leaderboards. Every tenant gets their own subdomain, palette,
feature flags and economy, all served from one Cloudflare Worker.

---

## 2. High-level topology

```
                         ┌─────────────────────────────────────┐
                         │       browser  (iOS / Android)       │
                         │ ──────────────────────────────────── │
                         │  React Router 7 SPA + Zustand        │
                         │  GSAP animations  +  i18next (es/en) │
                         │  supabase-js (cookie-backed SSO)     │
                         └──────────────┬──────────────────────┘
                                        │  HTTPS / fetch (keepalive)
                                        │  Authorization: Bearer <jwt>
                                        ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │              Cloudflare Workers   (edge, global)                  │
   │  ───────────────────────────────────────────────────────────────  │
   │   workers/app.ts                                                 │
   │     ↳ react-router/createRequestHandler                          │
   │         ↳ root.loader  →  tenant resolution                      │
   │         ↳ routes/home  →  SSR splash + hydrate <LaPochaApp/>     │
   │         ↳ routes/api.track   →  analytics ingestion (POST)       │
   │         ↳ routes/api.wallet  →  atomic token transactions (POST) │
   └──────────────┬───────────────────────────────┬───────────────────┘
                  │ service-role key              │ anon-key for read
                  │ (server-side only)            │
                  ▼                               ▼
        ┌────────────────────────────────────────────────────────┐
        │            Supabase / Postgres   (eu-west-x)            │
        │  ─────────────────────────────────────────────────────  │
        │  • tenants, user_profiles, venue_visits                 │
        │  • behavior_events (append-only, JSONB+GIN)             │
        │  • wallet_ledger  (append-only)                         │
        │  • Token materialization trigger → user_profiles        │
        │  • spend_tokens(...) RPC  — SELECT FOR UPDATE, atomic   │
        │  • Row Level Security on every table (tenant isolation) │
        │  • Enterprise layer: promoters, products, staff (RBAC), │
        │    events, promoter_codes, audit_logs                   │
        └────────────────────────────────────────────────────────┘
```

Everything except the database runs on Cloudflare's edge: the same
Worker handles SSR, asset serving, and API ingestion. There is no
separate Node server, no container orchestrator, no CI step that
produces a Docker image. `wrangler deploy` is the entire deploy.

---

## 3. Repository map

```
web-juegos/
├── app/                         # React Router 7 application root
│   ├── root.tsx                 # HTML shell, links, loader, ErrorBoundary
│   ├── routes.ts                # route registry (RouteConfig)
│   ├── entry.server.tsx         # streaming SSR via react-dom/server
│   ├── app.css                  # Tailwind v4 entry + custom utilities
│   │
│   ├── routes/
│   │   ├── home.tsx             # "/"   — SSR splash, hydrates LaPochaApp
│   │   ├── tv.music.tsx         # "/tv/music" — Jumbotron (cookie auth + Realtime)
│   │   ├── api.analytics.ts     # "/api/analytics" — POST events (canonical)
│   │   ├── api.track.ts         # "/api/track"     — alias for /api/analytics
│   │   ├── api.wallet.ts        # "/api/wallet"    — POST token tx (RPC)
│   │   ├── api.rewards.ts       # "/api/rewards"   — purchase / redeem (RPC)
│   │   ├── api.music.ts         # "/api/music"     — GET deck + POST vote
│   │   └── api.auth-sync.ts     # "/api/auth-sync" — profile upsert + ref consumption
│   │
│   ├── components/
│   │   ├── LaPochaApp.tsx       # screen orchestrator (Zustand selector)
│   │   ├── AppFrame.tsx         # responsive phone-frame + theme injection
│   │   ├── BottomNav.tsx        # bottom navigation
│   │   ├── TokenBadge.tsx       # animated wallet pill (gsap snap tween)
│   │   ├── Toast.tsx            # GSAP-driven toast (z-100)
│   │   ├── LanguageSwitch.tsx   # ES/EN toggle (compact + pill modes)
│   │   ├── HistoryDrawer.tsx    # slide-up sheet for token history
│   │   ├── RedemptionScreen.tsx # 5-min countdown + GSAP wave (anti-screenshot)
│   │   ├── Jumbotron.tsx        # TV leaderboard fed by Supabase Realtime
│   │   │
│   │   ├── hub/*                # 7 split cards (TokenWallet, Streak, …)
│   │   ├── live/*               # 4 LiveBattle sub-components
│   │   └── ruleta/*              # PlayersPanel + WinnerModal
│   │
│   ├── screens/                 # 10 screens, one per `Screen` union value
│   │   ├── Onboarding.tsx       # Google OAuth + Apple demo skip
│   │   ├── Hub.tsx              # 50-line orchestrator; assembles cards
│   │   ├── LiveBattle.tsx       # two-step voting + boost burst
│   │   ├── SecretMenu.tsx       # 9-item catalog w/ filters
│   │   ├── TinderMusical.tsx    # 5-card swipe deck (GSAP Draggable)
│   │   ├── RuletaRondas.tsx     # 2-8 player wheel (safe-jitter spin)
│   │   ├── Ticket.tsx           # hold-to-burn anti-fraud screen
│   │   ├── Profile.tsx          # email, level, settings, logout
│   │   ├── Jukebox.tsx          # request + 50-tokens Boost
│   │   └── DJDashboard.tsx      # B2B live leaderboard (dj role required)
│   │
│   ├── store/
│   │   └── useGameState.ts      # Zustand store + persist (sessionStorage)
│   │
│   ├── lib/
│   │   ├── gsap.ts              # central GSAP + Draggable registration
│   │   ├── utils.ts             # cn() = clsx + tailwind-merge
│   │   ├── i18n.ts              # react-i18next config (es + en, inline)
│   │   ├── tenant.tsx           # TenantContext + slug extractor + theme
│   │   ├── tenant-resolver.server.ts  # tenant/profile/role resolver (shared)
│   │   ├── analytics.ts         # offline-queue fetcher + JWT injection
│   │   ├── analytics-handler.server.ts # shared handler for /api/{analytics,track}
│   │   ├── api.server.ts        # CORS, JWT verify, cookie parse, jsonResponse
│   │   ├── cookie-auth.server.ts # parse Supabase cookie + role guard (page loaders)
│   │   ├── tv-music-handler.server.ts  # /tv/music loader logic
│   │   ├── supabase.client.ts   # browser singleton + cookie storage
│   │   ├── supabase.server.ts   # publishable + SECRET client factories
│   │   ├── useRewards.ts        # client hook over /api/rewards
│   │   └── useMusic.ts          # client hooks: useMusic + useDJLeaderboard
│   │
│   └── types/
│       ├── env.d.ts             # VITE_* ambient types
│       └── database.ts          # hand-written Supabase schema interfaces
│
├── workers/
│   └── app.ts                   # Worker entrypoint → createRequestHandler
│
├── database/                    # Migrations (run in numeric order)
│   ├── schema.sql               # core schema, RLS, JWT-claim helper
│   ├── 02_production_ready.sql  # CQRS columns + trigger + spend_tokens
│   ├── 03_secure_rpc.sql        # REVOKE PUBLIC / GRANT service_role
│   ├── 04_tenant_theme.sql      # theme jsonb + Kapital demo tenant
│   ├── 05_scalability_ready.sql # NIGHTGRAPH upgrade: promoters, products,
│   │                            #   staff RBAC, events, codes, audit
│   ├── 06_music_rpc.sql         # vote_track RPC + DJ leaderboard view
│   └── 07_growth_and_realtime.sql # tracking_campaigns + Realtime publication
│                                #   + display role + acquisition_campaign_id
│
├── scripts/
│   └── seed-dashboard.ts        # tsx seeder (50 users / 200 visits / ~1.2k events)
│
├── public/favicon.ico
├── react-router.config.ts       # SPA flag, build target, etc.
├── vite.config.ts               # plugins: cloudflare + tailwind + router
├── tsconfig.{json,cloudflare,node}.json
├── wrangler.json                # Worker bindings, vars
├── worker-configuration.d.ts    # generated by `wrangler types`
├── .dev.vars / .dev.vars.example  (gitignored secrets)
├── .env       / .env.example      (gitignored VITE_* vars)
├── CLAUDE.md                    # business + dev rules (orchestrator context)
├── ARCHITECTURE.md              # ← this file
└── package.json
```

LOC sizing (excluding `node_modules`, generated, vendored):

| Surface     | Files | Lines |
|-------------|-------|-------|
| Components  | 23    | ~1500 |
| Screens     | 9     | ~2200 |
| Lib         | 9     | ~1150 |
| Routes      | 3     | ~580  |
| Store       | 1     | ~270  |
| SQL         | 5     | ~540  |
| Scripts     | 1     | ~260  |
| **Total**   | **~52** | **~5645** |

---

## 4. Frontend architecture

### 4.1 Framework: React Router 7 + Cloudflare Vite plugin

The starter is `@cloudflare/templates/react-router-starter-template`.
The Worker hosts both the SSR HTML render and any API endpoint, all
through one `createRequestHandler` invocation in `workers/app.ts`.

- **SSR**: streamed via `renderToReadableStream` in
  `app/entry.server.tsx`, with `isbot` detection to flush the whole
  document for crawlers.
- **Routing** is declarative in `app/routes.ts`. We do *not* use
  file-system routing — the registry is small and explicit:
  ```ts
  export default [
    index("routes/home.tsx"),
    route("api/track",  "routes/api.track.ts"),
    route("api/wallet", "routes/api.wallet.ts"),
  ] satisfies RouteConfig;
  ```
- **Resource routes** (`api.track`, `api.wallet`) export `loader` and
  `action` only — no default component, no UI chunk. They are pure HTTP
  endpoints that happen to share the Vite + Worker pipeline.

### 4.2 Hydration model

`root.tsx` runs SSR with the tenant lookup baked into the response, so
the document arrives themed and tenant-scoped. The visible app
(`LaPochaApp`) is **client-only**: `routes/home.tsx` returns a minimal
splash on the server and only renders the full app after `useEffect`
fires. This is intentional — it avoids hydration mismatches around:

- GSAP's `useGSAP()` (touches `window`).
- Supabase JS client (reads cookies, listens to URL hash).
- Zustand `persist` middleware (depends on `sessionStorage`).

The cost is a sub-100ms splash on first paint; the value is zero
hydration warnings and a consistent SSR cache hit ratio in Cloudflare.

### 4.3 State: Zustand + sessionStorage persistence

`app/store/useGameState.ts` is the single source of truth for in-app
state — tokens, streak, current screen, song votes, missions,
leaderboard, transactions, friends, song requests, active ticket and
profile metadata.

- **Persistence**: wrapped in `persist({ storage: sessionStorage })`
  with a `partialize` whitelist so only the durable slices survive
  F5/refresh. Auth (Supabase cookies) is independent.
- **Invariants**:
  - `spendTokens(n)` returns `false` when `tokens < n` *and* leaves
    state untouched. `addTokens` and `spendTokens` both clamp via
    `Math.max(0, …)` — tokens cannot go negative anywhere.
  - Every successful debit/credit can optionally append a `Transaction`
    row via `recordTransaction`, capped at 30 entries.
- **No prop drilling**: every screen reads what it needs via
  `useGameState(selector)`; sub-components are split for ergonomics,
  not for state isolation.

### 4.4 Screen orchestration

Routing across the 9 in-app screens is *not* URL-based. The
`currentScreen` field of the store drives a single `switch` in
`components/LaPochaApp.tsx → ScreenRouter`. This decision is deliberate:

- The MVP is a single document; OAuth redirects need a stable URL.
- Animated transitions between screens are GSAP-driven (no React Router
  transitions).
- Sub-routes for `tinder`, `ruleta`, `profile`, `jukebox` are
  *fullscreen* — the orchestrator omits the bottom nav on those.

`Screen` union: `onboarding | hub | live | menu | tinder | ruleta |
ticket | jukebox | profile`. The Bottom Nav surface only includes
`hub | live | menu | ticket` (ticket is conditional on
`activeTicket !== null`).

### 4.5 Animation: GSAP via `@gsap/react`

`app/lib/gsap.ts` is the single registration point. It registers
`useGSAP` and `Draggable`, and applies a global default:

```ts
gsap.defaults({ force3D: true });
```

so every tween hits the GPU compositor by default. The
`gsap-performance` skill recommended this exactly: it eliminates the
need for `force3D: true` on every individual call (kept on the heavy
ones for clarity).

Key animation patterns in use:

| Surface              | Pattern |
|----------------------|---------|
| Tinder Musical       | `Draggable.create(card, { type: "x" })` with snap-back on threshold miss; success modal via `gsap.fromTo(scale)` |
| Ruleta wheel         | `gsap.to(svg, { rotation: turns*360 + offset, ease: "power4.out", duration: 5.5 })` with **safe-jitter** ±32% of sector angle so the pointer never lands on a seam |
| Live Battle bars     | `scaleX: target/100` with `transform-origin: left` — refactored away from `width` to avoid layout repaints |
| Ticket burn          | `scaleX: 0→1` on a hold-button fill; AFTER → timeline that collapses the card |
| Boost Burst overlay  | timeline: glow scale + text fly + fade |
| Token Badge          | `gsap.to(obj, { val, snap: { val: 1 }, onUpdate })` for the digit counter |
| Hub stagger entrance | `.hub-card` selector with `gsap.from({ stagger: 0.08, ease: "power3.out" })` |
| HistoryDrawer        | timeline: overlay opacity + sheet yPercent slide |

All `useGSAP` calls pass a `scope` ref so selectors are scoped to the
component subtree. Cleanup is automatic via the hook's revert.

### 4.6 Styling: Tailwind v4 + design tokens

- **No CSS-in-JS**, no styled-components. Tailwind v4 utilities via the
  `@tailwindcss/vite` plugin.
- **`cn()` helper** (`app/lib/utils.ts`) composes class strings with
  `clsx` + `tailwind-merge`. Required for any conditional class.
- **Design tokens** live in `app/app.css` (`--font-sans`, shadcn-style
  semantic vars). Tenant-specific tokens (`--tenant-primary`,
  `--tenant-secondary`, `--tenant-accent`, `--tenant-background`) are
  injected at runtime by `AppFrame.tsx` from the loader's tenant theme.
- **Glassmorphism + iOS WebKit**: every `backdrop-blur-*` class is
  paired with `transform-gpu translate-z-0` to force GPU compositing.
  Audited across 17 occurrences during the perf pass.
- **Mobile-first responsive frame**: phone-shaped on `< sm`, scales up
  with explicit width/height at `sm | md | lg | xl | 2xl` so a TV looks
  like a phone in the middle of the screen (the showroom aesthetic the
  CEO demo asked for).

### 4.7 i18n: react-i18next

Configured in `app/lib/i18n.ts`. Two languages bundled in-file (no
HTTP-loaded namespaces — tiny bundle, no FOUT):

- `es` is the default and the design language.
- `en` mirrors every key.
- Detection order: `localStorage('lapocha-lang') → navigator → htmlTag`,
  with `localStorage` caching the user's choice.
- `LanguageSwitch` exposes a pill (ES | EN) and a compact (single-letter
  toggle); both render on `Onboarding` and `Hub` and persist across
  refresh.
- **Why inline resources**: this is a single-document MVP, the keys
  fit in ~470 lines, and the round-trip saved on a slow venue Wi-Fi is
  worth the few extra KB in the bundle.

### 4.8 Performance hardening (the iOS WebKit pass)

Five passes were executed across the whole `app/` tree — documented in
the commit history under `perf: iOS WebKit hardware acceleration audit`.
Summary:

1. **Glassmorphism GPU hack** — 17 `backdrop-blur-*` sites tagged
   with `transform-gpu translate-z-0`.
2. **Viewport** — every `h-screen / min-h-screen` rewritten to
   `100dvh` to defeat iOS URL-bar jumps.
3. **Overscroll & gestures** — `overscroll-none` on the outermost
   wrappers, `touch-none + will-change-transform` on the Tinder card.
4. **GSAP** — global `force3D: true` default; explicit on the heavy
   tweens (wheel spin, swipe + snapback, success modal, BoostBurst,
   burn fill).
5. **Layout-thrash purge** — every animation that touched
   `width / height / top / left / margin` was refactored to
   `scaleX / scaleY / x / y`. Three sites refactored.

Result: stable 60 FPS on iPhone SE / iOS 16 in Safari.

### 4.9 Self-Redemption Visual (anti-screenshot)

`app/components/RedemptionScreen.tsx` is rendered as a full-screen
overlay after a successful `/api/rewards` redeem call. It uses three
animations running simultaneously to make screenshots obviously stale
to the bartender:

| Layer | What | Why |
|---|---|---|
| Background wave | `gsap.to({ backgroundPosition: "200% 0", repeat: -1 })` on a `linear-gradient` masked card | a static screenshot can never show the moving sheen |
| Pulsating short-code | `gsap.to({ opacity: 0.45, yoyo: true, repeat: -1 })` over a 6-char code derived from the reward UUID | flickering text is impossible to capture cleanly |
| Conic ring | continuous 18s `rotation` on a `conic-gradient` SVG mask | another loop-on-screen telltale |
| Live countdown | a `setInterval(250)` ticks the `MM:SS` display from `expires_at - now()` | rejects any screen from earlier in the day |

The countdown drives an `onExpire` callback that tears the overlay
down at zero. The DB row stays as `redeeming` until a backend reaper
flips it to `expired` (post-MVP).

### 4.10 Tinder Musical client pattern

`app/lib/useMusic.ts` exposes two hooks:

- **`useMusic(eventId)`** — drives the player-facing swipe deck.
  Calls `GET /api/music?event_id=…&mode=swipe`, which returns only
  unplayed tracks the user hasn't voted on yet. `castVote({ track_id,
  vote_type, tokens_spent })` posts to the same endpoint and
  **optimistically drops the card from `deck`** so the next swipe is
  available even before the network round-trip finishes. The Edge
  worker rejects double-votes via the UNIQUE index; the client falls
  back to its own state if the response says `already_voted`.
- **`useDJLeaderboard(eventId, autoMs)`** — drives `DJDashboard`.
  Polls `mode=leaderboard` every `autoMs` (default 5 s). The Edge
  worker checks `tenant_staff.role = 'dj'`; the hook surfaces a `403`
  as `error: "forbidden"` and the UI shows a "DJ role required"
  banner.

Realtime via Supabase channels is the long-term path; polling is the
demo-friendly stopgap that doesn't open a WS straight from the browser
to the DB.

### 4.11 Jumbotron (live TV broadcast)

`/tv/music` is a standalone full-bleed route consumed by the staff
laptop driving the venue projector.  It is fundamentally different
from every other screen:

- **Read-only.** Zero `POST` on the page.  Even logging in is done
  out-of-band (a kiosk account in `tenant_staff`).
- **Cookie-auth from the server.**  No `Authorization: Bearer` header —
  on a page load, the only auth signal is the Supabase cookie.  The
  `cookie-auth.server.ts` helper parses `sb-<projectRef>-auth-token`,
  validates the JWT, and checks `tenant_staff.role IN ('display',
  'admin')`.  401 / 403 are surfaced as RR7 `Response` throws.
- **Realtime, not polling.**  The browser opens **one** WebSocket via
  `supabase.channel('tv:event_tracks:<eventId>').on('postgres_changes',
  …)` and never polls.  Every `INSERT/UPDATE/DELETE` on
  `event_tracks` is filtered server-side (`event_id=eq.<id>`).
- **GSAP-driven layout.**  Re-sorts (boost → rank 1) animate via per-
  row `gsap.to(el, { y: idx * 96 })` with `force3D: true`.  The vote
  counter uses the same snap-tween pattern as `TokenBadge`.  An
  ambient pulse on the leader card makes the projector feel alive
  even between updates.
- **SSR-painted leaderboard.**  The loader hydrates with the initial
  top-20, so even if the WS doesn't connect immediately (or drops),
  the projector never shows a black void.

---

## 5. Edge layer (Cloudflare Workers)

### 5.1 Entrypoint

`workers/app.ts` is the only worker file. It builds a
`createRequestHandler` over the SSR bundle and exposes the standard
`{ fetch }` export:

```ts
export default {
  fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
```

`AppLoadContext` is augmented with `{ cloudflare: { env, ctx } }`, so
every loader/action reads secrets via `context.cloudflare.env`.

### 5.2 Edge routes

**`/api/analytics`** (canonical) and **`/api/track`** (legacy alias) —
`app/routes/api.{analytics,track}.ts`

Both files are one-line shims pointing to
`app/lib/analytics-handler.server.ts`.

| Property | Value |
|---|---|
| Method | POST (OPTIONS for preflight) |
| Body | `Event \| Event[]` (offline-queue flush sends an array) |
| Auth | Optional Bearer JWT (verified when present) |
| Tenant | strict resolution (payload → header → host), 400 if missing |
| Concurrency | one Supabase round-trip per distinct slug; one bulk INSERT |
| Limits | `MAX_BATCH = 200` events per request |
| Behavior | Anon ingestion writes `user_id = NULL` (pre-login funnel) |

The frontend lib (`app/lib/analytics.ts`) targets `/api/analytics`;
`/api/track` exists only so older offline queues persisted in
`localStorage` from previous builds still drain on the next boot.

**`/api/wallet`** — `app/routes/api.wallet.ts`

| Property | Value |
|---|---|
| Method | POST (OPTIONS for preflight) |
| Body | `{ tenant_slug?, amount: int, reason: string, metadata? }` |
| Auth | **JWT required** (401 otherwise) |
| Tenant | strict, 400 if missing |
| Spend (`amount < 0`) | atomic `rpc('spend_tokens', …)` via SECRET-key client; NULL → 400 `insufficient_funds` |
| Earn (`amount > 0`) | direct insert; trigger updates the projection |
| Bounds | `[-10_000, 10_000]`, non-zero, integer |

**`/api/rewards`** — `app/routes/api.rewards.ts`  *(NEW)*

| Property | Value |
|---|---|
| Method | POST (OPTIONS for preflight) |
| Body | `{ action_type: "purchase", product_id, event_id?, tenant_slug? }` **or** `{ action_type: "redeem", reward_id, tenant_slug? }` |
| Auth | **JWT required** (401 otherwise) |
| Tenant | strict, 400 if missing |
| Purchase | calls `rpc('purchase_reward', …)` — atomic price snapshot + ledger debit + `user_rewards` row insert. Returns `{ reward_id, balance }`. |
| Redeem  | calls `rpc('start_reward_redemption', …)` — flips status to `redeeming` with `expires_at = now() + 5 min`. Returns `{ expires_at }`. |
| Errors | `insufficient_funds` (400), `product_unavailable` (404), `reward_unavailable` (409). |

**`/api/music`** — `app/routes/api.music.ts`  *(NEW)*

| Property | Value |
|---|---|
| Method | `GET ?event_id&mode=swipe|leaderboard` · `POST` |
| Auth | **JWT required** on both verbs (401 otherwise) |
| Tenant | strict, 400 if missing |
| GET swipe | unplayed `event_tracks` for the active event minus tracks the caller already voted on, ordered by `total_votes DESC`, limit 40 |
| GET leaderboard | full sorted list. **Requires `dj` role** in `tenant_staff`; 403 otherwise |
| POST | atomic `rpc('vote_track', …)` — locks the track row, optionally debits tokens for `boost`, inserts vote, bumps `total_votes` (free +1, boost +5). |
| Errors | `track_unavailable` (409), `already_voted` (409), `insufficient_funds` (400). |

**`/api/auth-sync`** — `app/routes/api.auth-sync.ts`  *(NEW)*

| Property | Value |
|---|---|
| Method | POST (OPTIONS for preflight) |
| Body | `{ tenant_slug?: string }` — defaults to header / host resolution. |
| Auth | **JWT required** (401 otherwise) |
| Tenant | strict, 400 if missing |
| Behavior | Upsert `user_profiles` keyed on `(tenant_id, auth_user_id)`. On first insert, set `acquisition_campaign_id` from the `ng_tracking_ref` cookie via `resolve_tracking_campaign(tenant, code)`. **Always** clears the cookie via `Set-Cookie: ng_tracking_ref=; Max-Age=0` on the response, so attribution can only fire once. |
| Returns | `{ profile: { id, is_new, token_balance, lifetime_earned, display_name, acquisition_campaign_id } }` |

**`/tv/music`** — `app/routes/tv.music.tsx`  *(UI route — Jumbotron)*

| Property | Value |
|---|---|
| Method | GET (page) |
| Auth | Cookie-based (`sb-<projectRef>-auth-token` parsed server-side). 401 if missing or invalid. |
| Role | Requires `display` OR `admin` in `tenant_staff` for the tenant. 403 otherwise. |
| Loader returns | `{ tenant_id, event_id, tracks: EventTrack[] }` — initial state painted server-side so the projector never shows a black screen during reconnects. |
| Realtime | Browser subscribes to `postgres_changes` on `event_tracks` filtered by `event_id`. **No HTTP polling**. |

Both routes share `app/lib/api.server.ts`:

- **CORS allowlist**: `localhost:5173`, `localhost:8788`, `127.0.0.1:5173`,
  `web-juegos.pages.dev`, `lapocha.nightgraph.es`, plus a regex for
  `*.web-juegos.pages.dev` (preview deploys). **No wildcards** —
  `Access-Control-Allow-Origin` is the request origin only when it
  passes the allowlist, otherwise the header is omitted (browser blocks).
- **JWT verification**: `verifyAuthToken(request, context)` extracts
  `Authorization: Bearer <jwt>` and calls `supabase.auth.getUser(token)`.
  Returns `{ id, email, supabase }` or `null`. The `user.id` from the
  JWT *overrides* any client-supplied `user_id` everywhere.
- **`jsonResponse`** is the universal helper: sets `Content-Type`,
  copies CORS headers (vary on origin), serializes the body.

### 5.3 Trust model (zero-trust)

Nightgraph uses the **new Supabase API key naming** (no more "anon" /
"service_role" labels in our code):

| Key (env) | Audience | Trust |
|---|---|---|
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser bundle | public, RLS-bound |
| `SUPABASE_PUBLISHABLE_KEY` | Cloudflare Worker | reads only, RLS-bound |
| `SUPABASE_SECRET_KEY` | Cloudflare Worker only | bypasses RLS, never bundled |

| Boundary | Trust |
|---|---|
| Client → API body | Untrusted. `user_id` always overridden by JWT. `tenant_slug` validated against the `tenants` table. |
| JWT signature | Trusted (verified by Supabase Auth on the worker). |
| `SUPABASE_SECRET_KEY` | Trusted, **server-only**, only the Worker holds it. |
| `*_PUBLISHABLE_KEY` | Trusted for reads under RLS, **never** trusted for privileged RPCs (locked down in `03_secure_rpc.sql` + `06_music_rpc.sql`). |

There is no path by which a client can:
- spend tokens belonging to another user;
- read another tenant's data;
- overdraft their own balance (every spend RPC takes a row lock);
- vote twice on the same track (`vote_track` returns `already_voted`,
  backed by a UNIQUE `(track_id, user_id)` index);
- redeem a reward they don't own (`start_reward_redemption` joins on
  `user_id` inside the RPC);
- invoke `spend_tokens` / `purchase_reward` /
  `start_reward_redemption` / `vote_track` directly via PostgREST
  (privileges revoked from `anon`, `authenticated`, `public`).

### 5.4 Frontend ↔ Worker contract

Two outbound calls from the browser:

1. **Analytics** (`analytics.ts`):
   ```
   POST /api/track
   Headers:  Authorization: Bearer <jwt?>, Content-Type: application/json
   Body:     { tenant_slug, category, action, metadata, client_ts }
              OR [Event, Event, ...]   (offline flush)
   Options:  keepalive: true
   ```
   - Non-2xx → payload appended to `localStorage["offline_events_queue"]`.
   - `flushOfflineQueue()` runs on `AppFrame` mount, on `online`, and on
     `visibilitychange === "visible"`.
   - Queue is capped at 200 entries, drained in batches of 50.

2. **Wallet** (future):
   ```
   POST /api/wallet
   Headers:  Authorization: Bearer <jwt>, Content-Type: application/json
   Body:     { tenant_slug, amount, reason, metadata? }
   ```
   Currently the demo store (`useGameState`) mutates tokens locally for
   instant CEO-demo feedback; wiring this endpoint into the spend/earn
   paths is the next-quarter work and is documented in the migration
   plan below.

---

## 6. Data layer (Supabase Postgres)

### 6.1 Migration order

```
database/schema.sql                  # base schema + RLS + JWT helper
        ↓
database/02_production_ready.sql     # CQRS columns, trigger, spend_tokens
        ↓
database/03_secure_rpc.sql           # RPC lockdown (REVOKE PUBLIC)
        ↓
database/04_tenant_theme.sql         # theme jsonb + Kapital demo tenant
        ↓
database/05_scalability_ready.sql    # NIGHTGRAPH enterprise upgrade
        ↓
database/06_music_rpc.sql            # vote_track RPC + DJ leaderboard view
        ↓
database/07_growth_and_realtime.sql  # tracking_campaigns + Realtime publication
                                     #   + display role + acquisition_campaign_id
```

Each file is idempotent (`create … if not exists`, `add column if not
exists`, `do $$ ... if not exists ... $$`) so re-runs are safe.

### 6.2 Core schema (`schema.sql`)

```
tenants
  ├─ id          uuid PK
  ├─ slug        text unique
  ├─ name        text
  └─ status      text   (active | paused | churned)

user_profiles
  ├─ id                  uuid PK
  ├─ tenant_id           → tenants.id
  ├─ email               text
  ├─ display_name        text
  ├─ acquisition_source  text
  ├─ vip_level           int default 1
  └─ unique (tenant_id, email)

venue_visits         (drives weekly retention cohorts)
  ├─ id          uuid PK
  ├─ tenant_id   → tenants.id
  ├─ user_id     → user_profiles.id
  ├─ entry_time  timestamptz
  └─ exit_time   timestamptz

behavior_events     (append-only event log)
  ├─ id              bigserial PK
  ├─ tenant_id       → tenants.id
  ├─ visit_id        → venue_visits.id   (nullable)
  ├─ user_id         → user_profiles.id  (nullable for anon)
  ├─ event_category  text
  ├─ event_action    text
  ├─ metadata        jsonb               (GIN-indexed)
  └─ created_at      timestamptz

wallet_ledger       (append-only ledger)
  ├─ id          bigserial PK
  ├─ tenant_id   → tenants.id
  ├─ user_id     → user_profiles.id
  ├─ amount      int       (signed: + earns, − spends)
  ├─ reason      text
  ├─ metadata    jsonb
  └─ created_at  timestamptz
```

**Indexing strategy** is read-pattern driven:

| Index | Purpose |
|---|---|
| `behavior_events (tenant_id, event_category, created_at DESC)` | category timeline per tenant |
| `behavior_events USING gin (metadata)` | metadata-key queries (`metadata->>'song_id' = …`) |
| `venue_visits (tenant_id, entry_time DESC)` | retention cohorts |
| `wallet_ledger (tenant_id, created_at DESC)` | transaction timeline |
| `user_profiles (tenant_id, lifetime_earned DESC)` (added in `02`) | O(1) leaderboard reads |

### 6.3 Row Level Security

Every table has RLS enabled. The pattern is identical:

```sql
create policy <name>_tenant_read on public.<table>
  for select using (tenant_id = public.current_tenant_id());

create policy <name>_tenant_write on public.<table>
  for insert with check (tenant_id = public.current_tenant_id());
```

`current_tenant_id()` reads the JWT custom claim:

```sql
create or replace function public.current_tenant_id() returns uuid
language sql stable as $$
  select nullif(
    current_setting('request.jwt.claims', true)::json->>'tenant_id',
    ''
  )::uuid
$$;
```

The Worker uses the **service role key** for writes (bypasses RLS) but
always sets `tenant_id` explicitly from a vetted slug, so server-side
RLS is defence-in-depth, not the primary mechanism. Direct PostgREST
reads (e.g. future dashboard clients with anon key) get full
tenant-scoped isolation for free.

### 6.4 CQRS: write-side ledger, read-side projection

The ledger is the source of truth (`wallet_ledger`). Hub / leaderboard
queries hit a denormalized projection on `user_profiles`:

```
user_profiles += token_balance   int   (mirrors sum(amount))
user_profiles += lifetime_earned int   (mirrors sum(max(amount, 0)))
user_profiles += auth_user_id    uuid  (links to Supabase auth.users)
```

Kept in sync by an `AFTER INSERT` trigger on `wallet_ledger`:

```sql
create function public.update_user_token_balance() …
  begin
    update user_profiles
    set
      token_balance   = token_balance   + new.amount,
      lifetime_earned = lifetime_earned + greatest(new.amount, 0)
    where id = new.user_id;
  end;

create trigger wallet_ledger_after_insert
  after insert on wallet_ledger
  for each row execute function update_user_token_balance();
```

This costs one extra UPDATE per ledger insert but makes the read path
free. The trigger is `SECURITY DEFINER` with a pinned `search_path` so
it can update across RLS without becoming an attack surface.

### 6.5 Atomic spend RPC

`02_production_ready.sql` defines:

```sql
function spend_tokens(p_tenant_id, p_user_id, p_amount, p_reason, p_metadata)
  returns int
```

with:

- `SELECT … FOR UPDATE` row-locks the user's profile,
- balance check inside the same transaction,
- `INSERT INTO wallet_ledger`,
- returns the new balance, or `NULL` when the spend would overdraft.

`03_secure_rpc.sql` then `REVOKE`s `EXECUTE` from `public`, `anon`, and
`authenticated`, leaving `service_role` as the **only** valid caller.
The Cloudflare Worker invokes it via `getServiceSupabase(context)`
exclusively. End result: even if the anon key leaks, the only way to
move tokens is by holding the service-role key, which never leaves the
Worker's environment.

### 6.6 Multi-tenant themes (`04_tenant_theme.sql`)

```sql
alter table tenants add column theme jsonb default '{}';
update tenants set theme = jsonb_build_object(
  'primary',    '#7DF9FF',
  'secondary',  '#39FF14',
  'accent',     '#FFD700',
  'background', '#050505'
) where slug = 'lapocha';

insert into tenants (slug, name, status, theme)
values ('kapital', 'Kapital Madrid', 'active', jsonb_build_object(
  'primary',    '#FF3CAC',
  'secondary',  '#FFD166',
  'accent',     '#7DF9FF',
  'background', '#0A0014'
)) on conflict (slug) do nothing;
```

The frontend reads this object via `root.loader → useLoaderData` and
injects it as CSS custom properties on `AppFrame`. Tailwind v4
utilities consume them: `bg-(--tenant-primary)/20`.

### 6.7 Enterprise upgrade (`05_scalability_ready.sql`) — NIGHTGRAPH

This is the in-flight migration that promotes the project from
"single-tenant MVP" to a multi-venue SaaS. It introduces:

| Table | Purpose |
|---|---|
| `promoters` | parent group / chain (e.g. one company runs 4 venues) |
| `tenant_products` | per-tenant catalog (drinks, rewards, game tickets, VIP access) with `price_tokens` + informational fiat reference |
| `tenant_staff` | RBAC: `admin / manager / door / bar / dj / promoter` |
| `tenant_events` | sessions of the venue (a Halloween night, a Friday techno) |
| `promoter_codes` | RRPP referral codes with token + percent commissions |
| `audit_logs` | tamper-evident operational audit trail |

And extends:

```sql
tenants += promoter_id, features (jsonb feature-flags)
wallet_ledger += event_id, product_id,
                product_name_at_time, price_tokens_at_time,
                promoter_code_id, campaign_type
```

The snapshot columns on `wallet_ledger` are the immutable record of
*what the user actually paid*, even if the venue later edits the
catalog price. This is the difference between a ledger and a
spreadsheet: the past doesn't move.

`features` on `tenants` is the per-tenant feature flag map — the same
deploy can ship Tinder Musical to one venue and disable it for another
without a code change.

### 6.8 Seeder

`scripts/seed-dashboard.ts` (run via `npm run seed`) populates:

| Entity | Count | Notes |
|---|---|---|
| `tenants` | 1 (lapocha) | idempotent upsert |
| `user_profiles` | 50 | random Spanish names, acquisition sources |
| `venue_visits` | 200 | last 28 days, 45 min – 6 h stays |
| `behavior_events` | ~1200 | 6 categories × random actions, GIN-friendly metadata |
| `wallet_ledger` | ~250 | 450-token welcome + 0–6 random movements per user |

Requires `SUPABASE_SECRET_KEY` (new naming) to bypass RLS. Reads
`.dev.vars` automatically; falls back to env vars if the file is
missing. Old envs (`SUPABASE_SERVICE_ROLE_KEY`) are still read as a
fallback so a partially-migrated environment doesn't break the seed.

### 6.9 Tinder Musical — track economy

Three tables sit at the heart of the music game:

```
event_tracks         (catalog for a given tenant_event)
  ├─ id, tenant_id, event_id          → tenant_events.id
  ├─ spotify_id, title, artist
  ├─ cover_image_url
  ├─ total_votes      int             ← materialized counter (CQRS)
  ├─ is_played        bool
  └─ played_at        timestamptz

track_votes          (append-only audit of every vote cast)
  ├─ id, tenant_id, event_id, track_id, user_id
  ├─ vote_type        text  ("free" | "boost")
  ├─ tokens_spent     int
  └─ created_at
  UNIQUE (track_id, user_id)          ← one vote per user per track

user_rewards         (token-funded inventory, see §6.10)
```

The `vote_track` RPC (in `06_music_rpc.sql`) is the atomic primitive:

1. `SELECT … FOR UPDATE` on `event_tracks` rejects votes on
   `is_played = true`.
2. Dedupe check + UNIQUE index belt-and-braces.
3. On `vote_type = 'boost'`, lock the user's profile, debit the spend
   via a `wallet_ledger` insert (trigger updates `token_balance` in
   the projection). Insufficient funds → returns `ok: false` with the
   current balance.
4. Insert the `track_votes` row.
5. `UPDATE event_tracks SET total_votes = total_votes + delta`
   (free = +1, boost = +5).

Locked down via `REVOKE … FROM public, anon, authenticated; GRANT … TO
service_role`. The frontend never touches `track_votes` directly —
every vote flows through `/api/music` POST.

The DJ leaderboard read is a single ORDER BY on the materialized
`total_votes` column; no aggregation at read time.

### 6.10 Rewards inventory — atomic purchase + 5-min redeem

```
user_rewards
  ├─ id, tenant_id, user_id, product_id, event_id
  ├─ status        text  ("available" | "redeeming" | "redeemed" | "expired")
  ├─ redeemed_at   timestamptz     ← set on first redemption tap
  ├─ expires_at    timestamptz     ← redeemed_at + 5 minutes
  └─ created_at
```

Two RPCs:

- **`purchase_reward(p_tenant_id, p_user_id, p_product_id, p_event_id)`**
  — locks the user's profile, validates the product is `is_active`,
  inserts a `wallet_ledger` debit with the *price snapshot*
  (`product_name_at_time`, `price_tokens_at_time`), and creates a
  `user_rewards` row with `status = 'available'`. Returns
  `{ reward_id, new_balance }`.
- **`start_reward_redemption(p_tenant_id, p_user_id, p_reward_id)`**
  — flips `status` to `redeeming`, sets `redeemed_at = now()` and
  `expires_at = now() + interval '5 minutes'`. Idempotency-safe: the
  UPDATE only matches rows whose status is still `'available'`.

Both are `SECURITY DEFINER` + locked down to `service_role`.

After expiry the frontend tears down the redemption UI; the row
remains as `redeeming` in the DB and is reaped by a future scheduled
job (out of scope for the MVP; see §14).

### 6.11 Universal attribution engine

`tracking_campaigns` is the *one* table that every acquisition source
funnels through.  A QR sticker on the VIP toilet, a WhatsApp link from
a promoter, a Tinder Musical share, an Instagram paid ad — all of them
land the user on `https://<slug>.nightgraph.es/?ref=BATHROOM_VIP` and the
attribution machinery doesn't need to know the difference.

```
tracking_campaigns
  ├─ id            uuid PK
  ├─ tenant_id     → tenants.id
  ├─ code          text          ("BATHROOM_VIP", "JUAN_RRPP", …)
  ├─ campaign_type text          (location | promoter | game | social | paid_ads)
  ├─ metadata      jsonb         (placement, label, source URL, …)
  ├─ is_active     bool
  └─ created_at
  UNIQUE (tenant_id, code)       ← codes scoped per tenant
```

`user_profiles` gained an `acquisition_campaign_id uuid` FK so cohort
queries (`WHERE acquisition_campaign_id = ?`) stay O(1).

**The Bermuda Triangle of OAuth** — attribution survives the Google
redirect via an HttpOnly cookie:

```
┌────────────────────────────┐
│ 1. User taps the QR        │
│    URL:  /?ref=BATHROOM_VIP│
└──────────────┬─────────────┘
               ▼
┌────────────────────────────────────────────┐
│ 2. Cloudflare Worker · root.loader         │
│    - reads ?ref=                           │
│    - Set-Cookie: ng_tracking_ref=…         │
│       Max-Age=86400 HttpOnly SameSite=Lax  │
│    - 303 redirect → clean URL              │
└──────────────┬─────────────────────────────┘
               ▼
┌──────────────────────────┐
│ 3. User clicks "Google"  │
│    → accounts.google.com │
└──────────────┬───────────┘
               ▼
┌──────────────────────────────────────┐
│ 4. Google redirects back to origin   │
│    The ng_tracking_ref cookie        │
│    survives this round-trip          │
│    (same-origin, HttpOnly)           │
└──────────────┬───────────────────────┘
               ▼
┌────────────────────────────────────────────┐
│ 5. supabase-js parses URL hash,            │
│    fires SIGNED_IN                         │
└──────────────┬─────────────────────────────┘
               ▼
┌────────────────────────────────────────────┐
│ 6. Onboarding listener:                    │
│    POST /api/auth-sync                     │
│      Authorization: Bearer <jwt>           │
│      Cookie: ng_tracking_ref=BATHROOM_VIP  │
└──────────────┬─────────────────────────────┘
               ▼
┌────────────────────────────────────────────┐
│ 7. Edge Worker /api/auth-sync:             │
│    - verify JWT via Supabase auth.getUser  │
│    - resolve_tracking_campaign(tenant,code)│
│    - INSERT user_profiles with             │
│        acquisition_campaign_id = <uuid>    │
│    - Set-Cookie: ng_tracking_ref=;Max-Age=0│
└────────────────────────────────────────────┘
```

Key design points:

- **One cookie, one source of truth.**  Whether the entry is a QR, a
  WhatsApp link, or a deep-link from another app, all of them set the
  same cookie with the same shape.  Frontend never reads it (HttpOnly).
- **Attribution is once-and-done.**  The cookie is cleared the first
  time `/api/auth-sync` runs.  If the user is an existing profile, we
  only PATCH `acquisition_campaign_id` if it was NULL (you can't be
  re-attributed mid-relationship).
- **The resolver lives in SQL.**  `resolve_tracking_campaign(tenant,
  code)` is a `SECURITY DEFINER` stable function — easy to lock down
  later and unit-test in the Supabase SQL editor.
- **Codes are case-insensitive.**  Internally normalised to UPPER on
  both the cookie write side and the SQL resolver.

### 6.12 Realtime broadcasting

The TV / Jumbotron projector is read-only, but it needs *immediate*
updates when a Boost vote lands.  Polling every 5 s is fine for the DJ
laptop but would burn the database for a 12-hour party showing a
projector across N venues simultaneously.

Solution: enable Supabase Realtime on the right tables.

```sql
alter publication supabase_realtime add table public.event_tracks;
alter publication supabase_realtime add table public.behavior_events;
```

That makes Postgres logical replication ship `INSERT/UPDATE/DELETE`
events for those tables onto the Realtime broadcast service.  The
browser subscribes over a single WebSocket:

```ts
supabase
  .channel(`tv:event_tracks:${eventId}`)
  .on("postgres_changes", {
    event: "*",
    schema: "public",
    table: "event_tracks",
    filter: `event_id=eq.${eventId}`,
  }, applyDiff)
  .subscribe();
```

The filter is enforced **on the Realtime server** — the WebSocket only
receives changes that match `event_id = …`.  No client-side filtering,
no over-fetching.

Authorisation flows through the existing Postgres RLS policies — the
Realtime server consults them with the user's JWT (sent as part of the
WS handshake by the supabase-js client when a session is present).

### 6.13 `display` role for kiosks

A new value joins `tenant_staff.role`:

```
admin | manager | door | bar | dj | promoter | display
```

`display` is intended for the staff laptop hard-wired to the projector
HDMI input.  It has **read-only** access to the live event and zero
write privileges anywhere.  A venue manager creates one
`tenant_staff` row per projector and signs the kiosk into a dedicated
auth account (e.g. `tv@lapocha.nightgraph.es`).  Both `display` and `admin`
can open `/tv/music`.

### 7.1 OAuth flow

`Onboarding.tsx` exposes two buttons:

1. **Continue with Apple** — demo skip (calls `setScreen('hub')`).
   Real Apple OAuth requires Sign in with Apple registration which is
   out of scope for the MVP demo.
2. **Continue with Google** — `supabase.auth.signInWithOAuth({
   provider: 'google', options: { redirectTo: window.location.origin } })`.

The browser navigates to Google, the user authenticates, Supabase
returns to our origin with the session in the URL hash. The Supabase JS
client (`detectSessionInUrl: true`) parses the hash, writes to
cookie storage, and `onAuthStateChange` fires `SIGNED_IN`.

`Onboarding` listens for that event and advances `setScreen('hub')`. If
Supabase isn't configured, the button falls through to `setScreen('hub')`
so the CEO demo never breaks.

### 7.2 Cross-subdomain SSO

**Without** explicit configuration, Supabase's default storage is
`localStorage`, which is host-scoped — logging in at
`lapocha.nightgraph.es` doesn't carry over to `kapital.nightgraph.es`.

We replaced it with a **custom cookie storage** in
`app/lib/supabase.client.ts`. The cookie's `Domain` attribute is
computed at runtime:

| Hostname | Domain attribute |
|---|---|
| `localhost`, `127.0.0.1` | (none — host-only) |
| `1.2.3.4` (IPv4) | (none — host-only) |
| `*.pages.dev` | (none — Cloudflare preview) |
| `kapital.nightgraph.es` | `.nightgraph.es` |
| `nightgraph.es` | `.nightgraph.es` |

The cookie name is the Supabase default (`sb-<projectRef>-auth-token`)
— we explicitly removed the previous `storageKey: "lapocha-auth"` so
that **every subdomain reads the same cookie**. One Google login →
authenticated everywhere on `*.nightgraph.es`.

Other settings: `SameSite=Lax`, `Secure` only on HTTPS, 30-day
`max-age`. Storage adapter is synchronous (Supabase JS accepts both),
and gracefully no-ops on the server (no `document`).

### 7.3 JWT propagation to the API

`analytics.ts → buildHeaders()` pulls the live access token via
`supabase.auth.getSession()` (which itself reads the cookie) and adds
`Authorization: Bearer <jwt>` to every outbound request. The Worker
verifies the JWT on every `api.track` / `api.wallet` call and rewrites
any `user_id` field from the verified `user.id`.

Pre-login analytics still ingest (no JWT → anonymous events with
`user_id = NULL`). Pre-login wallet writes are 401.

---

## 8. Multi-tenant resolution

### 8.1 Slug extraction

Shared helper in `app/lib/tenant.tsx`:

```ts
extractSlugFromHost("lapocha.nightgraph.es")   → "lapocha"
extractSlugFromHost("kapital.nightgraph.es")   → "kapital"
extractSlugFromHost("localhost")           → "lapocha" (demo)
extractSlugFromHost("127.0.0.1")           → "lapocha" (demo)
extractSlugFromHost("web-juegos.pages.dev")→ "lapocha" (preview)
extractSlugFromHost("nightgraph.es")            → ""       (apex → 404)
```

The same helper is used by:

- `root.loader` for theming + tenant lookup,
- `api.track` (`hostnameToSlug`) for analytics,
- `api.wallet` (inline `extractSlugFromHost`) for wallet ops.

### 8.2 Loader

`root.tsx → loader`:

1. Skip `/api/*` paths (resource routes don't need tenant context).
2. Extract slug from `request.url.hostname`. Empty slug → 404.
3. `getSupabase(context)` — if not configured *and* slug is `lapocha`,
   return `FALLBACK_TENANT` (in-memory demo). Otherwise 503.
4. `SELECT id, slug, name, theme, status FROM tenants WHERE slug = ?`.
   No row → 404. Error → 500 (with `lapocha` falling back to in-memory).
5. Merge `theme` over `DEFAULT_THEME`, return `{ tenant }`.

### 8.3 Context propagation

`root.tsx → App` reads `useLoaderData<typeof loader>()` and wraps the
Outlet in `TenantProvider value={tenant}`. Any descendant calls
`useTenant()` to read it. `AppFrame.tsx` consumes the theme and injects
CSS custom properties.

The Worker never relies on the in-memory provider — it always
re-resolves the tenant from the slug coming in via the request payload,
header, or hostname (strict, no fallback).

---

## 9. Observability

- **Cloudflare Workers Observability** is enabled in `wrangler.json`
  (`observability: { enabled: true }`). All `console.warn` lines from
  the action handlers land in the Worker logs and are searchable from
  the Cloudflare dashboard.
- **Event sourcing** is its own observability layer: every user
  interaction generates a `behavior_events` row with a JSONB metadata
  blob (GIN-indexed for fast `?` operators). Funnel analytics, retention
  cohorts, and per-action drop-off charts read directly from this table.
- **Audit logs** (`audit_logs` in `05_scalability_ready.sql`) hold the
  operational trail: staff actions, token grants, override events, IP
  addresses. Append-only, RLS-protected.

---

## 10. Security model — defence in depth

| Layer | Control |
|---|---|
| **Transport** | HTTPS only (Cloudflare) + `Secure` cookies in production |
| **CORS** | Strict allowlist; no wildcards; per-origin `Allow-Origin` |
| **Cookies** | `SameSite=Lax`, `Secure`, root-domain scoped for SSO |
| **CSRF** | Same-origin POST + JSON body + Bearer JWT (not cookies) prevents browser-issued cross-site requests |
| **AuthN** | Supabase Auth + Google OAuth (Apple available) |
| **AuthZ** | RLS policies on every table key on `tenant_id` from JWT claim |
| **JWT verification** | `auth.getUser(token)` server-side on every privileged write |
| **Identity** | Verified `user.id` ALWAYS overrides client-supplied `user_id` |
| **Token economy** | atomic `spend_tokens` RPC with `SELECT FOR UPDATE`; RPC is `REVOKE` from PUBLIC/anon/authenticated, granted to `service_role` only |
| **Worker secrets** | `SUPABASE_SERVICE_ROLE_KEY` lives in `.dev.vars` (gitignored) + Cloudflare Workers Secrets in prod |
| **Anti-screenshot** | Ticket "burn protocol" uses a continuous GSAP wave + dynamic short code; a screenshot is visually static and easily detected by staff |
| **Rate limits** | not yet implemented at the worker layer — relying on Supabase's per-key throttling and Cloudflare's edge protections (TODO: per-tenant token bucket) |

---

## 11. Internationalisation

- **Languages**: `es` (canonical), `en`.
- **Coverage**: every screen, drawer, modal, toast, ARIA label. ~470
  keys.
- **Pluralization**: i18next plural suffixes (`_one`, `_other`) used in
  the Tinder reward copy.
- **Markup interpolation**: `<Trans i18nKey=… components={{strong: …}}>`
  for sentences with embedded `<strong>` (viral CTA in Hub).

Adding a new language requires:

1. Add the resource block in `app/lib/i18n.ts`.
2. Add the language code to `supportedLngs`.
3. Add a label to the `lang.es / lang.en / lang.fr / …` keys.
4. Add it to the `LANGS` array in `LanguageSwitch.tsx`.

No other files need touching — every string is keyed.

---

## 12. Build & deploy

### 12.1 Local development

```
npm install
cp .dev.vars.example .dev.vars       # fill in Supabase keys
cp .env.example .env                  # fill in VITE_ keys
npm run dev                           # vite dev server on :5173
```

`react-router dev` runs Vite with the Cloudflare plugin in Worker
emulation mode, so `context.cloudflare.env` works exactly as in
production. HMR is fully wired (React Fast Refresh + Vite).

### 12.2 Production build

```
npm run build      # outputs to ./build (client + server bundles)
```

Two bundles:

- `build/client/` — static assets, served by the Worker.
- `build/server/` — the SSR worker bundle (~1.9 MB unminified, ~280 KB
  gzipped). Includes the route handlers, React server runtime,
  Tailwind CSS.

### 12.3 Deploy

```
npm run deploy     # wrangler deploy
```

Or simply push to `main` if the Cloudflare Pages integration is wired
(it is, via GitHub). The Pages build runs `npm run build` and uploads
both bundles. Re-deploy time: ~25 s.

Cloudflare Pages and Workers Secrets are managed separately:

| Source | Variable | Audience |
|---|---|---|
| `wrangler.json` `vars` | `VALUE_FROM_CLOUDFLARE`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | worker (public-ish, set in source) |
| Cloudflare Workers Secrets | `SUPABASE_SECRET_KEY` | worker only, **never in source** |
| Vite `.env` (build-time) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | bundled into the browser |

The new Supabase API key naming has fully replaced the legacy `anon` /
`service_role` labels. Nothing in our code still references those.
The seeder (`scripts/seed-dashboard.ts`) keeps a one-line fallback to
the legacy env names so a partially-migrated dev box doesn't break,
but the production deploy uses the new names everywhere.

### 12.4 Typecheck

```
npm run cf-typegen   # wrangler types + react-router typegen
npx tsc -b           # full project type check
npm run build        # vite/router does its own type pass during transform
```

The `typecheck` script in `package.json` has a typo (`typegen` instead
of `cf-typegen`) — running `cf-typegen` + `tsc -b` manually is the
working path. Fixing the script is a 1-line patch on the next pass.

---

## 13. Performance budget & verified numbers

| Metric | Target | Current |
|---|---|---|
| First paint (cached) | < 800 ms | ~500 ms (Cloudflare edge) |
| Time-to-interactive | < 1.5 s | ~1.1 s on iPhone SE / 4G |
| Frame rate during GSAP | 60 FPS | 60 FPS on iOS 16+ (post-perf-pass) |
| Worker cold start | < 50 ms | < 30 ms on warm region |
| API `/track` p50 | < 100 ms | ~60 ms (single edge round-trip) |
| API `/track` p99 | < 300 ms | ~250 ms |
| Edge throughput target | 100+ req/s per tenant | Supavisor pool (port 6543) for sustained writes |
| Client bundle | < 350 KB gzipped | 319 KB (`home-*.js` 102 KB gzipped + react-router chunk) |
| Server bundle | < 2 MB | 1.9 MB unminified, ~570 KB minified |

---

## 14. Known limitations & next-quarter migration plan

### Limitations

- **Wallet is local-first.** Token mutations in the original demo
  screens (SecretMenu, Jukebox, LiveBattle boost, Tinder reward) live
  in Zustand (`useGameState`). `/api/wallet` is built and tested but
  not yet wired into those spend paths — current spends update the
  client store only. **The Rewards path IS wired**: any UI calling
  `useRewards().purchase(...)` goes through `/api/rewards →
  purchase_reward(...)` and is the canonical pattern to follow when
  porting the rest.
- **Music inventory needs seeding.** `/api/music` is wired and the
  `DJDashboard` polls it correctly, but `event_tracks` and
  `tenant_events` are empty until a tenant operator seeds them. The
  Tinder Musical screen still reads from the in-memory `DECK` const;
  swapping it for `useMusic(eventId)` is a 10-line change.
- **No real Apple OAuth.** Button skips to hub.
- **`useGameState` ignores `auth_user_id`.** Real user identity from
  Supabase Auth isn't yet mapped into the demo store; the demo profile
  is hardcoded (`Alejandro Vega`). Onboarding needs to upsert into
  `user_profiles` on first `SIGNED_IN`.
- **Reward reaper.** `user_rewards` rows whose `expires_at < now()`
  stay as `redeeming` forever. A pg_cron job or a worker cron trigger
  flipping them to `expired` is one SQL function away.
- **No Realtime channel.** Live battle votes drift via a 3.5s
  `setInterval`; the production version should subscribe to
  `track_votes` filtered by the active event. DJ dashboard polling
  (5s) is good enough for the MVP.

### Migration plan

What's already done (post 07-growth-and-realtime):

- ✅ `/api/rewards` wired with `purchase_reward` + `start_reward_redemption`.
- ✅ `/api/music` wired with `vote_track` + DJ leaderboard polling.
- ✅ `/api/wallet` exists with atomic `spend_tokens`.
- ✅ `/api/auth-sync` upserts profile + consumes the tracking cookie.
- ✅ Cookie-based cross-subdomain SSO.
- ✅ New Supabase key naming (`PUBLISHABLE_KEY` / `SECRET_KEY`).
- ✅ Universal attribution engine (`tracking_campaigns` + `?ref=` capture).
- ✅ Supabase Realtime publication on `event_tracks` + `behavior_events`.
- ✅ `/tv/music` Jumbotron with cookie-auth, `display` role, and Realtime.

What's next, in order:

1. **Wire `/api/wallet` into Zustand spend paths.** Replace
   `useGameState.spendTokens / addTokens` with thin wrappers that POST
   to `/api/wallet`. Keep the optimistic update; reconcile on response.
   Failure → revert + toast.
2. **Onboarding writes `user_profiles`.** On `SIGNED_IN`, upsert
   `(tenant_id, auth_user_id, email)` and seed the welcome 450 tokens
   via `/api/wallet`. Read profile id → store.
3. **Port Tinder Musical to `/api/music`.** Replace the in-memory
   `DECK` const in `TinderMusical.tsx` with `useMusic(eventId).deck`.
   Hook into the existing GSAP swipe handler — `castVote()` returns
   the new `total_votes` for the optimistic UI.
4. **Replace mock leaderboard.** Hub's `LeaderboardCard` reads
   `user_profiles ORDER BY lifetime_earned DESC LIMIT 3 WHERE tenant_id
   = ?` via PostgREST. Index already exists.
5. **Seed `event_tracks` for the demo.** Add a section to the seeder
   that creates one `tenant_events` row and ~20 `event_tracks` so the
   Tinder + DJ flows have real content out of the box.
6. **Reward reaper.** Add a SQL function `expire_old_rewards()` and
   schedule it (pg_cron or CF cron trigger) to flip stale `redeeming`
   rows to `expired`.
7. **Realtime votes.** Subscribe to `track_votes` filtered by the
   active event; replace the LiveBattle `setInterval` drift and the
   DJ-dashboard polling.
8. **Wire `tenant_products` into Secret Menu and Jukebox.** Current
   catalogs are hardcoded; move them to `tenant_products` and let each
   tenant edit pricing without a code change.
9. **Audit logging.** Every privileged write in `api.wallet` and
   `api.rewards` writes an `audit_logs` row with `{ actor_id, action,
   table_name, record_id, old_data, new_data, ip_address }`. RLS on
   this table is read-only for the `admin` role.

---

## 15. Decision log (the *why* behind the *what*)

| Decision | Rationale |
|---|---|
| **React Router 7 + Cloudflare Workers** (not Next.js) | One Worker handles SSR + API; no Node container; free edge cache; same TS/Vite tooling. |
| **Zustand over Redux/Context** | Selector hooks, no provider, no boilerplate; built-in persist middleware; the entire store is < 300 lines. |
| **`sessionStorage` for Zustand**, **cookies for Supabase auth** | Game state is per-tab (you don't want a "ticket active" to persist across browser launches); auth is per-user across tabs *and* subdomains. |
| **GSAP over Framer Motion** | Original demo used `motion`; we migrated because (a) GSAP's `Draggable` is best-in-class for the Tinder swipe, (b) the `gsap-performance` skill gives us a clear performance playbook, (c) `useGSAP()` cleanup is more aggressive than Framer's. |
| **Tailwind v4 over v3** | Native CSS-vars syntax (`bg-(--var)`), automatic JIT, faster builds. The Cloudflare Vite plugin's `@tailwindcss/vite` integration is first-class. |
| **CQRS (ledger + projection)** | Append-only audit + O(1) reads. The trigger makes the projection correct-by-construction. |
| **Service-role-only RPC** | The TOCTOU race between SELECT and INSERT was real; SQL FOR UPDATE is the only correct fix; locking down the function ensures only the trusted worker can call it. |
| **Strict tenant resolution (no defaults)** | The cost of accidentally writing one venue's data to another is unrecoverable. Better to surface 400 in dev than to ship a silent leak. |
| **Cookie SSO** | The product is white-label; users need to log into `lapocha.nightgraph.es` once and walk into `kapital.nightgraph.es` with the same session. `localStorage` would have made every venue a separate auth domain. |
| **Offline queue in `localStorage`** | The phones inside the venue have terrible Wi-Fi; the queue is what makes 60 % of the events actually arrive. |
| **`keepalive: true` fetch** | Survives page-unload; the venue users will absolutely close the tab mid-tween. |
| **i18n inline (no HTTP namespaces)** | The MVP is one document; the keys fit in the bundle; no race condition between hydration and language load. |
| **Hardcoded splash in `home.tsx`** | Cheapest possible SSR placeholder to avoid hydration mismatches around browser-only modules (GSAP, supabase-js, Zustand persist). |

---

## 16. Operational runbook

### Rotating the Supabase service-role key

1. Generate a new key in the Supabase dashboard.
2. Update Cloudflare Workers Secret: `wrangler secret put
   SUPABASE_SERVICE_ROLE_KEY`.
3. Update `.dev.vars` for local devs (not committed).
4. Revoke the old key in Supabase. Zero downtime — Workers re-read the
   secret on the next request.

### Adding a new tenant

```sql
insert into tenants (slug, name, status, theme)
values ('coliseum', 'Coliseum BCN', 'active', jsonb_build_object(
  'primary',    '#FFD700',
  'secondary',  '#FF3CAC',
  'accent',     '#39FF14',
  'background', '#0A0A0A'
));
```

Then:

- Cloudflare DNS: add `coliseum.nightgraph.es` CNAME to the Worker route.
- Supabase Auth → URL Configuration: add `https://coliseum.nightgraph.es` to
  Site URL / Redirect URLs.
- (Optional) Run a tenant-scoped seeder (`SEED_TENANT_SLUG=coliseum
  npm run seed`).

No code change required.

### Adding a new game / screen

1. Add the literal to the `Screen` union in `useGameState.ts`.
2. Create the screen under `app/screens/NewGame.tsx` (use the existing
   screens as templates — `flex-1 min-h-0 overflow-hidden`, GSAP scope,
   tracked via `trackEvent`).
3. Add the case to `ScreenRouter` in `LaPochaApp.tsx`.
4. Add the tile to `GameLauncherCard.tsx`.
5. Add i18n keys to `i18n.ts` for both `es` and `en`.

The fullscreen-vs-bottom-nav decision is made by the
`SCREENS_WITH_NAV` set in `LaPochaApp.tsx`.

### Inspecting a user's token history

```sql
select created_at, amount, reason, metadata
from   wallet_ledger
where  tenant_id = (select id from tenants where slug = 'lapocha')
  and  user_id   = (select id from user_profiles
                    where  tenant_id = (select id from tenants where slug = 'lapocha')
                      and  email     = 'someone@example.com')
order by created_at desc;
```

The trigger guarantees `user_profiles.token_balance` and
`lifetime_earned` are consistent at any point in time — no
recompute needed.

---

## 17. Glossary

| Term | Meaning |
|---|---|
| **Tenant** | A single nightclub. Has its own slug, theme, feature flags, economy. |
| **Promoter** | A parent group operating multiple tenants. |
| **Slug** | Lowercase URL-safe identifier (`lapocha`, `kapital`). |
| **Token** | The in-app currency. Earned in games, burned at the bar. |
| **CQRS** | Command Query Responsibility Segregation — write to ledger, read from projection. |
| **TOCTOU** | Time-of-check / time-of-use race. Prevented here by `SELECT FOR UPDATE`. |
| **RLS** | Row Level Security — Postgres native tenant isolation. |
| **JWT** | JSON Web Token. Carries `user.id`, expiry, and (optionally) `tenant_id` claim. |
| **Service role** | The Supabase API key that bypasses RLS. Worker-only. |
| **Anon key** | The Supabase API key for public clients. Subject to RLS. |
| **Behaviour event** | A single user action persisted as one row in `behavior_events`. |
| **Visit** | One contiguous presence of a user inside the venue, drives cohort analytics. |
| **Boost** | A premium action that consumes tokens for an upgraded effect (Vote x5, Song jump-to-top). |
| **Ticket** | A redeemable claim on a product at the bar. Anti-fraud via GSAP-animated burn. |
| **NIGHTGRAPH** | The internal codename for the enterprise multi-tenant upgrade defined in `05_scalability_ready.sql`. |
