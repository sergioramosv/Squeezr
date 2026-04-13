# Squeezr

**Token compression proxy for AI coding CLIs.** Sits between your CLI and the API, compresses context on the fly, saves thousands of tokens per session. Includes a real-time web dashboard and MCP integration.

[![npm](https://img.shields.io/npm/v/squeezr-ai)](https://www.npmjs.com/package/squeezr-ai) [![license](https://img.shields.io/npm/l/squeezr-ai)](LICENSE)

## Supported CLIs

| CLI | Protocol | Proxy method |
|-----|----------|--------------|
| Claude Code | HTTP to Anthropic API | `ANTHROPIC_BASE_URL=http://localhost:8080` |
| Aider | HTTP to Anthropic/OpenAI API | `ANTHROPIC_BASE_URL` / `openai_base_url` |
| OpenCode | HTTP to Anthropic/OpenAI API | `ANTHROPIC_BASE_URL` / `openai_base_url` |
| Gemini CLI | HTTP to Gemini API | `GEMINI_API_BASE_URL=http://localhost:8080` |
| Ollama | HTTP (local) | Transparent via dummy API key detection |
| **Codex** | **WebSocket to chatgpt.com** | **TLS-terminating MITM proxy on :8081** |
| **Cursor IDE** | **ConnectRPC/HTTP2 to api2.cursor.sh** | **`squeezr cursor` — MITM proxy on :8082** |
| Continue (VS Code) | HTTP to OpenAI-compat | `apiBase: http://localhost:8080/v1` |

Works with both API keys and subscription plans (OAuth) — Claude Code Max/Pro, OpenAI Plus, etc.

## Quick start

```bash
npm install -g squeezr-ai
squeezr setup   # configures env vars, auto-start, CA trust, and MCP server
squeezr start
```

`squeezr setup` handles everything automatically:
- Sets `ANTHROPIC_BASE_URL`, `GEMINI_API_BASE_URL`, `NODE_EXTRA_CA_CERTS`
- Installs a shell wrapper (PowerShell on Windows, bash/zsh on Linux/macOS/WSL) that auto-refreshes env vars after `squeezr start/setup/update` — no need to restart the terminal
- Registers auto-start (launchd on macOS, systemd on Linux, Task Scheduler/NSSM on Windows)
- Registers the MCP server in Claude Code, Cursor, Windsurf, and Cline
- **Windows:** imports the MITM CA into the Windows Certificate Store (user-level, no admin required) so Rust-based CLIs like Codex trust the proxy's TLS certificates
- **macOS/Linux/WSL:** generates a CA bundle at `~/.squeezr/mitm-ca/bundle.crt` for `NODE_EXTRA_CA_CERTS`

## How it works

Every request from your AI CLI passes through Squeezr on `localhost:8080`. The proxy applies three compression layers before forwarding to the upstream API:

### Layer 1: System prompt compression

The system prompt (~13KB for Claude Code) is compressed once using an AI model and cached. Subsequent requests reuse the cached version. Saves ~3,000 tokens per request.

### Layer 2: Deterministic preprocessing

Zero-latency, rule-based transformations applied to every tool result:

- **Noise removal:** ANSI escape codes, progress bars, timestamps, spinner output
- **Deduplication:** repeated stack frames, duplicate lines, redundant git hunks
- **Minification:** JSON whitespace, collapsed blank lines

### Layer 3: Tool-specific patterns (~30 rules)

Each tool result is matched against specialized compression rules:

| Category | Tools | What it does |
|----------|-------|--------------|
| Git | diff, log, status, branch | 1-line diff context, capped log, compact status |
| JS/TS | vitest, jest, playwright, tsc, eslint, biome, prettier | Failures/errors only, grouped by file |
| Package managers | pnpm, npm | Install summary, list capped at 30, outdated only |
| Build | next build, cargo build | Errors only |
| Test | cargo test, pytest, go test | FAIL blocks + tracebacks only |
| Infra | terraform, docker, kubectl | Resource changes, compact tables, last 50 log lines |
| Other | prisma, gh CLI, curl/wget | Strip ASCII art, cap output, remove verbose headers |

### Exclusive patterns

Applied to specific content types regardless of tool:

- **Lockfiles** (package-lock.json, Cargo.lock, etc.) → dependency count summary
- **Large code files** (>500 lines) → imports + function/class signatures only
- **Long output** (>200 lines) → head + tail + omission note
- **Grep results** → grouped by file, matches capped
- **Glob results** (>30 files) → directory tree summary
- **Noisy output** (>50% non-essential) → auto-extract errors/warnings

### Adaptive pressure

Compression aggressiveness scales with context window usage:

| Context usage | Threshold | Behavior |
|---------------|-----------|----------|
| < 50% | 1,500 chars | Light — only compress large results |
| 50–75% | 800 chars | Normal — standard compression |
| 75–90% | 400 chars | Aggressive — compress most results |
| > 90% | 150 chars | Critical — compress everything, 0 git diff context |

### Session optimizations

- **Session cache:** After ~50 tool results, older results are batch-summarized into a single compact block
- **KV cache warming:** Deterministic MD5-based IDs keep compressed content prefix-stable across requests
- **Cross-turn dedup:** If the same file is read multiple times, earlier reads are replaced with reference pointers
- **Expand on demand:** Compressed blocks include a `squeezr_expand(id)` callback to retrieve full content

## Web dashboard

Live dashboard at `http://localhost:PORT/squeezr/dashboard` with 5 pages:

| Page | What it shows |
|------|---------------|
| **Overview** | Tokens saved, compression %, requests, cost saved, per-tool breakdown, sparkline chart, context pressure bars, active project badge, savings breakdown (deterministic, AI, dedup, system prompt, overhead) |
| **Projects** | Per-project aggregate stats across all sessions, auto-detected from working directory or set manually via MCP |
| **History** | Past proxy sessions grouped by project and day — start/end time, duration, request count, tokens saved, relative timestamps |
| **Limits** | Real-time rate limit gauges per CLI: Anthropic token/request limits, OpenAI billing & credit balance, Gemini 429 tracking, input/output token usage (session + daily), personal monthly budget bar |
| **Settings** | Compression mode selector (Soft/Normal/Aggressive/Critical), threshold tuning |

Updates every 2 seconds via SSE. Works with both API key and subscription (OAuth) authentication.

## MCP server

Built-in MCP server (`squeezr-mcp`) that gives any MCP-capable AI CLI real-time awareness and control of Squeezr.

**Installed automatically** by `squeezr setup` into Claude Code, Cursor, Windsurf, and Cline.

| Tool | Description |
|------|-------------|
| `squeezr_status` | Is proxy running? Version, port, uptime, mode, circuit breaker state, bypass status |
| `squeezr_stats` | Token savings, compression %, cost saved, savings breakdown, per-tool breakdown, latency (p50/p95/p99), expand rate |
| `squeezr_set_mode` | Change compression mode instantly (soft / normal / aggressive / critical) |
| `squeezr_config` | Current thresholds, keepRecent, cache sizes, AI-skipped tools |
| `squeezr_habits` | Detect wasteful patterns this session (duplicate reads, high Bash count, cache efficiency) |
| `squeezr_stop` | Stop the proxy gracefully (persists caches before exit) |
| `squeezr_check_updates` | Check npm for newer Squeezr version |
| `squeezr_update` | Update to latest version via `npm install -g squeezr-ai@latest` |
| `squeezr_set_project` | Manually set/clear the current project name (overrides auto-detection) |
| `squeezr_bypass` | Toggle bypass mode — disable compression instantly without restart (runtime-only) |

Every MCP tool response automatically checks for updates and appends a notification banner when a new version is available.

## Honest savings tracking

Squeezr tracks token savings with full transparency. `squeezr gain` and the dashboard break down savings by source:

| Source | Description |
|--------|-------------|
| Deterministic | Rule-based preprocessing (ANSI strip, dedup, minification) — free, zero latency |
| AI compression | Haiku/GPT-mini summarization of tool results — near-free, slight latency |
| Read dedup | Cross-turn deduplication of repeated file reads |
| System prompt | One-time AI compression of the system prompt, cached across requests |
| Tag overhead | Bytes added by `[squeezr:ID]` markers (subtracted from savings) |
| AI cost | Estimated token cost of compression API calls (subtracted from NET) |

**NET savings** = total savings − tag overhead − AI compression cost.

### `squeezr gain` subcommands

```bash
squeezr gain              # all-time savings summary
squeezr gain --session    # live session savings from the running proxy
squeezr gain --details    # all-time stats with per-tool breakdown
squeezr gain --reset      # reset all-time counters
```

## Project tracking

Squeezr automatically detects the active project from the CLI's working directory (e.g. Claude Code's `<cwd>` tag in the system prompt). Per-project stats are tracked across sessions.

- **Auto-detection:** extracts the project name from the last meaningful path segment
- **Manual override:** `squeezr_set_project` MCP tool or `POST /squeezr/project` REST endpoint
- **Per-project stats:** visible on the Dashboard's Projects page and in `squeezr gain --session`

## Codex support (MITM proxy)

Codex uses WebSocket over TLS to `chatgpt.com` with OAuth authentication — it cannot be proxied via `OPENAI_BASE_URL`. Squeezr runs a TLS-terminating MITM proxy on port 8081 that intercepts and compresses WebSocket frames. See [CODEX.md](CODEX.md) for the full technical breakdown.

The MITM proxy **only intercepts `chatgpt.com`** traffic. All other HTTPS requests (npm, git, curl, etc.) pass through as a transparent TCP tunnel — no certificate needed, no interference.

## Configuration

### Global config: `squeezr.toml` (next to the binary)

```toml
# Compression thresholds
threshold = 800         # min chars to apply compression
keep_recent = 3         # skip the N most recent tool results
ai_compression = false  # enable AI (Haiku) for tool result compression

# Ports
port = 8080             # HTTP proxy port
mitm_port = 8081        # MITM proxy port (Codex)

# Models
local_model = "qwen2.5-coder:1.5b"  # model for local compression
local_upstream = "http://localhost:11434"

# Tools to never AI-compress (deterministic-only)
ai_skip_tools = ["Read", "View"]

# Compression modes override thresholds
[modes.soft]
threshold = 1500
keep_recent = 10
ai_compression = false

[modes.normal]
threshold = 800
keep_recent = 3

[modes.aggressive]
threshold = 200
keep_recent = 1
ai_compression = true

[modes.critical]
threshold = 50
keep_recent = 0
ai_compression = true
```

### Project-level config: `squeezr.project.toml` (in project root)

Project-level config is deep-merged over global config. Useful for per-repo tuning.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SQUEEZR_PORT` | `8080` | HTTP proxy port (Claude, Aider, Gemini) |
| `SQUEEZR_MITM_PORT` | `8081` | MITM proxy port (Codex) — defaults to SQUEEZR_PORT + 1 |
| `SQUEEZR_THRESHOLD` | `800` | Min chars to compress |
| `SQUEEZR_KEEP_RECENT` | `3` | Recent results to skip |
| `SQUEEZR_DISABLED` | `false` | Disable all compression |
| `SQUEEZR_DRY_RUN` | `false` | Log savings without compressing |
| `SQUEEZR_LOCAL_UPSTREAM` | `http://localhost:11434` | Ollama/LM Studio URL |
| `SQUEEZR_LOCAL_MODEL` | `qwen2.5-coder:1.5b` | Local model for compression |

### Per-command skip

Add `# squeezr:skip` anywhere in a Bash command to bypass compression for that result.

## CLI commands

```bash
squeezr setup          # configure env vars, auto-start, CA trust, install MCP server
squeezr start          # start the proxy (auto-restarts if version mismatch after update)
squeezr update         # kill old processes, install latest from npm, restart
squeezr stop           # stop the proxy
squeezr status         # check if proxy is running
squeezr logs           # show last 50 log lines
squeezr config         # print current config
squeezr ports          # change HTTP and MITM proxy ports
squeezr gain           # all-time token savings summary
squeezr gain --session # live session savings from the running proxy
squeezr gain --details # all-time stats with per-tool breakdown
squeezr gain --reset   # reset all-time counters
squeezr discover       # detect which AI CLIs are installed
squeezr bypass         # toggle bypass mode (skip compression, keep logging)
squeezr bypass --on    # enable bypass (disable compression)
squeezr bypass --off   # disable bypass (resume compression)
squeezr tunnel         # expose proxy via Cloudflare Tunnel (for Cursor IDE)
squeezr mcp install    # register MCP server in Claude Code, Cursor, Windsurf, Cline
squeezr mcp uninstall  # remove MCP server registration
squeezr uninstall      # remove Squeezr completely (env vars, CA, auto-start, logs)
squeezr version        # print version
```

## Resilience

Squeezr sits in the critical path between your AI CLI and the upstream API. It's designed to never break your workflow:

- **Circuit breaker** — If the AI compression backend (Haiku, GPT-4o-mini, etc.) fails 3 times in a row, Squeezr automatically skips AI compression for 60 seconds, then probes recovery. Deterministic compression continues working. Visible in dashboard, `squeezr status`, and MCP.
- **5-second AI timeout** — Each AI compression call has a hard 5s timeout. If the backend is slow, the original content passes through unmodified.
- **Bypass mode** — `squeezr bypass` instantly disables all compression without restarting. Requests still pass through and are logged. Toggle via CLI, MCP, dashboard, or REST API.
- **Expand rate tracking** — Monitors how often the model calls `squeezr_expand` to recover compressed content. High expand rate signals the compression is too aggressive.
- **Latency tracking** — p50/p95/p99 compression latency visible in dashboard and MCP stats.

## Compression backends

Squeezr uses cheap/free models for AI compression (the deterministic layer is pure regex, no API calls):

| Backend | Model | Used for | Cost |
|---------|-------|----------|------|
| Anthropic | Haiku | System prompt, session cache | ~$0.0001/call |
| OpenAI | GPT-4o-mini | Fallback compression | ~$0.0001/call |
| Gemini | Flash-8B | Fallback compression | Free |
| Local | qwen2.5-coder:1.5b | Compression when using Ollama | Free |
| ChatGPT (WS) | GPT-5.4-mini | Codex frame compression | $0 (same subscription) |

## Requirements

- Node.js 18+ (compatible with Node.js 24)
- For Codex MITM: set `HTTPS_PROXY=http://localhost:8081` in the terminal where you run Codex (not set globally to avoid interfering with other tools)
- For local compression: [Ollama](https://ollama.ai) with `qwen2.5-coder:1.5b`

## Troubleshooting

### Claude Code throws `undefined is not an object (evaluating '$.speed')`

Symptom: every prompt in Claude Code immediately errors with `undefined is not an object (evaluating '$.speed')` (or similar `$.X` parse errors). This means Claude Code is sending its API requests to **something that is not Squeezr** but happens to occupy Squeezr's port — typically a Docker container (Apache, nginx, WordPress) bound to `8080`.

To diagnose, run:

```bash
squeezr status
```

If the output says `a foreign service is` listening on the port, you have three options:

1. **Move Squeezr to a different port** (recommended): `squeezr ports` and pick something free, then reopen your terminal.
2. **Stop the offending service**: `docker ps` to find what owns 8080, then `docker stop <id>`.
3. **Inspect runtime info**: `cat ~/.squeezr/runtime.json` shows the *actual* port Squeezr is bound to. If it differs from your `ANTHROPIC_BASE_URL`, run `squeezr setup` to refresh your shell profile.

Squeezr v1.23.0+ runs a self-test on every startup that detects this exact failure mode and prints actionable hints. You can re-run it any time with:

```bash
curl -s "http://localhost:$(jq -r .port ~/.squeezr/runtime.json)/squeezr/selftest?run=1" | jq
```

## License

MIT
