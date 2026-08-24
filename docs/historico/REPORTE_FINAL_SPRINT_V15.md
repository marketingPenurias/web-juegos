# 🚀 Reporte Final Consolidado · Sprint Nightgraph V1.5
**Fecha:** 2026-05-29 · **Estado:** PENDIENTE DE TU VISTO BUENO PARA PUSH A GITHUB
**Typecheck:** `npx react-router typegen && npx tsc --noEmit` → **EXIT 0** (limpio).

> Nada pusheado a github todavía. La BD de producción tiene aplicadas las migraciones de este sprint (09 y 10), que aprobaste sobre la marcha. Build final (`npm run build`) a correr en tu local/CI antes del deploy — en el sandbox no compila por un binario nativo de rollup que falta (entorno, no código).

---

## 1. Base de datos (aplicado a producción)

**`database/09_v15_sprint.sql`** — tablas `global_tracks`, `qr_strategies` (`kind` TEXT libre), `live_battles`; columnas `venue_visits.qr_code/source`; seed de hitos de racha (2→+50, 4→+100, 8→+300) y 3 QRs (`POCHA-ENTRADA-01/BANO-01/BARRA-01`). RPCs: `process_checkin`, `get_user_streak` (semanas ISO, reset si gap ≥2), `admin_open_party`, `admin_bulk_insert_global`, `admin_add_event_track` (dedupe), `admin_set_now_playing` (**exclusión mutua**), `admin_start_battle` + `resolve_due_battles` + `admin_force_close_battle`, `get_admin_metrics`, `is_tenant_staff`, `grant_signup_bonus`. Realtime: `live_battles` añadido a la publicación.

**`database/10_admin_realtime.sql`** — añade `wallet_ledger`, `venue_visits`, `track_votes` a `supabase_realtime` + políticas RLS `*_staff_read` (tenant + `is_tenant_staff`) para que el dashboard del DJ reciba esos cambios SOLO siendo staff. Publicación final: `behavior_events, event_tracks, live_battles, wallet_ledger, venue_visits, track_votes`.

---

## 2. Bloque 1 — Bugs, UX, Fidelidad

- **Tinder (bug crítico)** `TinderMusical.tsx`: keys por `song.id`, reset de refs por firma de deck, `killTweensOf` + neutralización de la carta descartada.
- **Catálogo badge** `SecretMenu.tsx`: "Próximamente"/"Vuelve otro día" → pill discreto en esquina absoluta + `pr-20`/`line-clamp-2` (no pisa nombre/precio en móvil).
- **Misiones reactivas**: `markDaily` optimista en Ruleta/Tinder/LiveBattle/Jukebox → check verde al instante.
- **Check-in / Streak / QR**: `api.checkin.ts` (→ `process_checkin`), página `checkin.tsx` (landing del QR con celebración + hito), **flujo frío** (`usePendingCheckin.ts` + `CheckinResultModal.tsx`): QR sin sesión → guarda código en localStorage, navega a login (SPA), procesa tras autenticarse.
- **Modal bienvenida one-shot** `WelcomeModal.tsx`: `is_new_user` del JIT (`api.session.ts`) + `welcomeSeen` persistido.
- **Perfil + Branding** `Profile.tsx` (toasts "Próximamente"), `BottomNav.tsx` ("Powered by Nightgraph" con logo).
- **Sesión** `api.session.ts` devuelve `streak` + `is_new_user`; propagados por `useSession.ts` + `useGameState.ts`.

## 3. Bloque 2 — Ticket Anti-fraude

- **Tutorial primer canje** (`SecretMenu.tsx`, flag `redeemTutorialSeen`): "No quemes el ticket hasta estar delante del camarero".
- **Hold-to-burn** (`RedemptionScreen.tsx`): mantener pulsado 2s (barra GSAP); soltar antes → vuelve a 0 al instante; solo al 100% consume.
- **Anti-capturas**: ya existía (wave + código parpadeante + anillo) — conservado.

## 4. Bloque 4 — Panel `/admin` (DJ/Staff)

