# RTK vs Squeezr — Comparación punto a punto

> Última actualización: Squeezr v1.10.0

---

## 1. Arquitectura

| | RTK | Squeezr |
|---|---|---|
| **Capa** | Shell — intercepta stdout antes de entrar al contexto | API — intercepta la request HTTP antes de llegar al proveedor |
| **Mecanismo** | Wrapper de comandos en el shell (`rtk git diff`) | Proxy HTTP local (`localhost:8080`) |
| **Qué ve** | Solo la salida del comando actual | Todo el historial acumulado en la conversación |
| **Cuándo actúa** | Turno 1 únicamente | Todos los turnos |
| **Instalación** | Binario en PATH | `npm install -g squeezr-ai` |

---

## 2. Uso

| | RTK | Squeezr |
|---|---|---|
| **Prefijo manual** | ✅ Requerido: `rtk git diff`, `rtk vitest run`... | ❌ Ninguno — proxy transparente |
| **Cambios en el workflow** | Todos los comandos deben prefijarse | Cero cambios |
| **Error humano** | Si olvidas `rtk`, no se comprime nada | Imposible olvidarlo |
| **Comandos encadenados** | `rtk git add . && rtk git commit && rtk git push` | `git add . && git commit && git push` |
| **Control explícito por tool** | Implícito (solo comprime con prefijo) | ✅ `skip_tools`/`only_tools` en config + `# squeezr:skip` por comando |

---

## 3. Cobertura de patrones — Bash tool

Ambos cubren los mismos ~30 patrones. Los checkmarks indican soporte:

| Patrón | RTK | Squeezr | Notas |
|---|---|---|---|
| `git diff` / `git show` | ✅ -80% | ✅ -80% | Squeezr añade "Changed: fn1, fn2" en diffs grandes |
| `git log` | ✅ | ✅ | Squeezr cap adaptativo: 30/20/10 según presión |
| `git status` | ✅ | ✅ | |
| `git branch` | ✅ | ✅ | Cap 20 ramas |
| `cargo test` | ✅ -90% | ✅ -90% | Solo fallos |
| `cargo build/check/clippy` | ✅ -85% | ✅ -85% | Solo errores/warnings |
| `vitest` / `jest` | ✅ -99% | ✅ -99% | Solo fallos + summary |
| `playwright` | ✅ | ✅ | Solo ✘ + trazas de error |
| `pytest` / tracebacks Python | ✅ | ✅ | |
| `go test` | ✅ | ✅ | Solo `--- FAIL` blocks |
| `tsc` | ✅ -83% | ✅ -83% | Errores agrupados por archivo |
| `eslint` / `biome` | ✅ -84% | ✅ -84% | Sin URLs de reglas |
| `prettier --check` | ✅ -70% | ✅ -70% | Solo archivos que necesitan format |
| `next build` | ✅ -87% | ✅ -87% | Route table + errores |
| `pnpm/npm install` | ✅ -90% | ✅ -90% | Solo línea de summary |
| `pnpm/npm list` | ✅ -70% | ✅ -70% | Solo deps directas |
| `pnpm/npm outdated` | ✅ -80% | ✅ -80% | Cap 30 paquetes |
| `npx` noise | ✅ | ✅ | |
| `terraform plan/apply` | ✅ | ✅ | Resource changes + Plan line |
| `docker ps` | ✅ -65% | ✅ -65% | |
| `docker images` | ✅ | ✅ | Sin dangling images |
| `docker logs` | ✅ | ✅ | Últimas 50 líneas |
| `kubectl get` | ✅ | ✅ | |
| `prisma` CLI | ✅ -88% | ✅ -88% | Sin ASCII art |
| `gh pr view` | ✅ -87% | ✅ -87% | |
| `gh pr checks` | ✅ -79% | ✅ -79% | |
| `gh run list` | ✅ -82% | ✅ -82% | |
| `gh issue list` | ✅ -80% | ✅ -80% | |
| `curl -v` | ✅ -70% | ✅ -70% | Sin verbose headers |
| `wget` | ✅ -65% | ✅ -65% | Solo resultado final |

---

## 4. Patrones exclusivos de Squeezr

| Feature | RTK | Squeezr | Descripción |
|---|---|---|---|
| **Diff function summary** | ❌ | ✅ | Diffs >100 líneas llevan `Changed: fn1, fn2` extraído de los `@@` headers |
| **Semantic Read** | ❌ | ✅ | Archivos `.ts/.js/.py/.go/.rs` >500 líneas → solo imports + firmas top-level; cuerpos omitidos |
| **Stack trace dedup** | ❌ | ✅ | Misma traza repetida N veces en logs → `[same 5-frame stack trace repeated]` |
| **Generic error extractor** | Manual `rtk err <cmd>` | ✅ Auto | Detecta outputs error-densos y extrae líneas de error ± contexto automáticamente |
| **Cross-turn Read dedup** | ❌ | ✅ | Mismo archivo leído 3 veces → 2 lecturas antiguas reemplazadas por referencia |

---

## 5. Compresión de historial

