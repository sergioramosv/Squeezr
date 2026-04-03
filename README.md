# Squeezr

[![npm version](https://badge.fury.io/js/squeezr-ai.svg)](https://www.npmjs.com/package/squeezr-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 18+](https://img.shields.io/badge/node-18%2B-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-190%20passing-brightgreen)](https://github.com/sergioramosv/Squeezr)

**Squeezr is a local proxy that sits between your AI coding CLI and its API. It automatically compresses your context window on every request — saving thousands of tokens per session with zero changes to your workflow.**

Works with Claude Code, Codex, Aider, OpenCode, Gemini CLI, and any Ollama-powered local LLM.

---

## The problem

Every time you send a message in an AI coding CLI, the entire conversation history is re-sent to the API. That includes every file you read, every `git diff`, every test output, every bash command — even from 30 messages ago when it's no longer relevant. The system prompt alone can weigh 13KB and gets sent on every single request.

The result: context fills up fast, costs spike, and sessions hit the limit sooner than they should.

---

## How Squeezr fixes it

Squeezr intercepts every API request before it reaches the provider and runs multiple compression layers:

```
Your CLI (Claude Code / Codex / Aider / Gemini CLI / Ollama)
    |
    v
localhost:8080  (Squeezr proxy)
    |
    |-- [1] System prompt compression
    |        Compressed once on first request, cached forever.
    |        ~13KB Claude Code system prompt → ~600 tokens. Never resent in full again.
    |
    |-- [2] Deterministic preprocessing — noise removal
    |        Runs on every tool result before anything else:
    |        strip ANSI codes, strip progress bars, strip timestamps,
    |        deduplicate repeated stack traces, deduplicate repeated lines,
    |        minify inline JSON, collapse whitespace.
    |
    |-- [3] Deterministic preprocessing — tool-specific patterns (~30 patterns)
    |        Applied automatically to every matching output:
    |          git:         diff (1-line context + Changed: fn summary on large diffs)
    |                       log (capped, adaptive), status, branch (capped at 20)
    |          cargo:       test (failures only), build/check/clippy (errors only)
    |          JS/TS:       vitest/jest (failures + summary only)
    |                       playwright (✘ blocks only)
    |                       tsc (errors grouped by file)
    |                       eslint/biome (grouped, no rule URLs)
    |                       prettier --check (only files needing format)
    |                       pnpm/npm install (summary line only)
    |                       pnpm/npm list (direct deps only)
    |                       pnpm/npm outdated (capped at 30)
    |                       next build (route table + errors)
    |                       npx noise stripped
    |          Python:      pytest (FAILED lines + tracebacks only)
    |          Go:          go test (--- FAIL blocks only)
    |          Terraform:   resource change summary + Plan line
    |          Docker:      ps (compact), images (no dangling), logs (last 50 lines)
    |          kubectl:     get (compact alignment)
    |          Prisma:      strip ASCII box-drawing art
    |          gh CLI:      pr view, pr checks, run list, issue list (all capped)
    |          Network:     curl (strip verbose headers), wget (strip progress)
    |        Exclusive patterns:
    |          Read tool →  lockfiles replaced with summary count
    |                       large code files (.ts/.js/.py/.go/.rs > 500 lines)
    |                       → imports + top-level signatures only, bodies omitted
    |                       files > 200 lines → head + tail with omission note
    |          Grep tool →  matches grouped by file, capped per file and total
    |          Glob tool →  > 30 files collapsed to directory summary
    |          Any output → auto-extracts error lines when > 50% of content is noise
    |          Stack traces → repeated crash frames collapsed across log output
    |
    |-- [4] Cross-turn Read deduplication
    |        When the model reads the same file multiple times in a session,
    |        earlier occurrences are replaced with a reference token.
    |        Most recent copy always kept at full fidelity.
    |
    |-- [5] Adaptive AI compression
    |        Old bash output, file reads, grep results compressed by a cheap model.
    |        Threshold adjusts automatically based on context pressure:
    |          < 50% full  →  compress blocks > 1,500 chars
    |          50-75% full →  compress blocks > 800 chars
    |          75-90% full →  compress blocks > 400 chars
    |          > 90% full  →  compress everything > 150 chars
    |        At > 90% pressure, deterministic patterns also tighten:
    |          git diff →   0 context lines per hunk (vs 1)
    |          git log →    cap 10 commits (vs 30)
    |          grep →       4 matches/file (vs 8)
    |
    |-- [6] Session cache + KV cache warming
    |        Session cache: blocks identical to a previous request skip the pipeline.
    |        KV warming: unchanged blocks keep deterministic IDs so Anthropic's
    |        prefix cache stays warm — 90% discount on already-seen tokens.
    |
    |-- [7] expand() — lossless retrieval
    |        Every compressed block is stored by ID. If the model needs the full
    |        original, it calls squeezr_expand(id). Squeezr intercepts the tool call,
    |        injects the original, and makes a continuation request — transparently.
    |
    v
Your provider's API (Anthropic / OpenAI / Google / Ollama)
```

**MCP tool results are compressed automatically.** Any tool result that passes through the proxy — including results from MCP servers (Linear, GitHub, Slack, planning tools, custom MCPs) — goes through the same compression pipeline. No configuration needed; Squeezr treats MCP tool results identically to built-in tools. In practice MCP responses are often large JSON payloads that compress 70-94%.

Recent content is always preserved untouched — by default the last 3 tool results are never compressed. Your CLI always has full context for what it's currently working on.

### Does compression make the AI "dumber"?

No — it's the opposite. Without Squeezr, long sessions hit the context window limit and the CLI **silently drops old messages entirely**. You lose them with no way to get them back.

With Squeezr, old messages are **summarized, not deleted**. A 3,000-token git diff from message #15 becomes a ~150-token summary like:

```
[squeezr:a3f2c1] git diff: modified src/auth.ts — validateToken:
added expiry logging + refreshToken call. 3 files changed.
```

The AI knows *what* you did, not every exact line. And if it needs the full original, it calls `squeezr_expand(a3f2c1)` and gets it back — losslessly.

| Scenario | Message #15 at turn #100 |
|---|---|
| **No compression** | Probably dropped by the CLI (doesn't fit) |
| **With Squeezr** | Summarized but present, expandable on demand |

The trade-off: less detail, but more memory. Without Squeezr the AI forgets entire messages. With Squeezr it has a one-line note about every decision made — and can retrieve the full context when needed.

---

## Deterministic compression engine

Before any AI model is involved, Squeezr runs a full deterministic compression pipeline on every tool result. This is a zero-cost, zero-latency layer that handles the most common developer outputs with specialized parsers:

| Tool output | What Squeezr does | Typical savings |
|---|---|---|
| **git status** | Parses staged/modified/untracked, drops noise lines | 70-85% |
| **git diff** | Extracts changed function names, strips context lines (adaptive), summarizes large diffs | 65-92% |
| **git log** | Compacts to `hash msg (author, date)`, caps entries by pressure | 70-90% |
| **cargo test/build/clippy** | Extracts only failures, errors, warnings | 80-95% |
| **vitest/jest/playwright** | Extracts failed tests and assertion errors | 80-95% |
| **tsc** | Groups errors by file, keeps only error lines | 75-90% |
| **eslint/biome** | Compacts to file + rule + message | 70-85% |
| **prettier** | Keeps only files-changed summary | 80-90% |
| **next build** | Extracts errors and route summary | 75-85% |
| **pytest** | Extracts FAILED lines and short summaries | 80-95% |
| **npm/pnpm install** | Strips progress bars, keeps final summary | 85-90% |
| **npm outdated** | Compact table format | 60-75% |
| **docker ps/images/logs** | Compact output, strips timestamps | 70-80% |
| **kubectl get/describe/logs** | Strips timestamps, compacts tables | 70-80% |
| **gh pr/run/issue** | Strips decorations, keeps data | 65-75% |
| **curl/wget** | Strips progress, keeps response body/headers | 60-80% |
| **terraform plan/apply** | Extracts changes summary | 70-85% |
| **prisma** | Compacts migration and schema output | 65-80% |
| **Grep results** | Groups by file, caps matches per file (adaptive) | 60-80% |
| **Read (large files)** | >500 lines: imports + signatures only. >200 lines: head + tail | 70-95% |
| **Glob** | Compacts file listings into directory summaries | 50-70% |

Additionally, on **all** outputs regardless of tool:
- ANSI escape codes stripped
- Progress bars and spinners removed
- Repeated lines collapsed (`"... repeated N more times"`)
- Duplicate stack traces deduplicated (Node.js and Python)
- Inline JSON minified (objects >200 chars)
- Timestamps stripped (ISO 8601, bracketed, bare time formats)
- Excessive whitespace collapsed

This engine runs in pure Node.js — microseconds per result, no API calls, no cost. It handles the bulk of the compression work. The AI layer (Haiku/GPT-4o-mini) only kicks in afterward on older messages where further summarization is needed.

---

## Supported CLIs and providers

Squeezr auto-detects which provider each request targets from the auth headers. No configuration needed beyond pointing your CLI at the proxy.

| CLI | Set this env var | Compresses with | Extra keys needed |
|---|---|---|---|
| **Claude Code** | `ANTHROPIC_BASE_URL=http://localhost:8080` | Claude Haiku | None |
| **Codex CLI** | `squeezr setup` (see below) | gpt-5.4-mini (via your Codex sub) | None |
| **Aider** (OpenAI backend) | `openai_base_url=http://localhost:8080` | GPT-4o-mini | None |
| **Aider** (Anthropic backend) | `ANTHROPIC_BASE_URL=http://localhost:8080` | Claude Haiku | None |
| **OpenCode** | `openai_base_url=http://localhost:8080` | GPT-4o-mini | None |
| **Gemini CLI** | `GEMINI_API_BASE_URL=http://localhost:8080` | Gemini Flash 8B | None |
| **Ollama** (any CLI) | `openai_base_url=http://localhost:8080` | Local model (configurable) | None |

Squeezr extracts the API key from the request itself and reuses it for compression. Zero extra setup.

---

## Quick start

```bash
npm install -g squeezr-ai
squeezr start
```

Then point your CLI at the proxy:

```bash
# Claude Code
export ANTHROPIC_BASE_URL=http://localhost:8080        # macOS / Linux
$env:ANTHROPIC_BASE_URL="http://localhost:8080"        # Windows PowerShell

# Codex (uses MITM proxy — see "Codex deep compression" below)
export HTTPS_PROXY=http://localhost:8081
export SSL_CERT_FILE=~/.squeezr/mitm-ca/bundle.crt

# Aider / OpenCode
export openai_base_url=http://localhost:8080

# Gemini CLI
export GEMINI_API_BASE_URL=http://localhost:8080

# Ollama
export openai_base_url=http://localhost:8080
```

Or use the shell installer to set up the env var permanently and register Squeezr as a login service:

```bash
# macOS / Linux
bash install.sh

# Windows (PowerShell, run as admin for Task Scheduler)
.\install.ps1
```

---

## Configuration

### Global config — `squeezr.toml`

Located in the Squeezr install directory. Environment variables override any TOML value.

```toml
[proxy]
port = 8080

[compression]
threshold = 800           # min chars to compress a tool result
keep_recent = 3           # recent tool results to leave untouched
disabled = false
compress_system_prompt = true    # compress the CLI's system prompt (cached)
compress_conversation = false    # also compress old user/assistant messages (aggressive)

# Explicit control over which tools are compressed:
# skip_tools = ["Read"]          # never compress these tools
# only_tools = ["Bash"]          # only compress these tools (overrides skip_tools)

[cache]
enabled = true
max_entries = 1000        # LRU cap for cached compressions

[adaptive]
enabled = true
low_threshold = 1500      # used when context < 50% full
mid_threshold = 800       # 50-75%
high_threshold = 400      # 75-90%
critical_threshold = 150  # > 90% — compress everything

[local]
enabled = true
upstream_url = "http://localhost:11434"   # your Ollama URL
# Model used to compress tool results — must be pulled in Ollama.
# Good options:
#   qwen2.5-coder:1.5b  (best for code, ~1GB RAM) ← default
#   qwen2.5:1.5b        (good general, ~1GB RAM)
#   llama3.2:1b         (good English, ~800MB RAM)
#   qwen2.5:3b          (better quality, ~2GB RAM)
compression_model = "qwen2.5-coder:1.5b"
dummy_keys = ["ollama", "lm-studio", "sk-no-key-required", "local", "none", ""]
```

### Per-project config — `.squeezr.toml`

Drop a `.squeezr.toml` in any project root. It deep-merges over the global config, so you only need to specify what differs:

```toml
# .squeezr.toml — project-level overrides
[compression]
threshold = 400
skip_tools = ["Read"]   # don't compress file reads in this project
```

Squeezr logs `[squeezr] Using project config: /path/to/.squeezr.toml` when a local config is detected.

### Environment variable reference

| Variable | Default | Description |
|---|---|---|
| `SQUEEZR_PORT` | `8080` | Local port |
| `SQUEEZR_THRESHOLD` | `800` | Base compression threshold (chars) |
| `SQUEEZR_KEEP_RECENT` | `3` | Recent tool results to skip |
| `SQUEEZR_DISABLED` | — | Set to `1` to disable (passthrough only) |
| `SQUEEZR_DRY_RUN` | — | Set to `1` to preview savings without compressing |
| `SQUEEZR_LOCAL_UPSTREAM` | `http://localhost:11434` | Ollama URL |
| `SQUEEZR_LOCAL_MODEL` | `qwen2.5-coder:1.5b` | Ollama compression model |

---

## Explicit control — skip and only

You can control exactly which tool results Squeezr compresses, both globally and per-command.

### Config-level (global or per-project)

```toml
[compression]
# Never compress Read or Grep results:
skip_tools = ["Read", "Grep"]

# Only compress Bash results — ignore everything else:
only_tools = ["Bash"]   # overrides skip_tools when set
```

### Inline per-command — `# squeezr:skip`

Add `# squeezr:skip` anywhere in a Bash command to prevent that specific result from being compressed, regardless of config:

```bash
# This result will never be compressed, even if it's 10,000 chars:
git diff HEAD~3  # squeezr:skip

# Normal commands are compressed as usual:
cargo test
```

---

## Dry-run mode

Preview what Squeezr would compress without modifying any requests:

```bash
SQUEEZR_DRY_RUN=1 squeezr start
```

Console output shows exactly what would be compressed:

```
[squeezr dry-run] Would compress 4 block(s) | potential -12,430 chars | pressure=67% threshold=800
[squeezr dry-run/ollama] Would compress 2 block(s) | potential -5,210 chars | model=qwen2.5-coder:1.5b
```

---

## Ollama — local compression

Pull the compression model once, then Squeezr handles the rest:

```bash
ollama pull qwen2.5-coder:1.5b   # or any model you prefer
```

Any CLI that sends requests with a dummy auth key (`ollama`, `lm-studio`, empty string, etc.) is automatically detected as local and routed to your Ollama instance.

To use a different model:

```toml
[local]
compression_model = "llama3.2:1b"
```

---

## Live stats

Each compressed request logs to console:

```
[squeezr] 2 block(s) compressed | -4,821 chars (~1,377 tokens) (87% saved)
[squeezr] Context pressure: 68% → threshold=800 chars
[squeezr/haiku] System prompt compressed: -71% (13,204 → 3,849 chars) [cached]
[squeezr/ollama] 1 block(s) compressed | -3,102 chars (~886 tokens) (79% saved)
[squeezr] Session cache: 3 block(s) reused (KV cache preserved)
[squeezr] Cross-turn dedup: 2 Read result(s) collapsed
```

### `squeezr gain` — full stats dashboard

```bash
squeezr gain
```

```
┌─────────────────────────────────────────┐
│          Squeezr — Token Savings         │
├─────────────────────────────────────────┤
│  Requests      38                        │
│  Saved chars   142,830                   │
│  Saved tokens  40,808                    │
│  Savings       73.4%                     │
├─────────────────────────────────────────┤
│  By Tool                                 │
│  Bash (41x): -81%                        │
│  Read (28x): -74%                        │
│  Grep (14x): -69%                        │
└─────────────────────────────────────────┘
```

Stats persist to `~/.squeezr/stats.json` across restarts.

```bash
squeezr gain --reset    # clear all saved stats
```

Full JSON at: `http://localhost:8080/squeezr/stats`

### `squeezr discover` — pattern coverage report

After a session, run:

```bash
squeezr discover
```

Shows which deterministic patterns fired, how many outputs hit the AI fallback, and the Read/Grep/Glob breakdown. Useful for spotting coverage gaps or misconfigured skip lists.

---

## Codex deep compression

Codex CLI talks to `chatgpt.com` over WebSocket, not the standard OpenAI API. This means a regular HTTP proxy can't inspect or modify the traffic. Squeezr solves this with a TLS-terminating MITM proxy on port 8081.

### How it works

1. `squeezr setup` generates a local CA and configures `HTTPS_PROXY` + `SSL_CERT_FILE` in your shell
2. When Codex connects to `chatgpt.com`, Squeezr intercepts the TLS tunnel and generates a per-host certificate signed by the local CA
3. Squeezr strips `permessage-deflate` from the WebSocket handshake so frames arrive as plain JSON
4. On every client-to-server WebSocket frame, Squeezr looks for `function_call_output` messages (tool results) exceeding the compression threshold
5. For each large tool result, Squeezr opens a **separate** WebSocket to `chatgpt.com/backend-api/codex/responses` using the same OAuth token, and asks `gpt-5.4-mini` to summarize it
6. The compressed output replaces the original in the frame before forwarding to the server

### Setup

```bash
squeezr setup   # auto-configures everything (HTTPS_PROXY, SSL_CERT_FILE, CA)
```

Or manually:

```bash
export HTTPS_PROXY=http://localhost:8081
export SSL_CERT_FILE=~/.squeezr/mitm-ca/bundle.crt
```

### What it costs

Nothing extra. The compression calls use `gpt-5.4-mini` through the same ChatGPT WebSocket endpoint that your Codex subscription already covers. No API key required.

### Results

In testing, Codex tool results (file reads, command output) are compressed by **80-90%** per turn. A typical file read of 5,000 chars compresses to ~700 chars, saving thousands of tokens across a session.

For a detailed technical explanation, see [CODEX.md](CODEX.md).

---

## How session-level optimisations work

### Session cache + differential compression

Every request re-sends the full conversation history. Without deduplication, a 50-tool-result session would run 50 Haiku calls on request #51 — even though 49 of them haven't changed.

Squeezr tracks a hash of each compressed block in memory for the session lifetime. Blocks identical to the previous request skip the entire pipeline (preprocessing + AI call).

```
Without session cache:  request 51 → up to 50 Haiku calls
With session cache:     request 51 → 1 Haiku call (only the new block)
```

In a 100-request session with 40 tool results: ~4,000 Haiku calls → ~200.

### KV cache warming

Claude charges 90% less for tokens already in its prefix cache. The cache only activates when the message prefix is byte-for-byte identical between requests. Standard compression breaks this — each call might produce different bytes, invalidating the cache.

Squeezr fixes this by assigning compressed blocks a deterministic MD5-based ID. Identical content always produces the same `[squeezr:id -ratio%]` string. Unchanged blocks produce identical bytes across requests, keeping the prefix stable.

```
Without KV warming:  request N+1 → new compressed bytes → cache miss on all subsequent tokens
With KV warming:     request N+1 → same IDs for unchanged blocks → cache hit on entire history
                                  → pay 10% of normal price for everything already seen
```

These two optimisations compound: session cache reduces Haiku calls, KV warming reduces charges on the main model.

### Cross-turn Read deduplication

When the model reads the same file multiple times (common in long refactoring sessions), every earlier occurrence is replaced with a reference token:

```
[same file content as a later read — squeezr_expand(id) to retrieve]
```

The most recent copy is always kept at full fidelity. The model can call `squeezr_expand(id)` to retrieve any earlier version on demand.

### Adaptive pressure

As context fills up, Squeezr gets more aggressive — both in what it compresses and how aggressively the deterministic patterns behave:

| Context used | Threshold | git diff context | git log cap | grep cap/file |
|---|---|---|---|---|
| < 50% | 1,500 chars | 1 line | 30 commits | 8 matches |
| 50-75% | 800 chars | 1 line | 20 commits | 6 matches |
| 75-90% | 400 chars | 1 line | 20 commits | 6 matches |
| > 90% | 150 chars | **0 lines** | **10 commits** | **4 matches** |

---

## The economics

Compression is done by the cheapest model in each ecosystem:

| Provider | Compression model | Cost vs main model |
|---|---|---|
| Anthropic | Claude Haiku | ~25x cheaper than Sonnet |
| OpenAI | GPT-4o-mini | ~15x cheaper than GPT-4o |
| Google | Gemini Flash 8B | ~10x cheaper than Gemini Pro |
| Ollama | Your configured local model | Free |

**Example:** Haiku compresses a 3,000-token tool result to 150 tokens. Cost: ~$0.0001. Saving on every subsequent Sonnet request: ~$0.009. Net savings per compression: ~98%.

Typical 2-hour session (50+ tool calls): ~200K tokens without compression → ~80K with Squeezr (-60%). The session cache and KV warming compound this further in long sessions.

---

## Does it add latency?

Barely — and in long sessions it makes things faster, not slower.

**What Squeezr adds:**
- Deterministic patterns (git, cargo, vitest, etc.) run in pure Node.js — microseconds, unnoticeable
- AI compression (Haiku/GPT-4o-mini) adds ~200-400ms **but only once per block**, then cached forever. Every subsequent request that includes that block pays zero

**Why it feels faster overall:**

The time Squeezr takes to compress a block is parallel to the time you spend reading the previous response and typing the next message. By the time you send your next message, compression is already done.

More importantly: sending 60-80% fewer tokens means Claude processes a smaller context and **responds faster** — especially noticeable from turn 10 onward when history accumulates.

| | Without Squeezr | With Squeezr |
|---|---|---|
| Turn 1-3 | Fast | +200ms first compression (then cached) |
| Turn 10+ | Getting slower | Stays fast — history is compressed |
| Turn 30+ | Noticeably slow | Faster than turn 1 without Squeezr |

---

## Why not just use /compact?

`/compact` is a nuclear option: it replaces your entire context with a single lossy summary. You lose granularity and can't go back. Squeezr is surgical — it compresses old, irrelevant content while keeping recent work at full fidelity, with lossless retrieval via `squeezr_expand` for anything that needs to be recovered.

---

## Auto-start

The installer configures Squeezr to start automatically on login:

| OS | Method | Fallback |
|---|---|---|
| macOS | launchd (`~/Library/LaunchAgents/com.squeezr.plist`) | Shell auto-heal |
| Linux | systemd user service (`~/.config/systemd/user/squeezr.service`) | Shell auto-heal |
| Windows | Task Scheduler (runs at login, restarts on failure) | — |
| Windows (robust) | **NSSM Windows Service** (auto-restart on crash) | — |
| **WSL2** | systemd → Task Scheduler (cascade) | Shell auto-heal |

### Windows: NSSM (recommended over Task Scheduler)

The built-in Task Scheduler setup requires admin on every reinstall and does **not** restart Squeezr if it crashes mid-session (e.g. due to `ECONNRESET`). For a more robust setup, use [NSSM](https://nssm.cc) to run Squeezr as a proper Windows service:

```powershell
# Install NSSM
winget install nssm

# Create the service (run as Administrator, adjust paths if needed)
$node   = (where.exe node | Select-Object -First 1)
$script = "$(npm root -g)\squeezr-ai\bin\squeezr.js"
nssm install SqueezrProxy $node $script
nssm set SqueezrProxy AppExit Default Restart
nssm set SqueezrProxy AppRestartDelay 3000
nssm start SqueezrProxy
```

NSSM gives you: auto-start on boot, automatic restart on crash, stdout/stderr logs, and control via `services.msc`.

See [NSSM_WINDOWS_SERVICE.md](./NSSM_WINDOWS_SERVICE.md) for the full guide including log setup, troubleshooting, and uninstall steps.

### WSL2 support

`squeezr setup` detects WSL2 automatically and configures both sides:

- **WSL shell**: env vars + auto-heal guard in `.bashrc` / `.zshrc`
- **Windows**: env vars via `setx` (persistent in registry)
- **Auto-start**: tries systemd first (WSL2 with `systemd=true` in `/etc/wsl.conf`), falls back to Windows Task Scheduler via `powershell.exe`

### Auto-heal

On every platform, `squeezr setup` adds a lightweight guard to your shell profile. Each time you open a terminal, it checks if the proxy is alive (`curl localhost:8080/squeezr/health`). If not, it starts it in the background — silently, in ~100ms. This means:

- If the service manager fails, the proxy still starts on your next terminal
- If the proxy crashes mid-session, the next terminal restores it
- Zero manual intervention after `squeezr setup`, ever

---

## Requirements

- Node.js 18+
- Your AI CLI already set up and working — nothing else needed

Squeezr works with **any auth method** your CLI uses:

| Auth type | Example | Works? |
|---|---|---|
| API key | `ANTHROPIC_API_KEY=sk-ant-...` | ✅ Full pipeline |
| OAuth / subscription | Claude Code via claude.ai plan | ✅ Full pipeline — OAuth token reused for Haiku |
| Local / no key | Ollama, LM Studio | ✅ Full pipeline — local model for compression |

No extra credentials needed. Squeezr extracts and reuses whatever auth is already in your requests.

---

## Endpoints

| Endpoint | Description |
|---|---|
| `POST /v1/messages` | Anthropic — Claude Code |
| `POST /v1/chat/completions` | OpenAI / Ollama — Codex, Aider, OpenCode, local CLIs |
| `POST /v1beta/models/{model}:generateContent` | Google — Gemini CLI |
| `GET /squeezr/stats` | JSON session stats + cache hit rate + pattern coverage |
| `GET /squeezr/health` | Health check + version |
| `GET /squeezr/expand/:id` | Retrieve original content for a compressed block |
| `* /{path}` | All other endpoints forwarded unmodified to detected upstream |

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
