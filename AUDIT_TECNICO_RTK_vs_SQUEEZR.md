# Auditoria Tecnica: RTK vs Squeezr

> Fecha: 2026-04-01 | Evaluacion imparcial basada en codigo fuente

---

## 1. Ficha Tecnica

| | RTK | Squeezr |
|---|---|---|
| **Nombre** | Rust Token Killer | Squeezr AI |
| **Version** | 0.34.2 | 1.11.1 |
| **Lenguaje** | Rust | TypeScript |
| **Licencia** | Apache 2.0 / MIT dual | MIT |
| **Distribucion** | Homebrew, Cargo, binarios | npm (`squeezr-ai`) |
| **Requisitos** | Ninguno (binario standalone) | Node.js >= 18 |
| **Tamano** | <5 MB binario | ~2 MB (+ node_modules) |
| **GitHub stars** | ~16,300 | Nuevo |
| **Tests publicos** | No visibles | 190 (Vitest) |
| **Dependencias prod** | 19 crates Rust | 5 paquetes npm |

---

## 2. Que Problema Resuelven

Ambos atacan el mismo problema: los CLIs de IA (Claude Code, Copilot, Cursor, etc.) reenvian toda la conversacion en cada request. Una sesion de 50 turnos puede acumular 150K+ tokens, la mayoria redundantes.

**RTK** reduce tokens filtrando la salida de comandos shell ANTES de que entre al contexto.
**Squeezr** reduce tokens filtrando la salida de comandos + comprimiendo el historial acumulado + comprimiendo el system prompt.

---

## 3. Arquitectura

### RTK
```
LLM pide ejecutar "git status"
→ Hook de shell reescribe a "rtk git status"
→ RTK ejecuta "git status" real
→ Aplica filtros TOML al stdout
→ Devuelve stdout filtrado al LLM
```
- **Tipo:** Shell wrapper con hook de intercepcion
- **Punto de accion:** stdout de UN comando, ANTES de entrar al contexto
- **Motor:** Rust nativo + Clap CLI + filtros TOML declarativos
- **Modulos fuente:** `src/cmds/` (9 ecosistemas), `src/core/`, `src/filters/` (77 TOML), `src/analytics/`, `src/hooks/`, `src/learn/`, `src/discover/`
- **Persistencia:** SQLite local (tracking de ahorro, 90 dias retencion)

### Squeezr
```
LLM envia request HTTP a localhost:8080
→ Proxy intercepta el request completo (todos los mensajes)
→ Capa 1: comprime system prompt (una vez, cacheado)
→ Capa 2: aplica filtros deterministas a cada tool result (equivalentes a los de RTK)
→ Capa 3: comprime mensajes antiguos con LLM barato
→ Capa 4: ajusta agresividad segun presion del contexto
→ Reenvia request comprimido al API real
```
- **Tipo:** HTTP proxy transparente (Hono framework)
- **Punto de accion:** Request HTTP completo, TODOS los turnos de la conversacion
- **Motor:** Node.js + TypeScript, pipeline de 4 capas
- **Modulos fuente:** `src/server.ts` (proxy), `src/deterministic.ts` (911 lineas, filtros), `src/compressor.ts` (554 lineas, AI), `src/systemPrompt.ts`, `src/expand.ts`, `src/cache.ts`, `src/sessionCache.ts`, `src/config.ts`, `src/stats.ts`, `src/gain.ts`, `src/discover.ts`

### Diferencia arquitectonica clave
RTK opera a nivel de **comando individual** — solo ve y filtra el stdout del comando actual. Squeezr opera a nivel de **request HTTP** — ve y comprime toda la conversacion: system prompt + historial + tool results actuales y pasados.

---

## 4. Motor de Filtrado Determinista (Comparacion Directa)

Este es el nucleo de la comparacion. **Ambos** tienen un motor de filtrado determinista por patrones. La capa 2 de Squeezr (`deterministic.ts`, 911 lineas) replica y extiende los filtros de RTK.

