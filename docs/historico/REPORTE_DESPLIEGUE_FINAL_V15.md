# 🚀 Reporte de Despliegue Final · Sprint Nightgraph V1.5

**Estado:** ✅ COMPLETADO · Listo para producción
**Typecheck:** `npx react-router typegen && npx tsc --noEmit` → **EXIT 0** (verde en cada bloque).
**Nueva dependencia:** `qrcode.react@^4.2.0` (QR client-side, offline) — requiere `npm install` antes del build.

---

## 1. Resumen consolidado y definitivo (qué incluye V1.5)

### Base de datos (ya aplicada a producción)
- **`09_v15_sprint.sql`** — tablas `global_tracks`, `qr_strategies` (`kind` libre), `live_battles`; `venue_visits.qr_code/source`; seed de hitos de racha (2→+50, 4→+100, 8→+300) y 3 QRs (`POCHA-ENTRADA-01/BANO-01/BARRA-01`). RPCs: `process_checkin`, `get_user_streak`, `admin_open_party`, `admin_bulk_insert_global`, `admin_add_event_track` (dedupe), `admin_set_now_playing` (exclusión mutua), `admin_start_battle` / `resolve_due_battles` / `admin_force_close_battle`, `get_admin_metrics`, `is_tenant_staff`, `grant_signup_bonus`. Realtime: `live_battles` publicado.
- **`10_admin_realtime.sql`** — `wallet_ledger`, `venue_visits`, `track_votes` añadidas a la publicación + RLS `*_staff_read` (tenant + `is_tenant_staff`). Publicación final: `behavior_events, event_tracks, live_battles, wallet_ledger, venue_visits, track_votes`.

### Bloque 1 — Bugs, UX, Fidelidad
- **Tinder**: keys por `song.id` + limpieza GSAP (`killTweensOf`) + reset de refs por deck → fin de "carta congelada".
- **Catálogo**: badges "Próximamente"/"Vuelve otro día" discretos en esquina (no pisan nombre/precio en móvil).
- **Misiones reactivas**: `markDaily` optimista → check verde instantáneo.
- **Check-in/Streak/QR**: `/api/checkin`, página `/checkin`, **flujo frío** (guarda código sin sesión → procesa tras login, navegación SPA con `useNavigate`).
- **Modal bienvenida one-shot** (+100, `is_new_user` del JIT, `welcomeSeen` persistido).
- **Perfil**: botones inactivos → toast "Próximamente". **Branding** "Powered by Nightgraph" en el footer.

### Bloque 2 — Ticket Anti-fraude
- **Tutorial primer canje** (gate `redeemTutorialSeen`).
- **Hold-to-burn** (2s GSAP, reverse al soltar, consume solo al 100%).
- **Anti-capturas** (wave + código parpadeante + anillo rotando).

### Bloque 4 — Panel `/admin` (DJ/Staff)
- Gating por `tenant_staff`. "Abrir Fiesta de Hoy". Edición de evento (nombre + horas **Europe/Madrid** vía `Intl`). Carga masiva con parser a prueba de comas internas (bloques `(...)` + regex de comillas). Biblioteca→Pista con dedupe ("Añadida"). Editar/borrar tracks. "Sonando Ahora" (exclusión mutua). Batalla: iniciar + **autocierre por timer** + forzar cierre. **Métricas 100% Realtime** (5 tablas suscritas, sin polling), token nunca cacheado, playlist viva.

### Bloque 3 — TV / Jumbotron (`/tv/dashboard`)
- **Leaderboard** GSAP (re-sort por slot, counter tween, pulso del líder).
- **Modo Duelo sincronizado** (suscripción `live_battles`): toma el escenario, cuenta atrás, barras **enfrentadas** (A izq. / B der.); al cerrarse vuelve al Top.
- **QR gigante** generado 100% en cliente con `qrcode.react` (offline, sin APIs externas ni rate-limits).
- **Resolución de batalla local-first** (protege la BD: solo consulta si falta una canción).

### Móvil — sincronización en vivo
- **Now Playing global**: barra que escucha `is_played=true` (exclusión mutua del DJ) y muestra portada/título/artista + enlace a **Spotify** (limpia el prefijo `spotify:track:`).
- **LiveBattle sincronizado**: el duelo es global server-managed (`live_battles`); todos los usuarios ven el mismo enfrentamiento + cuenta atrás; porcentajes en vivo; **reconciliación de `already_voted`** (si recarga, bloquea la botonera en vez de error genérico).

### Transversal
- **Analytics reparado**: eventos anónimos ya no mueren con 401; escritura con service-role (la RLS los bloqueaba). `behavior_events` vuelve a registrar.

---

## 2. Pasos de despliegue

