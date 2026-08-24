# Instalación de Graphify · web-juegos

Documento de lo que se instaló y configuró el **24/07/2026** para mapear el
código del proyecto en un grafo de conocimiento y **reducir el consumo de
tokens** de Claude Code.

---

## 1. Qué es y para qué

[Graphify](https://github.com/safishamsi/graphify) convierte el código en un
**grafo de conocimiento consultable** (nodos = funciones/tipos/archivos, aristas =
relaciones entre ellos). En vez de que el asistente lea 10 archivos para
orientarse ante una pregunta, consulta el grafo y salta directo al `archivo:línea`
correcto → **mucho menos contexto por pregunta = menos tokens**.

- El parseo del código es **local** (tree-sitter AST). Para un proyecto de puro
  código (como este, todo TS/TSX) **no gasta tokens de modelo** al construir el grafo.
- No necesita ninguna API key.

---

## 2. Requisitos (ya presentes en la máquina)

- **uv** `0.11.31` (gestor de paquetes Python) — `/opt/homebrew/bin/uv`
- **Python** `3.14.5`

---

## 3. Pasos ejecutados

### 3.1 Instalar la herramienta (entorno aislado de uv)

```bash
uv tool install graphifyy    # ⚠️ el paquete es "graphifyy" (doble y); el comando es "graphify"
```

Instaló 2 ejecutables: `graphify` y `graphify-mcp` (versión `0.9.25`). Queda en el
entorno de `uv` (`~/.local/share/uv/tools/graphifyy/`), **no** dentro del proyecto.

### 3.2 Instalar la skill en el proyecto

```bash
graphify install --project --platform claude
```

- `--project` → la instala en `./.claude/` de **este** repo (no global).
- `--platform claude` → integración con Claude Code.
- **NO** se usó `--strict` a propósito (ese modo *bloquea* la lectura de archivos
  hasta consultar el grafo; se prefirió el modo *advisory*, que solo avisa).

### 3.3 Construir el grafo del código

Se ejecutó el pipeline de la skill sobre la carpeta **`app/`** (el código fuente):

```
detect → AST (local) → build → clustering → etiquetado → HTML
```

Se mapeó `app/` (y no la raíz entera) **a propósito**: evita procesar los PDFs de
negocio de `.claude/docs/` (esos sí gastarían tokens de modelo por extracción
semántica). El resultado es 100% código → **cero tokens de modelo**.

---

## 4. Resultado del grafo

| Métrica | Valor |
|---|---|
| Carpeta mapeada | `app/` |
| Archivos | 94 (todo TS/TSX) |
| Nodos | 514 |
| Relaciones (aristas) | 1.293 |
| Comunidades detectadas | 16 |
| Tokens de modelo gastados | **0** (extracción AST local) |

**Prueba real:** la consulta *"How does the jukebox vote budget work?"* devolvió
directamente `screens/Jukebox.tsx:77`, `lib/useMusic.ts:111`,
`components/live/VoteFooter.tsx`… sin leer ningún archivo.

---

## 5. Archivos creados / modificados

| Ruta | Qué es | ¿Al control de versiones? |
|---|---|---|
| `.claude/skills/graphify/` | La skill (SKILL.md + references) | **Sí** |
| `.claude/settings.json` | Hooks `PreToolUse` (ver §6) | **Sí** ⚠️ afecta a quien use Claude Code en el repo |
| `.claude/CLAUDE.md` | Instrucciones de la skill | **Sí** |
| `CLAUDE.md` (raíz) | Se le añadió una sección "graphify" | **Sí** |
| `.gitignore` | Se añadió `graphify-out/` | **Sí** |
| `graphify-out/` | El grafo generado (`graph.json`, `graph.html`, `GRAPH_REPORT.md`, …) | **No** — ignorado; contiene rutas absolutas de la máquina y es regenerable |

---

## 6. Cómo ahorra tokens (los hooks)

En `.claude/settings.json` se registraron dos hooks **advisory** (no bloquean):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Grep", "hooks": [{ "type": "command",
        "command": "…/graphify hook-guard search" }] },
      { "matcher": "Read|Glob", "hooks": [{ "type": "command",
        "command": "…/graphify hook-guard read" }] }
    ]
  }
}
```

Antes de cada búsqueda/lectura, recuerdan al asistente consultar primero el grafo
(`graphify query "…"`). Devuelven exit 0 → **no interrumpen** el trabajo, solo
orientan.

---

## 7. Uso diario

```bash
# Preguntar al grafo (o simplemente pregúntame; el hook me orienta solo)
graphify query "cómo funciona el check-in"
graphify query "qué llama a vote_track" --dfs        # traza un camino concreto
graphify query "…" --budget 1500                     # limitar tamaño de respuesta

# Camino más corto entre dos conceptos / explicar un nodo
graphify path "Jukebox" "useMusic"
graphify explain "vote_track"
```

- **Ver el mapa visual:** abre `graphify-out/graph.html` en el navegador.
- **Reindexar tras cambios de código:** pídeme `/graphify . --update` (reindexa
  solo lo que cambió; local, sin tokens de modelo). Conviene hacerlo de vez en
  cuando para que el grafo no quede desfasado.

---

## 8. Cómo desinstalar (si algún día molesta)

```bash
graphify uninstall            # quita hooks + skill del proyecto (todas las plataformas)
graphify uninstall --purge    # además borra la carpeta graphify-out/
uv tool uninstall graphifyy   # quita la herramienta de la máquina
```

Y revertir a mano si hiciera falta: quitar la sección "graphify" de `CLAUDE.md` y
la línea `graphify-out/` de `.gitignore`.

---

## 9. Notas / limitaciones

- El **etiquetado automático de comunidades** quedó tosco (p.ej. el backend salió
  como "Hooks y utilidades"). Es solo cosmético: el grafo y las consultas son
  correctos.
- El grafo mapea **`app/`**, no la raíz entera (fuera los PDFs de negocio). Si en
  el futuro quieres incluir `database/*.sql` u otros, se puede reindexar sobre esas
  rutas.
- El grafo es una **foto**: si el código cambia mucho sin reindexar, puede quedar
  algo desactualizado → usar `--update`.
- Ningún cambio se ha **commiteado** todavía (los hooks alteran el comportamiento
  de Claude Code para todo el repo → mejor decidirlo tú, idealmente vía PR).
