# Squeezr

**Token compression proxy for AI coding CLIs.** Sits between your CLI and the API, compresses context on the fly, saves thousands of tokens per session.

[![npm](https://img.shields.io/npm/v/squeezr-ai)](https://www.npmjs.com/package/squeezr-ai) [![license](https://img.shields.io/npm/l/squeezr-ai)](LICENSE) [![tests](https://img.shields.io/badge/tests-190%20passing-brightgreen)]()

## Supported CLIs

| CLI | Protocol | Proxy method |
|-----|----------|-------------|
| Claude Code | HTTP to Anthropic API | `ANTHROPIC_BASE_URL=http://localhost:8080` |
| Aider | HTTP to Anthropic/OpenAI API | `ANTHROPIC_BASE_URL` / `openai_base_url` |
| OpenCode | HTTP to Anthropic/OpenAI API | `ANTHROPIC_BASE_URL` / `openai_base_url` |
| Gemini CLI | HTTP to Gemini API | `GEMINI_API_BASE_URL=http://localhost:8080` |
| Ollama | HTTP (local) | Transparent via dummy API key detection |
| **Codex** | **WebSocket to chatgpt.com** | **TLS-terminating MITM proxy on :8081** |

## Quick start

```bash
npm install -g squeezr-ai
squeezr setup   # configures env vars, auto-start, and CA trust
squeezr start
```

`squeezr setup` handles everything automatically:
- Sets `ANTHROPIC_BASE_URL`, `GEMINI_API_BASE_URL`, `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, `NO_PROXY`
- Registers auto-start (launchd on macOS, systemd on Linux, Task Scheduler/NSSM on Windows)
- **Windows:** imports the MITM CA into the Windows Certificate Store (user-level, no admin required) so Rust-based CLIs like Codex trust the proxy's TLS certificates
- **macOS/Linux:** generates a CA bundle at `~/.squeezr/mitm-ca/bundle.crt` for `SSL_CERT_FILE`

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
|----------|-------|-------------|
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
|--------------|-----------|----------|
| < 50% | 1,500 chars | Light — only compress large results |
| 50–75% | 800 chars | Normal — standard compression |
| 75–90% | 400 chars | Aggressive — compress most results |
| > 90% | 150 chars | Critical — compress everything, 0 git diff context |

### Session optimizations

- **Session cache:** After ~50 tool results, older results are batch-summarized into a single compact block
- **KV cache warming:** Deterministic MD5-based IDs keep compressed content prefix-stable across requests
- **Cross-turn dedup:** If the same file is read multiple times, earlier reads are replaced with reference pointers
- **Expand on demand:** Compressed blocks include a `squeezr_expand(id)` callback to retrieve full content

## Codex support (MITM proxy)

Codex uses WebSocket over TLS to `chatgpt.com` with OAuth authentication — it cannot be proxied via `OPENAI_BASE_URL`. Squeezr runs a TLS-terminating MITM proxy on port 8081 that intercepts and compresses WebSocket frames. See [CODEX.md](CODEX.md) for the full technical breakdown.

## Configuration

### Global config: `squeezr.toml` (next to the binary)

```toml
[proxy]
port = 8080

[compression]
threshold = 800          # min chars to trigger compression
keep_recent = 3          # last N results left uncompressed
compress_system_prompt = true
compress_conversation = false  # aggressive: compress assistant messages too
# skip_tools = ["Read"]       # never compress these tools
# only_tools = ["Bash"]       # only compress these tools

[cache]
enabled = true
max_entries = 1000

[adaptive]
enabled = true
low_threshold = 1500
mid_threshold = 800
high_threshold = 400
critical_threshold = 150

[local]
enabled = true
upstream_url = "http://localhost:11434"       # Ollama
compression_model = "qwen2.5-coder:1.5b"
```

### Project config: `.squeezr.toml` (in project root)

Project-level config is deep-merged over global config. Useful for per-repo tuning.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SQUEEZR_PORT` | `8080` | Proxy port (MITM port = this + 1) |
| `SQUEEZR_THRESHOLD` | `800` | Min chars to compress |
| `SQUEEZR_KEEP_RECENT` | `3` | Recent results to skip |
| `SQUEEZR_DISABLED` | `false` | Disable all compression |
| `SQUEEZR_DRY_RUN` | `false` | Log savings without compressing |
| `SQUEEZR_LOCAL_UPSTREAM` | `http://localhost:11434` | Ollama/LM Studio URL |
| `SQUEEZR_LOCAL_MODEL` | `qwen2.5-coder:1.5b` | Local model for compression |

### Per-command skip

Add `# squeezr:skip` anywhere in a Bash command to bypass compression for that result.

## Compression backends

Squeezr uses cheap/free models for AI compression (the deterministic layer is pure regex, no API calls):

| Backend | Model | Used for | Cost |
|---------|-------|----------|------|
| Anthropic | Haiku | System prompt, session cache | ~$0.0001/call |
| OpenAI | GPT-4o-mini | Fallback compression | ~$0.0001/call |
| Gemini | Flash-8B | Fallback compression | Free |
| Local | qwen2.5-coder:1.5b | Compression when using Ollama | Free |
| ChatGPT (WS) | GPT-5.4-mini | Codex frame compression | $0 (same subscription) |

### Typical savings

- **Per tool result:** 70–95% reduction depending on tool
- **Per session (2 hours):** ~200K tokens → ~80K tokens (60% savings)
- **System prompt:** ~13KB → ~600 tokens (cached)

## CLI commands

```bash
squeezr setup      # configure env vars, auto-start, CA trust
squeezr start      # start the proxy (foreground)
squeezr stop       # stop the proxy
squeezr status     # check if proxy is running
squeezr logs       # show last 50 log lines
squeezr config     # print current config
squeezr gain       # estimate token savings for a directory
squeezr discover   # detect which AI CLIs are installed
squeezr version    # print version
```

## Requirements

- Node.js 18+
- For Codex MITM: `HTTPS_PROXY=http://localhost:8081` (set automatically by `squeezr setup`)
- For local compression: [Ollama](https://ollama.ai) with `qwen2.5-coder:1.5b`

## License

MIT