- `admin-handler.server.ts` (`/api/admin`): gating por `is_tenant_staff`, ops `bootstrap/open_party/update_event/bulk_global/add_track/update_track/remove_track/now_playing/start_battle/force_close_battle/resolve_battles/metrics`. Parser de carga masiva a prueba de comas internas (bloques `(...)` + regex de comillas; fallback TAB/PIPE).
- `admin.tsx`: "Abrir Fiesta", edición de evento (nombre + horas en **Europe/Madrid** vía `Intl`), biblioteca→pista con dedupe, edición/borrado de tracks, "Sonando Ahora", batalla (iniciar + forzar cierre + **autocierre por timer** → `resolve_battles`). **Métricas 100% Realtime** (sin polling): canal suscrito a las 5 tablas que alimentan `get_admin_metrics`; token nunca cacheado (`getAccessToken()` por llamada); playlist mutada en vivo (`applyTrackChange`).

## 5. Bloque 3 — TV / Jumbotron

- `Jumbotron.tsx` extendido (props opt-in, `/tv/music` intacto) + ruta **`/tv/dashboard`** (`tv.dashboard.tsx` + `tv-dashboard-handler.server.ts`).
- **Leaderboard en vivo** con GSAP (re-sort por slot, counter tween, pulso del líder).
- **Modo Duelo sincronizado**: suscripción a `live_battles`; si entra `live`, oculta el Top y muestra enfrentamiento con cuenta atrás + barras GSAP; al cerrarse, vuelve al leaderboard. Votos del duelo vivos vía `event_tracks`.
- **QR gigante** "Escanea para pedir tu canción" → URL del tenant (QR real vía servicio con fallback a placeholder SVG offline).

## 6. Transversal

- **Analytics reparado** `analytics-handler.server.ts`: `verifyAuthToken` ya no tumba eventos anónimos (try/catch) + escritura con service-role (la RLS bloqueaba los inserts). `behavior_events` vuelve a registrar.

---

## 7. Verificación
- ✅ `tsc --noEmit` limpio tras cada bloque y tras los fixes de auditoría (token, realtime, parser, timezone, playlist viva, autocierre).
- ⚠️ `npm run build` no corre en el sandbox (falta binario nativo `@rollup/rollup-linux-x64-gnu`, no es código). **Correr en local antes del push.**

## 8. No incluido (transparencia — siguiente iteración)
- **Now Playing en el móvil del usuario** (componente global que lea `is_played`): la infraestructura está (RPC `admin_set_now_playing` con exclusión mutua + `event_tracks` en Realtime), falta el componente cliente.
- **LiveBattle del móvil sincronizado a `live_battles`**: hoy el duelo global está server-managed y el TV lo refleja; la pantalla `LiveBattle.tsx` del móvil sigue con el flujo de voto por usuario (no escucha `live_battles`).

## 9. Orden de despliegue sugerido
1. `npm run build` local → verde.
2. Las migraciones 09 y 10 ya están en prod (no re-aplicar).
3. Push a `main` → auto-deploy del worker en Cloudflare.
4. Smoke test: login (modal bienvenida) · escanear QR sin sesión (flujo frío) · `/admin` con cuenta staff (abrir fiesta, carga masiva, sonando ahora, batalla) · `/tv/dashboard` (leaderboard + QR + duelo).

---

### Archivos nuevos
`09_v15_sprint.sql`, `10_admin_realtime.sql`, `api.checkin.ts`, `checkin.tsx`, `usePendingCheckin.ts`, `CheckinResultModal.tsx`, `WelcomeModal.tsx`, `useClaim.ts`*, `admin-handler.server.ts`, `api.admin.ts`, `admin.tsx`, `tv-dashboard-handler.server.ts`, `tv.dashboard.tsx`.
<sub>*useClaim.ts es de la fase previa de economía.</sub>

### Archivos modificados (V1.5)
`routes.ts`, `api.session.ts`, `useSession.ts`, `useGameState.ts`, `analytics-handler.server.ts`, `TinderMusical.tsx`, `SecretMenu.tsx`, `RuletaRondas.tsx`, `LiveBattle.tsx`, `Jukebox.tsx`, `Profile.tsx`, `BottomNav.tsx`, `Hub.tsx`, `LaPochaApp.tsx`, `RedemptionScreen.tsx`, `Jumbotron.tsx`.