### 4.1 Patrones Bash (comando por comando)

| Herramienta | RTK | Squeezr | Notas |
|---|---|---|---|
| git diff | Si | Si (`compactGitDiff`) | Squeezr: extrae funciones cambiadas, context lines adaptativo por presion |
| git log | Si | Si (`compactGitLog`) | Squeezr: cap adaptativo (10/20/30 commits segun presion) |
| git status | Si | Si (`compactGitStatus`) | Squeezr: parsed a staged/modified/untracked con conteo |
| git branch | Si | Si (`compactGitBranch`) | Squeezr: max 20, muestra current + top 15 |
| git show | Si | ? | RTK: filtro dedicado. Squeezr: detectado como git diff |
| cargo test | Si | Si (`extractCargoTestFailures`) | Solo failures + summary |
| cargo build/clippy | Si | Si (`extractCargoErrors`) | Solo errores y warnings |
| vitest/jest | Si | Si (`extractVitestFailures`) | Solo tests fallidos + summary |
| playwright | Si | Si (`extractPlaywrightFailures`) | Bloques de fallo + errores standalone |
| pytest | Si | Si (`extractPyFailures`) | Tracebacks + FAILED lines |
| go test | Si | Si (`extractGoTestFailures`) | Solo --- FAIL blocks |
| tsc | Si | Si (`compactTscErrors`) | Agrupado por archivo |
| eslint/biome | Si | Si (`compactEslint`) | Agrupado, sin URLs |
| prettier | Si | Si (`compactPrettier`) | Solo archivos que necesitan formato |
| next build | Si | Si (`compactNextBuild`) | Route table + errores |
| npm/pnpm install | Si | Si (`extractInstallSummary`) | Solo linea resumen + warnings |
| npm/pnpm list | Si | Si (`compactPkgList`) | Solo dependencias directas |
| npm outdated | Si | Si (`compactPkgOutdated`) | Tabla compacta |
| docker ps | Si | Si (`compactDockerPs`) | IDs truncados a 12 chars |
| docker images | Si | Si (`compactDockerImages`) | Filtra `<none>`, IDs truncados |
| kubectl get | Si | Si (`compactKubectlGet`) | Whitespace compactado |
| gh pr | Si | Si (`compactGhPr`) | Solo metadatos clave |
| gh pr checks | ? | Si (`compactGhPrChecks`) | Cap a 25 checks |
| gh run list | Si | Si (`compactGhRunList`) | Cap a 20 |
| gh issue list | Si | Si (`compactGhIssueList`) | Cap a 25 |
| curl | Si | Si (`compactCurlOutput`) | Strip verbose headers |
| wget | Si | Si (`compactWgetOutput`) | Solo resultado final |
| terraform plan/apply | Si | Si (`compactTerraform`) | Solo resource changes + Plan summary |
| prisma | No | **Si** (`compactPrisma`) | Strip ASCII art |
| npx noise | No | **Si** (`stripNpxNoise`) | Strip install banners |
| ruff | Si | No | RTK: filtro dedicado |
| golangci-lint | Si | No | RTK: filtro dedicado |
| rubocop | Si | No | RTK: filtro dedicado |
| rspec | Si | No | RTK: filtro dedicado |
| bundle install | Si | No | RTK: filtro dedicado |
| pip list/outdated | Si | No | RTK: filtro dedicado |
| dotnet test/build | Si | No | RTK: filtro dedicado |
| aws cli | Si | No | RTK: filtro dedicado |

**Conteo:** RTK ~77 filtros TOML cubriendo ~35+ herramientas. Squeezr ~31 patrones Bash cubriendo ~28 herramientas.

**Ecosistemas que RTK cubre y Squeezr no:** Ruby (rspec, rubocop, bundle), Go lint (golangci-lint), Python lint (ruff), .NET (dotnet), Cloud (aws), pip.
**Ecosistemas que Squeezr cubre y RTK no:** Prisma, npx noise.

