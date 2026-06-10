# `_future/` — Componentes UI/UX en barbecho

Código **válido y valioso** que NO está montado en el árbol activo porque
todavía no tiene soporte de backend. No se borra: se preserva para el
sprint que conecte su tabla/RPC. No lo importa nadie de `/app` activo.

| Componente | Qué necesita para revivir |
|---|---|
| `MissionRow.tsx` | Tabla `missions` con metas acumulables (progreso N/M). Hoy las misiones reales las pinta `hub/MissionsCard.tsx` desde `daily_activity`. |
| `ViralLoopCard.tsx` | Pipeline de referidos por-usuario: RPC `redeem_referral` + código de invitación propio. La atribución base (`ng_tracking_ref`, reward `friend_referral`) ya existe. |

> Regla: cada archivo aquí es autocontenido (sin depender de tipos del
> store) para que `_future/` nunca rompa `tsc`.
