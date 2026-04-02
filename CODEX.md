# Codex compression: the problem and the solution

## The problem

OpenAI Codex CLI is a coding assistant that reads files, runs commands, and sends everything back to the AI as context. Every tool result — file contents, shell output, grep results — is included verbatim in the next request. A single `read` of a 300-line file can add 10,000+ tokens of context.

Unlike Claude Code (which talks to `api.anthropic.com` via standard HTTP), Codex communicates with `chatgpt.com` over **WebSocket**. Specifically:

- Codex opens a TLS connection to `chatgpt.com:443`
- It upgrades to WebSocket at `/backend-api/codex/responses`
- All conversation happens as WebSocket frames using OpenAI's **Responses API** format
- Frames are compressed with `permessage-deflate` (context takeover enabled)

This makes traditional HTTP proxy interception impossible. You can't just rewrite request bodies like you would with `api.openai.com`.

## Why existing approaches don't work

### Can't use OPENAI_BASE_URL

Codex doesn't use the standard OpenAI API. It uses chatgpt.com's internal backend API with ChatGPT OAuth tokens (not API keys). Setting `OPENAI_BASE_URL` breaks authentication entirely.

### Can't use a regular HTTP proxy

A standard HTTP proxy sees Codex's `CONNECT chatgpt.com:443` request and creates an opaque tunnel. The proxy can't inspect or modify the encrypted WebSocket traffic inside.

### Can't call gpt-4o-mini for compression

The obvious idea: intercept tool results and compress them with a cheap model. But:

1. **Cloudflare blocks direct HTTP requests** — chatgpt.com has Cloudflare challenge protection. HTTP POST requests from Node.js get 403'd because they lack browser cookies/challenge tokens.
2. **The Codex endpoint only accepts Codex models** — `/backend-api/codex/responses` rejects `gpt-4o-mini`, `o4-mini`, `gpt-4.1-nano`, etc. with `"model is not supported when using Codex with a ChatGPT account"`.

## The solution

Squeezr uses a **TLS-terminating MITM proxy** combined with **WebSocket-to-WebSocket compression**.

### Architecture

```
Codex CLI
    │
    │ CONNECT chatgpt.com:443
    ▼
┌──────────────────────┐
│  Squeezr MITM :8081  │
│                      │
│  1. Accept CONNECT   │
│  2. TLS terminate    │◄── Local CA cert
│     (fake cert for   │
│      chatgpt.com)    │
│  3. Detect WS upgrade│
│  4. Strip deflate    │── No permessage-deflate = plain text frames
│  5. Connect upstream │── Real TLS to chatgpt.com:443
│  6. Relay 101        │
│                      │
│  For each WS frame:  │
│  ┌────────────────┐  │
│  │ Parse JSON     │  │
│  │ Find tool      │  │
│  │ outputs > 800  │  │
│  │ chars          │  │
│  └──────┬─────────┘  │
│         │            │
│    ┌────▼────────┐   │
│    │ Open NEW WS │   │    ┌─────────────────┐
│    │ to chatgpt  │───┼───►│  chatgpt.com    │
│    │ with same   │   │    │  gpt-5.4-mini   │
│    │ OAuth token │   │    │  "summarize it" │
│    │             │◄──┼────│  → compressed   │
│    └────┬────────┘   │    └─────────────────┘
│         │            │
│    Replace output    │
│    in original frame │
│    Forward to server │
└──────────────────────┘
    │
    ▼
chatgpt.com (real)
```

### Key technical decisions

#### 1. Strip `permessage-deflate` instead of re-compressing

When Codex negotiates a WebSocket with `permessage-deflate` (context takeover enabled), modifying ANY frame payload would desync the deflate context, breaking ALL subsequent frames.

**Solution**: Strip the `Sec-WebSocket-Extensions` header from the upgrade request before forwarding to chatgpt.com. The server responds without the extension, so all frames are plain text JSON. This adds ~30% bandwidth but makes interception trivial.

#### 2. WebSocket-to-WebSocket compression (not HTTP POST)

Cloudflare blocks direct HTTP POST requests to chatgpt.com from non-browser clients. But WebSocket connections pass through once the initial handshake succeeds.

**Solution**: For each tool result that needs compression, Squeezr opens a **separate** WebSocket to `chatgpt.com/backend-api/codex/responses` using the same OAuth token extracted from Codex's upgrade request. The compression request is sent as a WebSocket frame with `{"type": "response.create", "model": "gpt-5.4-mini", ...}`.

#### 3. Use `gpt-5.4-mini` (not gpt-4o-mini)

The `/backend-api/codex/responses` endpoint only accepts models that are part of the Codex product. `gpt-4o-mini`, `o4-mini`, and other standard models are rejected with a 400 error.

`gpt-5.4-mini` is the cheapest model that the Codex endpoint accepts, and it's included in the Codex subscription — no extra API costs.

#### 4. Request format: `instructions` at top level

The Codex Responses API requires the `instructions` field at the top level of the JSON (not nested inside a `response` object). The format is:

```json
{
  "type": "response.create",
  "model": "gpt-5.4-mini",
  "instructions": "Extract ONLY essential info...",
  "input": [{ "role": "user", "content": "<tool output>" }]
}
```

#### 5. Capture `chatgpt-account-id` from HTTP requests

Some chatgpt.com API calls require the `chatgpt-account-id` header. Squeezr captures this from the HTTP requests that Codex makes before the WebSocket upgrade (e.g., `/backend-api/plugins/featured`) and includes it in compression calls.

## Results

| Metric | Before Squeezr | With Squeezr |
|--------|---------------|-------------|
| File read (300 lines) | ~10,000 chars | ~700 chars |
| Command output (ls, grep) | ~2,000 chars | ~300 chars |
| Compression ratio | — | 80-90% |
| Extra cost | — | $0 (same subscription) |
| Latency per compression | — | ~2-3s |

## Setup

```bash
npm i -g squeezr-ai
squeezr setup    # generates CA, configures HTTPS_PROXY + SSL_CERT_FILE
squeezr start    # starts both proxies (8080 + 8081)
codex             # works normally, but with compressed context
```

## Limitations

- **15-second timeout** — if gpt-5.4-mini doesn't respond in 15s, the original uncompressed output is forwarded unchanged.
- **One compression model** — currently hardcoded to `gpt-5.4-mini`. If OpenAI adds cheaper Codex-compatible models, this should be updated.
- **CA trust** — the local CA must be trusted by the client. `squeezr setup` handles this automatically via `SSL_CERT_FILE`, but manual setups need to export both environment variables.
- **No server-to-client compression** — only client-to-server frames (tool results sent by Codex) are compressed. Server responses (AI-generated text) pass through unchanged.