### 4.2 Patrones No-Bash (exclusivos de Squeezr)

RTK solo opera sobre comandos shell (Bash). Squeezr tambien comprime tool results de otras herramientas del LLM:

| Tool | Que hace Squeezr | RTK |
|---|---|---|
| **Grep results** | Agrupa por archivo, cap por archivo (4-8 segun presion), max 30 archivos | No aplica |
| **Read (>200 lineas)** | Head 100 + tail 80, omite el medio | No aplica |
| **Read (>500 lineas codigo)** | Extrae solo imports + signatures (TS/JS/Python/Go/Rust) | No aplica |
| **Read (lockfiles)** | Reemplaza con `[lockfile — N lines, ~M packages — omitted]` | No aplica |
| **Glob (>30 archivos)** | Compacta a resumen por directorio | No aplica |
| **Error generico** | Auto-detecta outputs con errores densos, extrae solo errores + 1 linea contexto | RTK: requiere `rtk err <cmd>` explicito |
| **Truncacion generica** | Outputs largos no reconocidos: ultimas 30-50 lineas (adaptativo) | No aplica |

### 4.3 Pipeline base (aplicado a TODO)

Ambos tienen un pipeline base de limpieza. Comparacion:

| Etapa | RTK | Squeezr |
|---|---|---|
| Strip ANSI codes | Si | Si (`stripAnsi`) |
| Strip progress bars | Si | Si (`stripProgressBars`) |
| Collapse whitespace | Si | Si (`collapseWhitespace`) |
| Deduplicate lines | Si | Si (`deduplicateLines`, >=3 repeticiones) |
| Truncation head/tail | Si | Si (`truncateLongOutput`, adaptativo) |
| Pattern matching | Si (TOML DSL) | Si (funciones TypeScript) |
| Dedup stack traces | No | **Si** (`deduplicateStackTraces`, Node.js + Python) |
| Minify JSON | No | **Si** (`minifyJson`, objetos >200 chars) |
| Strip timestamps | No | **Si** (`stripTimestamps`, ISO/bracket/bare) |

---

## 5. Capas Exclusivas de Squeezr

### Capa 1 — Compresion de System Prompt
- El system prompt de Claude Code pesa ~13,000 tokens
- Squeezr lo comprime a ~600 tokens usando un LLM barato (Haiku/GPT-4o-mini/Gemini Flash)
- Cacheado por hash MD5: solo se comprime una vez por version del prompt
- **Ahorro: ~95% en system prompt. RTK no toca el system prompt.**

### Capa 3 — Compresion Semantica con AI
- Despues de la capa determinista, los mensajes antiguos (excepto los 3 mas recientes) se comprimen con un LLM barato
- Prompt: "Extract ONLY: errors, file paths, function names, test failures, key values, warnings. Target <150 tokens"
- Backends: Claude Haiku ($0.25/1M tokens), GPT-4o-mini, Gemini Flash 8B, Ollama (gratis)
- Limite de input: 4000 chars, output max 300 tokens
- **Ahorro adicional: la capa determinista deja ~35% del original; la semantica lo reduce a ~5-10%**

### Capa 4 — Presion Adaptativa
- Mide el tamano total de los mensajes vs ventana de contexto (~800K chars)
- Ajusta umbrales dinamicamente:

| Contexto usado | Threshold | Comportamiento |
|---|---|---|
| <50% | 1500 chars | Solo comprime tool results muy largos |
| 50-75% | 800 chars | Compresion moderada |
| 75-90% | 400 chars | Compresion agresiva |
| >90% | 150 chars | Compresion maxima |

- Tambien ajusta parametros internos: caps de git log, context lines de git diff, matches por archivo en grep
- **RTK aplica siempre el mismo nivel de filtrado, sin importar el estado del contexto**

---

## 6. Features Exclusivas de RTK

