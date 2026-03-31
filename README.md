# Squeezr

**Squeezr is a local proxy that sits between your AI coding CLI and its API, using a cheap AI model to semantically compress your context window — saving thousands of tokens per session, automatically, with zero changes to your workflow.**

Works with Claude Code, Codex, Aider, OpenCode, Gemini CLI, and any Ollama-powered local LLM.

---

## The problem

Every time you send a message in an AI coding CLI, the entire conversation history is re-sent to the API. That includes every file you read, every `git diff`, every test output, every bash command — even from 30 messages ago when it's no longer relevant. The system prompt alone can weigh 13KB and gets sent on every single request.

The result: your context fills up fast, costs spike, and sessions hit the limit sooner than they should.

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
    |-- [3] Deterministic preprocessing — tool-specific patterns
    |        RTK-parity filters applied automatically (no `rtk` prefix needed):
    |          git:         diff (1-line context + function summary), log, status, branch
    |          cargo:       test (failures only), build/check/clippy (errors only)
    |          JS/TS:       vitest/jest (failures only), playwright (failures only)
    |                       tsc (errors by file), eslint/biome (grouped), prettier
    |                       pnpm/npm install (summary), list (direct deps), outdated
    |                       next build (route table + errors), npx noise stripped
    |          Python:      pytest tracebacks, FAILED lines only
    |          Go:          go test (--- FAIL blocks only)
    |          Terraform:   resource change summary + Plan line
    |          Docker:      ps (compact), images (no dangling), logs (last 50)
    |          kubectl:     get (compact alignment)
    |          Prisma:      strip ASCII box art
    |          gh:          pr view, pr checks, run list, issue list (all capped)
    |          Network:     curl (strip verbose headers), wget (strip progress)
    |        Squeezr-exclusive patterns (no RTK equivalent):
    |          git diff →   prepends "Changed: fn1, fn2" for large diffs
    |          Read tool →  large code files (.ts/.js/.py/.go/.rs > 500 lines)
    |                       show imports + top-level signatures only, bodies omitted
    |          stack traces → block-level dedup across repeated crash/log output
    |          any output → auto-extracts error lines when >50% of content is noise
    |
    |-- [4] Adaptive AI compression
    |        Old bash output, file reads, grep results compressed by a cheap model.
    |        Threshold adjusts automatically based on context pressure:
    |          < 50% full  →  compress blocks > 1,500 chars
    |          50-75% full →  compress blocks > 800 chars
    |          75-90% full →  compress blocks > 400 chars
    |          > 90% full  →  compress everything > 150 chars
    |
    |-- [5] Session cache + KV cache warming
    |        Session cache: blocks identical to a previous request skip the pipeline.
    |        KV warming: unchanged blocks keep deterministic IDs so Anthropic's
    |        prefix cache stays warm — 90% discount on already-seen tokens.
    |
    |-- [6] expand() — lossless retrieval
    |        Every compressed block is stored by ID. If the model needs the full
    |        original, it calls squeezr_expand(id). Squeezr intercepts the tool call,
    |        injects the original, and makes a continuation request — transparently.
    |        The client never sees the tool call.
    |
    v
Your provider's API (Anthropic / OpenAI / Google / Ollama)
```

Recent content is always preserved untouched — by default the last 3 tool results are never compressed. Your CLI always has full context for what it's currently working on.

---

## Supported CLIs and providers

Squeezr auto-detects which provider each request targets from the auth headers. No configuration needed beyond pointing your CLI at the proxy.

| CLI | Set this env var | Compresses with | Extra keys needed |
|---|---|---|---|
| **Claude Code** | `ANTHROPIC_BASE_URL=http://localhost:8080` | Claude Haiku | None |
| **Codex CLI** | `OPENAI_BASE_URL=http://localhost:8080` | GPT-4o-mini | None |
| **Aider** (OpenAI backend) | `OPENAI_BASE_URL=http://localhost:8080` | GPT-4o-mini | None |
| **Aider** (Anthropic backend) | `ANTHROPIC_BASE_URL=http://localhost:8080` | Claude Haiku | None |
| **OpenCode** | `OPENAI_BASE_URL=http://localhost:8080` | GPT-4o-mini | None |
| **Gemini CLI** | `GEMINI_API_BASE_URL=http://localhost:8080` | Gemini Flash 8B | None |
| **Ollama** (any CLI) | `OPENAI_BASE_URL=http://localhost:8080` | Local model (configurable) | None |