| | RTK | Squeezr |
|---|---|---|
| **Turno 1** (output actual) | ✅ Filtra inmediatamente | ✅ Pasa determinístico |
| **Turno 20** (mismo output de antes) | ❌ No puede tocarlo | ✅ Lo comprime a ~200 chars |
| **System prompt** (~13KB) | ❌ | ✅ Comprimido una vez, cacheado para siempre (-71%) |
| **Mensajes usuario/asistente** | ❌ | ✅ Opt-in (`compress_conversation = true`) |
| **Compresión AI fallback** | ❌ Solo patrones | ✅ Haiku / GPT-4o-mini / Gemini Flash 8B para outputs no reconocidos |

---

## 6. Optimizaciones de sesión

| | RTK | Squeezr |
|---|---|---|
| **Session cache** | ❌ | ✅ Bloques idénticos a requests anteriores saltan toda la pipeline |
| **KV cache warming** | ❌ | ✅ IDs deterministas (MD5) preservan el prefix cache de Anthropic — 90% descuento en tokens ya vistos |
| **Presión adaptativa** | ❌ | ✅ Patrones y thresholds se ajustan automáticamente a 4 niveles (50/75/90%) |
| **Determinístico adaptativo** | ❌ | ✅ A >90% presión: diff a 0 líneas de contexto, log cap 10, grep 4/file |

---

## 7. Herramientas / Read / Grep

| | RTK | Squeezr |
|---|---|---|
| **Grep agrupado por archivo** | ✅ `rtk grep` | ✅ Automático en Grep tool |
| **Read con lockfiles** | ❌ | ✅ `package-lock.json` → `[lockfile — 8,432 lines, ~1,200 packages]` |
| **Read head+tail** | ❌ | ✅ Archivos >200 líneas → head(100) + tail(80) |
| **Read semántico** | ❌ | ✅ Archivos >500 líneas (TS/JS/Py/Go/Rust) → imports + signatures |
| **Glob → directory summary** | ❌ | ✅ >30 archivos → agrupados por directorio |
| **Cross-turn Read dedup** | ❌ | ✅ Mismo archivo leído varias veces → colapsa lecturas antiguas |

---

## 8. Multi-cliente

| Cliente | RTK | Squeezr |
|---|---|---|
| **Claude Code** (API key) | ✅ | ✅ |
| **Claude Code** (suscripción OAuth) | ❌ | ✅ — OAuth token reutilizado para Haiku |
| **Codex CLI** | ❌ | ✅ (GPT-4o-mini) |
| **Aider** (OpenAI o Anthropic) | ❌ | ✅ |
| **OpenCode** | ❌ | ✅ |
| **Gemini CLI** | ❌ | ✅ (Gemini Flash 8B) |
| **Ollama / LM Studio** | ❌ | ✅ (modelo local configurable) |

---

## 9. Configuración

| | RTK | Squeezr |
|---|---|---|
| **Config global** | CLAUDE.md con instrucciones | `squeezr.toml` en directorio de instalación |
| **Config por proyecto** | ❌ | ✅ `.squeezr.toml` en raíz del proyecto (mergea sobre global) |
| **Variables de entorno** | ❌ | ✅ `SQUEEZR_THRESHOLD`, `SQUEEZR_PORT`, `SQUEEZR_DRY_RUN`... |
| **Dry-run mode** | ❌ | ✅ `SQUEEZR_DRY_RUN=1` — preview sin comprimir |
| **Compression model** | N/A | ✅ Configurable por proveedor |

---

## 10. Observabilidad

| | RTK | Squeezr |
|---|---|---|
| **Stats de ahorro** | `rtk gain` | `squeezr gain` |
| **Stats en tiempo real** | ❌ | ✅ `GET /squeezr/stats` (JSON) |
| **Pattern coverage report** | `rtk discover` | `squeezr discover` (consulta proxy en vivo) |
| **Cache hit rate** | ❌ | ✅ Disk cache + session cache hits |
| **Context pressure** | ❌ | ✅ Loguea cuando >50% |
| **Expand / recuperar original** | ❌ | ✅ `squeezr_expand(id)` o `GET /squeezr/expand/:id` |

---

## 11. Ahorro típico en sesión de 2 horas

| Escenario | Tokens usados |
|---|---|
| Sin ninguna herramienta | ~200K |
| Solo RTK | ~130K (-35%) |
| Solo Squeezr | ~80K (-60%) |
| RTK + Squeezr | ~50K (-75%) |

> Nota: RTK sigue siendo útil como primera línea de defensa — filtra en turno 1 antes de que el output entre al contexto. Squeezr comprime lo que ya está acumulado. Usados juntos son complementarios, no redundantes.

---

## 12. Resumen ejecutivo

**Elige RTK si:**
- Quieres filtrar outputs de comandos específicos en el momento (turno 1)
- Solo usas Claude Code y prefieres prefijado manual

**Elige Squeezr si:**
- Quieres compresión automática sin cambiar nada en tu workflow
- Tus sesiones son largas (>30 turnos) y el historial acumula mucho contexto
- Usas varios clientes AI (Codex, Aider, Gemini, Ollama)
- Quieres compresión AI para outputs no reconocidos

**Úsalos juntos para el máximo ahorro:**
RTK reduce lo que entra en turno 1. Squeezr comprime lo que se acumula a lo largo de la sesión. El efecto es multiplicativo.