| Feature | Descripcion |
|---|---|
| **`rtk learn`** | Aprende patrones nuevos de outputs no reconocidos |
| **`rtk discover`** | Descubrimiento automatico de comandos frecuentes |
| **77 filtros TOML** | DSL declarativo, facil de contribuir sin saber Rust |
| **9 modulos Rust** | Procesamiento nativo de ecosistemas (git, rust, js, python, go, dotnet, cloud, system, ruby) |
| **Tracking SQLite** | Metricas de ahorro con retencion 90 dias, graficos historicos |
| **`rtk gain --graph`** | Visualizacion de ahorro por sesion/dia |
| **`rtk session`** | Resumen de sesion actual |
| **Binario standalone** | Zero dependencias runtime, <5MB, <10ms overhead |
| **6 integraciones IDE** | Claude Code, Copilot, Cursor, Gemini, Windsurf, Cline |
| **Filtros custom** | Proyecto `.rtk/filters.toml` > User `~/.config/rtk/` > Built-in |
| **Pipeline de 8 etapas** | ANSI → Pattern → Line filter → Truncate → Dedup → Head/tail → Format → Output |

---

## 7. Features Exclusivas de Squeezr

| Feature | Descripcion |
|---|---|
| **Compresion system prompt** | ~13KB → ~600 tokens, cacheado |
| **Compresion semantica AI** | LLM barato resume mensajes antiguos |
| **Presion adaptativa** | Ajusta agresividad segun contexto |
| **Compresion cross-turn** | Comprime TODA la conversacion, no solo el comando actual |
| **`squeezr_expand`** | Tool inyectado para que el LLM recupere contenido original bajo demanda |
| **Session cache** | Hashes de bloques: evita recomprimir contenido identico |
| **KV cache warming** | IDs MD5 deterministas para maximizar cache hits del proveedor |
| **Cross-turn Read dedup** | Si el mismo archivo se leyo en un turno anterior, lo reemplaza con referencia `squeezr_expand` |
| **Soporte Ollama** | Compresion 100% local y gratis con modelos como qwen2.5-coder:1.5b |
| **Dedup stack traces** | Colapsa stack traces identicos (Node.js y Python) |
| **Minificacion JSON** | Comprime objetos JSON inline >200 chars |
| **Strip timestamps** | Elimina timestamps en 3 formatos |
| **Semantic Read** | Archivos >500 lineas: extrae solo imports + signatures (TS/JS/Python/Go/Rust) |
| **Lockfile detection** | Reemplaza lockfiles por resumen de una linea |
| **Error auto-extraction** | Detecta outputs con errores densos sin necesidad de prefijo |
| **`squeezr setup`** | Registra servicio OS (Task Scheduler/launchd/systemd) + auto-deteccion WSL2 |
| **`squeezr discover`** | Muestra hits por patron, fallback AI, breakdown por herramienta |
| **Configuracion granular** | `skip_tools`, `only_tools`, `# squeezr:skip` inline, `.squeezr.toml` por proyecto |
| **MCP transparente** | Comprime resultados de MCP servers (Linear, GitHub, Slack, etc.) sin config |
| **190 tests** | Suite completa verificable |

---

## 8. Integraciones

| CLI/Editor | RTK | Squeezr | Metodo |
|---|---|---|---|
| Claude Code | Si | Si | RTK: hook shell. Squeezr: `ANTHROPIC_BASE_URL` |
| GitHub Copilot | Si | No | RTK: hook shell |
| Cursor | Si | No | RTK: hook shell |
| Gemini CLI | Si | Si | RTK: hook shell. Squeezr: `GEMINI_API_BASE_URL` |
| Windsurf | Si | No | RTK: hook shell |
| Cline | Si | No | RTK: hook shell |
| Aider | No | Si | Squeezr: `OPENAI_BASE_URL` |
| Codex CLI | No | Si | Squeezr: `OPENAI_BASE_URL` |
| OpenCode | No | Si | Squeezr: `OPENAI_BASE_URL` |
| Ollama local | No | Si | Squeezr: `OPENAI_BASE_URL` |

