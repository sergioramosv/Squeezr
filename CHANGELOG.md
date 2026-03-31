# Changelog

All notable changes to Squeezr will be documented here.

## [1.2.0] - 2026-03-31

### Added
- **RTK-style turn-1 compression** — `preprocessForTool()` applies tool-specific deterministic patterns to ALL tool results including recent ones. No need to prefix commands with `rtk`. Covers: `git diff` (context line reduction), `cargo test/build/clippy` (errors/failures only), `vitest/jest` (failures only), `tsc` (errors grouped by file), `eslint/biome` (grouped, no rule URLs), `pnpm/npm install` (summary only), `Glob` (compact file listings).
- **Deterministic compression is now always on, even for recent blocks** — previously only AI compression was skipped for recent blocks. Now all blocks get at minimum the RTK-style pass.

## [1.1.0] - 2026-03-31

### Added
- **Differential compression** — session-level cache tracks compressed blocks across requests. Blocks identical to a previous request skip the entire pipeline (preprocessing + AI call). In a 100-request session with 40 tool results: ~4,000 Haiku calls → ~200.
- **KV cache warming** — `storeOriginal` now uses a deterministic MD5-based ID instead of random bytes. Identical content always produces the same `[squeezr:id -ratio%]` string, preserving Anthropic's prefix cache across requests (90% cost reduction on unchanged history).
- `sessionCache.ts` — in-memory Map persisting for the lifetime of the proxy session
- `session_cache_hits` counter in stats summary and `/squeezr/stats` endpoint
- `session_cache_size` exposed in `/squeezr/stats`

## [1.0.0] - 2026-03-31

### Changed
- **Full TypeScript rewrite** — entire codebase migrated from Python to TypeScript/Node.js
- **Hono** replaces FastAPI as the HTTP framework — faster startup, no Python runtime needed
- No more `pip install` — pure npm package, install with `npm install -g squeezr`
- Requires Node.js 18+ (was Python 3.9+)

### Added
- **Deterministic preprocessing pipeline** (6 stages before AI compression): strip ANSI codes, strip progress bars, strip timestamps, deduplicate repeated lines, minify inline JSON, collapse whitespace
- **`expand()` feature** — model can call `squeezr_expand(id)` to retrieve original content when needed; Squeezr intercepts the tool call and makes a continuation request transparently
- **Gemini CLI support** (`POST /v1beta/models/*`) — compresses `functionResponse` blocks using Gemini Flash 8B
- **Per-format compression**: Anthropic `tool_result`, OpenAI `role:tool`, Gemini `functionResponse`
- **`GET /squeezr/expand/:id`** endpoint to retrieve stored originals via HTTP
- LRU compression cache with configurable max entries
- System prompt compression with separate cache (`~/.squeezr/sysprompt_cache.json`)
- `src/gain.ts` — TypeScript gain stats CLI replacing `gain.py`

## [0.6.0] - 2026-03-31

### Added
- **Ollama / local LLM support** — requests with dummy keys (`ollama`, `lm-studio`, etc.) are detected as local and routed to Ollama
- **Configurable compression model** — set any model you have installed via `squeezr.toml [local] compression_model` or `SQUEEZR_LOCAL_MODEL` env var
- **`[local]` config section** in `squeezr.toml` with `upstream_url`, `compression_model`, and `dummy_keys`
- `config.is_local_key()` detects local requests from auth key
- `compress_local_messages()` uses Ollama's OpenAI-compatible `/v1` endpoint for compression
- `SQUEEZR_LOCAL_UPSTREAM` and `SQUEEZR_LOCAL_MODEL` env var overrides

### Changed
- `/v1/chat/completions` now checks for local key before routing to OpenAI
- Version bumped to 0.6.0

## [0.5.0] - 2026-03-31