```bash
# 1. Instalar dependencias (incluye la nueva qrcode.react)
npm install

# 2. Verificar tipos y build de producción EN LOCAL (gate de CI)
npm run typecheck        # react-router typegen + tsc -b
npm run build            # react-router build → genera /build

# 3. Commit + push a main (dispara Cloudflare Workers Builds)
git add -A
git commit -m "feat(v1.5): check-in/QR, streak, ticket anti-fraude, panel DJ /admin, Jumbotron /tv/dashboard, Now Playing + LiveBattle sync, analytics fix"
git push origin main

# 4. Cloudflare auto-despliega el Worker al hacer push a `main`.
#    Verifica el build en el dashboard de Cloudflare (Workers & Pages → Builds).
```

> **BD:** las migraciones `09` y `10` ya están aplicadas en producción (Supabase). **No re-aplicar.** El código nuevo es compatible con ese esquema.
>
> **Asegúrate** de que `package.json` (con `qrcode.react`) y `package-lock.json` van en el commit, para que el build de Cloudflare instale la dependencia.

---

## 3. Checklist de Smoke Test (validación en vivo, esta noche)

**Onboarding & Hub**
- [ ] Login Google → aparece el **modal de bienvenida (+100)** una sola vez (recargar: no reaparece).
- [ ] Hub muestra saldo real, racha y checks de misiones.

**Juegos**
- [ ] **Ruleta**: girar → +15 al instante; 2ª tirada → toast "ya giraste hoy" y el saldo se corrige solo.
- [ ] **Tinder**: swipe sin "carta congelada"; completar 5 → +25; la misión queda en verde sin recargar.
- [ ] **Jukebox**: "Pedir" (+20) y "Boost" (−50 real); títulos con coma se ven bien.

**Menú Secreto & Ticket**
- [ ] Badges legibles en móvil (no pisan nombre/precio).
- [ ] Primer "Canjear" → **tutorial** anti-fraude; tras aceptar, compra.
- [ ] Pantalla camarero: **mantener pulsado 2s** quema (soltar antes → barra vuelve a 0); fondo en movimiento (anti-captura).

**Check-in (QR físico)**
- [ ] Escaneo **con sesión** → recompensa + racha; 2º escaneo del mismo QR esa noche → "ya checkeado".
- [ ] Escaneo **sin sesión (flujo frío)** → te lleva a login y, al entrar, procesa el check-in automáticamente.

**/admin (cuenta staff)**
- [ ] Usuario sin rol → "Acceso restringido". Con rol → panel.
- [ ] "Abrir Fiesta de Hoy" crea el evento activo.
- [ ] Pegar canciones en formato `('id','TÍTULO','Artista, con coma','cover')` → se cargan bien.
- [ ] "+" en biblioteca pasa a la pista y queda "Añadida" (dedupe).
- [ ] Editar **hora de inicio** → se guarda en hora de Madrid correcta.
- [ ] "Sonando Ahora" en una canción apaga la anterior (solo una activa).
- [ ] Métricas (votos/tokens/check-ins/jugadores) se mueven en vivo sin recargar.
- [ ] "Iniciar Batalla" (X min) y "Forzar Cierre".

**Sincronización en vivo (2 móviles + TV)**
- [ ] Al marcar "Sonando Ahora", la barra **Now Playing** aparece en los móviles con enlace a Spotify.
- [ ] Al "Iniciar Batalla", **ambos móviles** ven el MISMO duelo con cuenta atrás; al votar, los % suben en vivo en los dos.
- [ ] Recargar el móvil tras votar → la botonera sigue bloqueada ("Ya has votado en este duelo").
- [ ] La batalla **se autocierra** al expirar el tiempo y los móviles vuelven a la normalidad.

**/tv/dashboard (Jumbotron)**
- [ ] Leaderboard reordena con animación al subir votos.
- [ ] **QR escaneable** (probar con un móvil real) → abre la app del tenant.
- [ ] Al iniciar batalla, la TV pasa a **modo DUELO** con barras enfrentadas + cuenta atrás; al cerrarse, vuelve al Top.

---

## 4. Rollback rápido (por si acaso)
- **Código:** `git revert <commit>` + push → Cloudflare redepliega la versión anterior.
- **BD:** las migraciones 09/10 son aditivas (tablas/policies nuevas); no rompen el esquema previo. Si hiciera falta, desactivar features desde `tenant_token_rewards.is_active` o `qr_strategies.is_active` sin tocar código.

---

🎉 **Sprint V1.5 cerrado.** Arquitectura asimétrica Realtime de grado empresarial, Jumbotron sin dependencias externas, economía server-authoritative y typecheck en verde. ¡A producción!