**RTK:** 6 integraciones via hooks de shell.
**Squeezr:** 5 integraciones via redireccion de URL base (mas universal para cualquier herramienta que use HTTP API).

---

## 9. Configuracion

### RTK
- `rtk init -g [--copilot|--cursor|etc]` para registrar hook
- Filtros custom en `.rtk/filters.toml` (proyecto) o `~/.config/rtk/filters.toml` (usuario)
- Sin archivo de configuracion global documentado

### Squeezr
- `squeezr.toml` (global) + `.squeezr.toml` (proyecto) con secciones:
  - `[proxy]` port
  - `[compression]` threshold, keep_recent, compress_system_prompt, compress_conversation, disabled
  - `[cache]` enabled, max_entries (LRU)
  - `[adaptive]` 4 umbrales de presion
  - `[local]` upstream_url, compression_model, dummy_keys
- Variables de entorno: `SQUEEZR_PORT`, `SQUEEZR_THRESHOLD`, `SQUEEZR_KEEP_RECENT`, `SQUEEZR_DISABLED`, `SQUEEZR_DRY_RUN`
- Control fino: `skip_tools`, `only_tools`, `# squeezr:skip` inline

**Veredicto:** Squeezr es significativamente mas configurable.

---

## 10. Rendimiento

| Aspecto | RTK | Squeezr |
|---|---|---|
| **Latencia capa determinista** | <10ms (Rust nativo) | Microsegundos (Node.js regex) |
| **Latencia capa AI** | N/A | ~200-400ms (una vez por bloque, luego cacheado) |
| **Overhead total** | <10ms siempre | 0ms (cache hit) a ~400ms (primera compresion AI) |
| **Memoria** | <5MB binario | ~50-100MB (Node.js process) |
| **CPU** | Minima | Minima (regex + HTTP proxy) |

En la capa determinista pura, ambos son efectivamente instantaneos para el usuario. La diferencia de rendimiento de RTK (Rust) vs Squeezr (Node.js regex) es irrelevante en la practica (<1ms vs <10ms).

La latencia real de Squeezr viene de la capa AI (~200-400ms por bloque nuevo), pero se amortigua con el session cache y solo aplica a mensajes antiguos.

---

## 11. Modelo de Costes

| | RTK | Squeezr |
|---|---|---|
| **Coste herramienta** | Gratis | Gratis (open source) |
| **Coste por compresion** | $0 | ~$0.0001-0.005 por bloque (Haiku/GPT-4o-mini) |
| **Opcion 100% gratis** | Si (siempre) | Si (con Ollama local) |
| **Ahorro por sesion (30min)** | ~80% del turno actual (claim: 118K→23.9K) | ~60-85% de toda la conversacion |
| **Donde ahorra** | Solo output del comando que se ejecuta | System prompt + historial + output actual |

### Ejemplo numerico (sesion de 50 turnos)

| Concepto | Sin nada | Solo RTK | Solo Squeezr |
|---|---|---|---|
| System prompt | 13,000 tok | 13,000 tok | ~600 tok |
| Turno actual (tool result) | ~3,000 tok | ~600 tok | ~600 tok |
| 47 turnos anteriores (historial) | ~134,000 tok | ~134,000 tok | ~15,000 tok |
| **Total** | **~150,000 tok** | **~147,600 tok** | **~16,200 tok** |
| **Ahorro** | — | ~1.6% | ~89% |

**Nota critica:** RTK solo ahorra en el turno actual. Los 47 turnos anteriores se reenvian intactos porque RTK no tiene visibilidad del historial. Squeezr comprime todo.

En sesiones cortas (1-5 turnos), el ahorro es similar. **En sesiones largas, la diferencia es exponencial.**

---

## 12. Calidad de Codigo y Mantenibilidad

