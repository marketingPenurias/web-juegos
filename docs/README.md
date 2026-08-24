# Documentación · NightGraph

Toda la documentación vive aquí. En la raíz del repo sólo quedan `README.md`
(presentación) y `CLAUDE.md` (instrucciones para Claude Code).

## Estado y planificación
| Documento | Para qué |
|---|---|
| [`V20_WORKLOG.md`](V20_WORKLOG.md) | **Bitácora viva**: qué se ha cambiado, por qué y qué falta. *Leer esto primero al retomar.* |
| [`ROADMAP_AGOSTO.md`](ROADMAP_AGOSTO.md) | Plan del mes, separado por persona (producto / BI). |

## Diseño y referencia técnica
| Documento | Para qué |
|---|---|
| [`DISENO_PROMOCIONES.md`](DISENO_PROMOCIONES.md) | **Especificación** del sistema de promociones, niveles y disponibilidad. Base del panel de configuración. |
| [`DB_MODEL.md`](DB_MODEL.md) | Modelo completo de la BD (tablas, RLS, funciones, cron). Introspectado de la BD real. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Arquitectura de la aplicación. |
| [`analytics.md`](analytics.md) | Modelo dimensional del BI (star schema). |
| [`GRAPHIFY_SETUP.md`](GRAPHIFY_SETUP.md) | Grafo de conocimiento del código: cómo se instaló y cómo se usa. |

## Otros
- [`negocio/`](negocio) — material de negocio (niveles, plan de tokens y descuentos).
- [`historico/`](historico) — auditorías y reportes de sprints ya cerrados. No refleja el estado actual.

## Fuera de `docs/`
- `database/*.sql` — migraciones numeradas (espejo de lo aplicado en Supabase).
- `.claude/` — configuración de Claude Code (skills y ajustes), no documentación.
- [HANDOFF_BI_ETL.md](HANDOFF_BI_ETL.md) — traspaso a BI: el ETL de `fact_rewards` y la medición de campañas.
