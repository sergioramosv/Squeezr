# Squeezr: Token Compression for Codex CLI

## The problem

Codex CLI sends all tool output verbatim to the model. A 300-line file read = 10,000+ tokens. Over a session, this adds up fast and eats into the context window.

Unlike Claude Code or Aider, Codex **cannot** be proxied via `OPENAI_BASE_URL`:

- Codex uses **WebSocket** to `chatgpt.com:443`, not standard REST to `api.openai.com`
- Authentication is **ChatGPT OAuth tokens**, not API keys
- The connection is an **opaque TLS tunnel** — `CONNECT` + encrypted WebSocket

## Why other approaches fail

| Approach | Why it doesn't work |
|----------|-------------------|
| `OPENAI_BASE_URL` | Codex ignores it — uses `chatgpt.com/backend-api/codex/responses`, not `api.openai.com` |
| HTTP proxy | Sees encrypted bytes after CONNECT. Cannot inspect or modify WebSocket frames |
| Call gpt-4o-mini directly | Cloudflare blocks non-browser HTTP POSTs to `chatgpt.com`. The endpoint also rejects non-Codex models |
| `openai_base_url` env var | Only affects Aider/OpenCode, not Codex |

## Solution: TLS-terminating MITM proxy

Squeezr runs a MITM proxy on port 8081 (`HTTPS_PROXY=http://localhost:8081`) that terminates TLS, intercepts WebSocket frames, and compresses tool output in-flight.

### Architecture

```
Codex CLI
    │
    ▼ CONNECT chatgpt.com:443
Squeezr MITM (:8081)
    │ ① Accept CONNECT, respond 200
    │ ② TLS-terminate with fake chatgpt.com cert (signed by local CA)
    │ ③ Strip Sec-WebSocket-Extensions: permessage-deflate
    │ ④ WebSocket upgrade → plain JSON frames
    │
    ├──── Client frames (Codex → ChatGPT)
    │     ⑤ Parse JSON, find tool outputs > 800 chars
    │     ⑥ Open separate WebSocket to real chatgpt.com
    │     ⑦ Compress via gpt-5.4-mini using same OAuth token
    │     ⑧ Replace output in original frame
    │     ⑨ Forward modified frame to chatgpt.com
    │
    └──── Server frames (ChatGPT → Codex)
          Passthrough — no modification
```

### Key technical decisions

**Why strip `permessage-deflate`?**
WebSocket deflate uses a shared compression context across frames. If we modify a frame's payload, the deflate context desyncs and all subsequent frames become garbage. Stripping the extension forces plain-text frames at the cost of ~30% more bandwidth — but enables reliable interception.

**Why WebSocket-to-WebSocket compression instead of HTTP?**
Cloudflare blocks non-browser HTTP POSTs to `chatgpt.com`. But WebSocket connections, once upgraded, bypass Cloudflare's HTTP-level checks. We open a second WebSocket to ChatGPT using the same OAuth token, send a compression prompt to `gpt-5.4-mini`, and get the compressed result back.

**Why `gpt-5.4-mini` specifically?**
The `/backend-api/codex/responses` endpoint only accepts models available in the user's Codex subscription. `gpt-5.4-mini` is the cheapest model that works — compression costs $0 since it uses the same ChatGPT subscription.

**How is the OAuth token captured?**
Before the WebSocket upgrade, Codex makes HTTP requests through the proxy (MCP init, health checks). We capture the `Authorization: Bearer ...` header and the `chatgpt-account-id` from these requests. The captured token is reused for the compression WebSocket.

**Request format quirk:**
ChatGPT's `/codex/responses` endpoint expects `instructions` as a top-level field, not nested inside `input`. Getting this wrong returns a 400.

## CA trust setup

The MITM proxy generates a local CA certificate at `~/.squeezr/mitm-ca/ca.crt` on first run. For Codex to accept the fake `chatgpt.com` certificate, the CA must be trusted by the system.

### Why this matters for Codex specifically

Codex is a **Rust binary** (not Node.js). It does not read `NODE_EXTRA_CA_CERTS`. On each platform:

| Platform | How Rust resolves CA trust | What Squeezr does |
|----------|---------------------------|-------------------|
| **Windows** | Windows Certificate Store (SChannel) | `certutil -addstore -user Root ca.crt` (no admin needed) |
| **macOS** | System Keychain | `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ca.crt` |
| **Linux** | `/etc/ssl/certs/` or `SSL_CERT_FILE` | Generates bundle.crt (system CAs + Squeezr CA), sets `SSL_CERT_FILE` |

`squeezr setup` handles all of this automatically. The CA is valid for 10 years — you only need to run setup once.

### Domains bypassed (NO_PROXY)

These domains are **not** intercepted by the MITM proxy — they go direct:

```
auth.openai.com      # OAuth login flow
login.openai.com     # OAuth login flow
api.openai.com       # Standard API (not used by Codex, but safety)
api.anthropic.com    # Claude API
generativelanguage.googleapis.com  # Gemini API
```

Only `chatgpt.com` traffic passes through the MITM.

## Setup

```bash
npm install -g squeezr-ai
squeezr setup    # sets HTTPS_PROXY, imports CA, configures auto-start
squeezr start    # starts both the HTTP proxy (:8080) and MITM proxy (:8081)
```

After setup, open a new terminal (so env vars take effect) and run `codex` normally.

### Verify it works

1. Check the proxy is running: `squeezr status`
2. Check env: `echo $HTTPS_PROXY` → should be `http://localhost:8081`
3. Check CA trust (Windows): `certutil -verifystore -user Root "Squeezr-MITM-CA"`
4. Check logs after a Codex session: `squeezr logs` — look for lines like `-4200 chars via gpt-5.4-mini`

## Compression details

| Metric | Value |
|--------|-------|
| Compression threshold | 800 chars (tool outputs smaller than this pass through) |
| Compression model | gpt-5.4-mini |
| Compression timeout | 15 seconds |
| Typical compression ratio | 80–90% |
| Latency per compressed frame | 2–3 seconds |
| Cost | $0 (uses existing ChatGPT subscription) |

### What gets compressed

The proxy only compresses **client-to-server frames** (Codex sending tool results to the model). Server-to-model responses pass through unmodified.

Within client frames, only tool output fields exceeding 800 characters are compressed. The compression prompt:

> Extract ONLY essential info: errors, file paths, function names, test failures, key values, warnings. Very concise, under 150 tokens.

## Limitations

- **15-second timeout** per compression — if gpt-5.4-mini is slow, the frame passes through uncompressed
- **No deterministic rules** — unlike the HTTP proxy (port 8080), the MITM proxy uses AI-only compression. The WebSocket binary protocol makes it harder to apply regex-based rules
- **Single model** — hardcoded to gpt-5.4-mini (cheapest available in Codex subscriptions)
- **No server→client compression** — model responses are not compressed (they're usually already concise)
- **deflate disabled** — ~30% bandwidth increase vs native WebSocket compression

## Files

```
src/codexMitm.ts          # MITM proxy, TLS termination, WebSocket interception
~/.squeezr/mitm-ca/       # Generated CA certificate and per-host certs
  ca.key                  # CA private key (0600)
  ca.crt                  # CA certificate (imported to system trust)
  bundle.crt              # CA + system CAs bundle (for SSL_CERT_FILE on Linux)
```