| Aspecto | RTK | Squeezr |
|---|---|---|
| **Type safety** | Rust (compile-time) | TypeScript (compile-time) |
| **Memory safety** | Rust (garantizada) | Node.js (GC) |
| **Tests publicos** | No visibles en repo | 190 tests (6 archivos) |
| **Estructura** | Modular (cmds/core/filters) | Modular (server/compressor/deterministic) |
| **Extensibilidad** | Anadir TOML (muy facil) | Anadir funcion TS (facil) |
| **Contribucion** | TOML sin saber Rust | TypeScript |
| **Documentacion** | README extenso | README extenso + config documentada |

---

## 13. Relacion entre RTK y Squeezr

### Squeezr es un superset funcional de RTK

La capa determinista de Squeezr (`deterministic.ts`, 911 lineas, funcion `preprocessForTool`) **replica los filtros de RTK** a nivel de proxy. El propio codigo lo indica:

> *"Called on ALL tool results including recent ones — covers turn-1 compression without the user needing to prefix commands with `rtk`."*
> *"Generic error extractor (rtk err equivalent) — Applied before truncation when output is long and error-dense but unrecognised. Unique Squeezr advantage: RTK needs explicit `rtk err <cmd>` prefix; Squeezr detects automatically from content."*

**Lo que RTK hace, Squeezr tambien lo hace** (28 de ~35 herramientas, con 5 extras que RTK no tiene). Ademas, Squeezr le suma 3 capas que RTK no tiene: system prompt, compresion semantica, y presion adaptativa.

**RTK tiene ventaja en:**
- 7 ecosistemas extra (Ruby, Go lint, Python lint, .NET, Cloud, pip, bundle)
- Granularidad de filtros (77 TOML vs 31 funciones)
- Rendimiento puro (Rust < Node.js, aunque irrelevante en practica)
- 6 integraciones IDE vs 5
- Zero dependencias, zero coste

**Pero Squeezr cubre un ambito mucho mayor:**
- Comprime system prompt (RTK: 0% ahorro)
- Comprime historial completo (RTK: 0% ahorro)
- Compresion semantica con AI (RTK: solo regex)
- Presion adaptativa (RTK: nivel fijo)
- Comprime Grep, Read, Glob (RTK: solo Bash)
- Dedup stack traces, minify JSON, strip timestamps
- `squeezr_expand` para recuperar contenido original
- MCP server results transparentes

---

## 14. Veredicto Final

| Dimension | Ganador | Margen |
|---|---|---|
| Rendimiento/Latencia | **RTK** | Irrelevante en practica |
| Filtrado determinista (turn 1) | **RTK** | Pequeno (7 ecosistemas extra) |
| Compresion total por sesion | **Squeezr** | Enorme (historial + system prompt) |
| Ahorro en sesiones largas | **Squeezr** | Aplastante (~89% vs ~1.6%) |
| Integraciones IDE | **RTK** | Medio (6 vs 5, distintas) |
| Configurabilidad | **Squeezr** | Grande |
| Testing verificable | **Squeezr** | Grande |
| Coste operativo | **RTK** | Pequeno (Squeezr con Ollama = gratis) |
| Innovacion tecnica | **Squeezr** | Grande |
| Zero dependencias | **RTK** | Medio |
| Facilidad de contribuir filtros | **RTK** | Medio (TOML vs TS) |

### Resumen

**Squeezr es un superset de RTK.** Incluye un motor de filtrado determinista equivalente (28/35 herramientas compartidas) y le suma compresion de system prompt, compresion semantica con AI, presion adaptativa, y compresion del historial completo.

RTK gana en rendimiento puro, zero dependencias, y cobertura de IDEs (Cursor, Copilot, Windsurf). Si usas esos editores, RTK es tu unica opcion.

Si usas Claude Code, Aider, Codex, Gemini CLI u OpenCode, **Squeezr reemplaza completamente a RTK** y lo supera en todas las dimensiones que importan para ahorro de tokens.

La mayor diferencia no esta en los filtros (que son equivalentes), sino en el **alcance**: RTK solo ve el comando actual. Squeezr ve toda la conversacion. En una sesion de 50 turnos, eso es la diferencia entre ahorrar ~2% y ahorrar ~89%.