In every case, Squeezr extracts the API key from the request itself and reuses it for compression. Zero extra setup.

---

## Why not just use /compact?

`/compact` is a nuclear option: it replaces your entire context with a single lossy summary. You lose granularity and can't go back. Squeezr is surgical — it compresses old, irrelevant content while keeping recent work at full fidelity. You can run a session for hours without ever hitting the context limit.

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

For a typical 2-hour coding session with 40+ tool calls, Squeezr saves tens of thousands of tokens at a total compression cost of a few cents.

---

## How it differs from RTK

[RTK](https://github.com/rtk-ai/rtk) is a shell-layer prefix tool that filters command output before it enters context. Squeezr started as a complementary API-layer tool, but as of v1.5.0 it now covers all the same deterministic patterns as RTK — plus several that RTK cannot do.

### Pattern coverage

Both tools cover the same ~30 command patterns: git diff/log/status/branch, cargo test/build/clippy, vitest/jest/playwright, pytest, go test, tsc, eslint, pnpm/npm, docker, kubectl, terraform, gh, curl, wget, and more.

### Where Squeezr goes further

| Feature | RTK | Squeezr |
|---|---|---|
| **Usage** | Manual prefix: `rtk git diff` | Automatic — nothing changes |
| **Turn 1: current output** | Filters immediately | Same (deterministic pass) |
| **Turn 20: old output** | ❌ cannot touch history | ✅ compresses stale blocks |
| **System prompt** | ❌ | ✅ compressed once, cached forever (-71%) |
| **AI fallback** | ❌ patterns only | ✅ semantic compression for unrecognised output |
| **Session dedup** | ❌ | ✅ identical blocks skip the entire pipeline |
| **KV cache warming** | ❌ | ✅ deterministic IDs preserve Anthropic prefix cache |
| **Generic error extract** | Manual `rtk err <cmd>` | ✅ auto-detected when output is error-heavy |
| **Diff function summary** | ❌ | ✅ `Changed: fn1, fn2` prepended on large diffs |
| **Semantic Read** | ❌ | ✅ large code files → imports + signatures only |
| **Stack trace dedup** | ❌ | ✅ repeated crash frames collapsed across log output |
| **Multi-client** | Claude Code only | Claude Code, Codex, Gemini CLI, Ollama, Aider |

### The key difference

RTK filters what enters context on turn 1. Squeezr also does that — but it additionally compresses everything that accumulates over 30+ turns. In a long coding session, the savings compound: the system prompt is compressed, old file reads shrink, repeated stack traces collapse, and the KV cache cuts charges by 90% on unchanged history.

Typical session (2 hours, 50+ tool calls): without compression ~200K tokens; RTK alone ~130K; Squeezr alone ~80K; RTK + Squeezr ~50K.

---

## How it differs from other compression proxies

Several tools compress context windows (Tamp, Context Gateway, Headroom). Squeezr has three hard differentiators:

**1. No extra API keys — ever.**
Squeezr reuses the key from the request itself, targeting the cheapest model in that ecosystem. Other proxies bill separately or require setting up additional credentials.

**2. Ollama compression.**
Compress with a local model for free. No other proxy lets you use your own Ollama instance as the compression engine. Privacy-sensitive codebases stay entirely local.

**3. Multi-provider in one proxy.**
One proxy handles Anthropic, OpenAI, and Google APIs simultaneously. Other tools specialize in one ecosystem.

---

## How session-level optimisations work

### Differential Compression (shipped v1.1.0)

Every request re-sends the full conversation history. Without deduplication, a 50-tool-result session would run 50 Haiku compression calls on request #51 — even though 49 of them haven't changed.

Squeezr tracks a hash of each message in memory for the session lifetime. Blocks identical to the previous request skip the entire pipeline (preprocessing + AI call).

```
Without session cache:  request 51 → up to 50 Haiku calls
With session cache:     request 51 → 1 Haiku call (only the new block)
```

In a 100-request session with 40 tool results: ~4,000 Haiku calls → ~200.

### KV Cache Warming (shipped v1.1.0)

Claude charges 90% less for tokens already in its prefix cache. The cache only activates when the message prefix is byte-for-byte identical between requests. Standard compression breaks this — compressing a block changes its bytes, invalidating the cache for everything that follows.

Squeezr fixes this by assigning compressed blocks a deterministic MD5-based ID. Identical content always produces the same `[squeezr:id -ratio%]` string. Unchanged blocks produce identical bytes across requests, keeping the prefix stable.

```
Without KV warming:  request N+1 → new compressed bytes → cache miss on all subsequent tokens
With KV warming:     request N+1 → same IDs for unchanged blocks → cache hit on entire history
                                  → pay 10% of normal price for everything already seen
```

These two optimisations are orthogonal: session cache reduces Haiku calls, KV warming reduces charges on the main model. Together they compound across a long session.

---

## Quick start

```bash
npm install -g squeezr
squeezr start
```

Then point your CLI at the proxy:

```bash
# Claude Code
export ANTHROPIC_BASE_URL=http://localhost:8080        # macOS / Linux
$env:ANTHROPIC_BASE_URL="http://localhost:8080"        # Windows PowerShell

# Codex / Aider / OpenCode
export OPENAI_BASE_URL=http://localhost:8080

# Gemini CLI
export GEMINI_API_BASE_URL=http://localhost:8080

# Ollama
export OPENAI_BASE_URL=http://localhost:8080
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

All settings live in `squeezr.toml`. Environment variables override TOML values.

```toml
[proxy]
port = 8080

[compression]
threshold = 800           # min chars to compress a tool result
keep_recent = 3           # recent tool results to leave untouched
disabled = false
compress_system_prompt = true    # compress the CLI's system prompt (cached)

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
# Any model works. Good options:
#   qwen2.5-coder:1.5b  (best for code, ~1GB RAM) ← default
#   qwen2.5:1.5b        (good general, ~1GB RAM)
#   llama3.2:1b         (good English, ~800MB RAM)
#   qwen2.5:3b          (better quality, ~2GB RAM)
compression_model = "qwen2.5-coder:1.5b"
dummy_keys = ["ollama", "lm-studio", "sk-no-key-required", "local", "none", ""]
```

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

## Ollama setup

Pull the compression model once, then Squeezr handles the rest:

```bash
ollama pull qwen2.5-coder:1.5b   # or any model you prefer
```

Edit `squeezr.toml` to match whatever you have installed:

```toml
[local]
compression_model = "llama3.2:1b"   # change to any pulled model
```

Any CLI that sends requests with a dummy auth key (`ollama`, `lm-studio`, empty string, etc.) is automatically detected as local and routed to your Ollama instance — no extra configuration needed.

---

## Dry-run mode

Preview what Squeezr would compress without touching any requests:

```bash
SQUEEZR_DRY_RUN=1 squeezr start
```

Console output shows exactly what would be compressed:

```
[squeezr dry-run] Would compress 4 block(s) | potential -12,430 chars | pressure=67% threshold=800
[squeezr dry-run/ollama] Would compress 2 block(s) | potential -5,210 chars | model=qwen2.5-coder:1.5b
```

---

## Live stats

Each compressed request logs to console:

```
[squeezr] 2 block(s) compressed | -4,821 chars (~1,377 tokens) (87% saved)
[squeezr] Context pressure: 68% → threshold=800 chars
[squeezr/haiku] System prompt compressed: -71% (13,204 → 3,849 chars) [cached]
[squeezr/ollama] 1 block(s) compressed | -3,102 chars (~886 tokens) (79% saved)
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

---

## Auto-start

The installer configures Squeezr to start automatically on login:

| OS | Method |
|---|---|
| macOS | launchd (`~/Library/LaunchAgents/com.squeezr.plist`) |
| Linux | systemd user service (`~/.config/systemd/user/squeezr.service`) |
| Windows | Task Scheduler (runs at login, restarts on failure) |

---

## Requirements

- Node.js 18+
- An API key for whichever provider you use (Anthropic, OpenAI, Google)
- For Ollama: Ollama running locally with at least one model pulled

---

## Endpoints

| Endpoint | Description |
|---|---|
| `POST /v1/messages` | Anthropic — Claude Code, Amp |
| `POST /v1/chat/completions` | OpenAI / Ollama — Codex, Aider, OpenCode, local CLIs |
| `POST /v1beta/models/{model}:generateContent` | Google — Gemini CLI |
| `GET /squeezr/stats` | JSON session stats + cache hit rate |
| `GET /squeezr/health` | Health check + version |
| `GET /squeezr/expand/:id` | Retrieve original content for a compressed block |
| `* /{path}` | All other endpoints forwarded unmodified to detected upstream |

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