### Added
- **Gemini CLI support** — `/v1beta/models/{model}:generateContent` endpoint intercepts and compresses Gemini requests
- **Gemini Flash 8B compression** — cheapest Google model compresses `functionResponse` parts, reuses `x-goog-api-key` from request
- **Gemini system instruction compression** — `systemInstruction` field compressed via Flash 8B and cached
- **Gemini streaming** — `streamGenerateContent` SSE forwarded transparently
- `system_prompt.py` now supports `use_google=True` for Gemini system prompts
- `extract_google_key()` reads `x-goog-api-key` header or `?key=` query param
- `detect_upstream()` now identifies Google API from headers

### Changed
- `_stream()` helper accepts optional `params` dict for query string forwarding
- Version bumped to 0.5.0

## [0.4.0] - 2026-03-31

### Added
- **OpenAI / Codex CLI support** — `POST /v1/chat/completions` endpoint proxies and compresses Codex requests
- **GPT-4o-mini compression for Codex** — reuses the OpenAI key already in the request, no extra keys needed
- **Smart upstream detection** — catch-all route detects Anthropic vs OpenAI from headers and forwards to the right API
- **OpenAI system message compression** — first `role: "system"` message compressed via GPT-4o-mini
- `openai>=1.0.0` added to requirements

### Changed
- `system_prompt.py` now accepts `use_openai=True` to compress via GPT-4o-mini
- `main.py` refactored: shared `_stream()` helper, dedicated OpenAI endpoint
- Version bumped to 0.4.0

## [0.3.0] - 2026-03-31

### Added
- **System prompt compression** — Haiku compresses Claude Code's ~13KB system prompt on first request and caches it. Estimated -40% per request.
- **Adaptive thresholds** — compression aggressiveness scales with context pressure: low/mid/high/critical tiers based on % of context used
- **Compression cache** — repeated tool results are served from `~/.squeezr/cache.json` at zero Haiku cost. Hit rate shown in `/squeezr/stats`
- **Conversation compression** — opt-in (`compress_conversation = true` in `squeezr.toml`) to also compress old user/assistant messages
- **Auto-start on login** — `install.sh` configures launchd (macOS) or systemd (Linux); `install.ps1` registers a Windows Task Scheduler task
- **`squeezr.toml` config file** — all settings editable in TOML, env vars still override
- **Dry-run mode** — set `SQUEEZR_DRY_RUN=1` to see what would be compressed without modifying requests
- Cache stats (`size`, `hits`, `misses`, `hit_rate_pct`) exposed in `/squeezr/stats`
- Context pressure logged when above 50%

### Changed
- `config.py` reads from `squeezr.toml` first, env vars override
- `requirements.txt` adds `tomli` for Python < 3.11
- Version bumped to 0.3.0

## [0.2.0] - 2026-03-31

### Added
- `gain.py` CLI command — shows token savings with breakdown by tool (Bash, Read, Grep, etc.)
- Per-tool savings tracking in stats (count, chars saved, avg compression %)
- Efficiency bar visualization (24-char block meter)
- Stats persistence to `~/.squeezr/stats.json` across proxy restarts
- `--reset` flag for `gain.py` to clear saved stats
- Tool name extraction from `tool_use` blocks to enrich compression reporting

### Changed
- `stats.py` now tracks `by_tool` breakdown per request
- `compressor.py` now returns tool names alongside savings data
- Version bumped to 0.2.0

## [0.1.0] - 2026-03-31

### Added
- Local API proxy that intercepts Claude Code requests to Anthropic API
- Semantic compression of old tool results using Claude Haiku
- Configurable compression threshold (`SQUEEZR_THRESHOLD`, default 800 chars)
- Configurable recent context preservation (`SQUEEZR_KEEP_RECENT`, default 3 tool results)
- Real-time per-request savings logging to console
- `/squeezr/stats` endpoint for session summary
- `/squeezr/health` endpoint
- Catch-all route to forward any Anthropic endpoint without modification
- Full streaming support (SSE passthrough)
- `install.sh` for macOS/Linux
- `install.ps1` for Windows
