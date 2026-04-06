import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Hono, type Context } from 'hono'
import { stream, streamSSE } from 'hono/streaming'
import { config, applyMode, runtimeOverrides } from './config.js'
import { Stats } from './stats.js'
import { DASHBOARD_HTML } from './dashboard.js'
import { getCache } from './compressor.js'
import {
  compressAnthropicMessages,
  compressOpenAIMessages,
  compressGeminiContents,
} from './compressor.js'
import {
  injectExpandToolAnthropic,
  injectExpandToolOpenAI,
  handleAnthropicExpandCall,
  handleOpenAIExpandCall,
  retrieveOriginal,
  expandStoreSize,
} from './expand.js'
import { compressSystemPrompt } from './systemPrompt.js'
import { sessionCacheSize } from './sessionCache.js'
import { detPatternHits } from './deterministic.js'
import { VERSION } from './version.js'

const ANTHROPIC_API = 'https://api.anthropic.com'
const OPENAI_API = 'https://api.openai.com'
const GOOGLE_API = 'https://generativelanguage.googleapis.com'

const SKIP_REQ_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'expect'])

function readCodexToken(): string | null {
  try {
    const d = JSON.parse(readFileSync(join(homedir(), '.codex', 'auth.json'), 'utf-8'))
    return (d?.tokens?.access_token as string) ?? null
  } catch { return null }
}
const SKIP_RESP_HEADERS = new Set(['content-encoding', 'transfer-encoding', 'connection', 'content-length'])

export const stats = new Stats()

function forwardHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of headers.entries()) {
    if (!SKIP_REQ_HEADERS.has(k.toLowerCase())) out[k] = v
  }
  return out
}

function extractOpenAIKey(headers: Headers): string {
  const auth = headers.get('authorization') ?? ''
  return auth.replace(/^bearer\s+/i, '').trim()
}

function extractGoogleKey(headers: Headers, url: URL): string {
  return headers.get('x-goog-api-key') ?? url.searchParams.get('key') ?? ''
}

function detectUpstream(headers: Headers): string {
  if (headers.get('x-goog-api-key')) return GOOGLE_API
  const auth = headers.get('authorization') ?? ''
  if (auth && !headers.get('x-api-key')) return OPENAI_API
  return ANTHROPIC_API
}

function estimateChars(data: unknown): number {
  return JSON.stringify(data).length
}

async function proxyStream(upstream: string, body: unknown, headers: Record<string, string>, params?: URLSearchParams): Promise<Response> {
  const url = params?.toString() ? `${upstream}?${params}` : upstream
  return fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const app = new Hono()

// ── CORS middleware (required for Cursor IDE and browser-based tools) ─────────
// Cursor's Electron renderer sends OPTIONS preflight before every POST.
// Without this the request is blocked and Cursor shows a network error.

app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    })
  }
  await next()
  c.res.headers.set('Access-Control-Allow-Origin', '*')
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  c.res.headers.set('Access-Control-Allow-Headers', '*')
})

// ── Anthropic / Claude Code ───────────────────────────────────────────────────

app.post('/v1/messages', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  // Support both API key (x-api-key: sk-ant-...) and OAuth bearer token
  // (Authorization: Bearer ...) — Claude Code subscription uses OAuth
  const apiKey = c.req.header('x-api-key')
    ?? c.req.header('authorization')?.replace(/^bearer\s+/i, '').trim()
    ?? process.env.ANTHROPIC_API_KEY
    ?? ''

  // System prompt compression (handles both string and array formats — Claude Code sends array)
  if (config.compressSystemPrompt && !config.dryRun) {
    if (typeof body.system === 'string') {
      body.system = await compressSystemPrompt(body.system, apiKey, 'haiku')
    } else if (Array.isArray(body.system)) {
      for (const block of body.system as Array<{ type?: string; text?: string }>) {
        if (block.type === 'text' && typeof block.text === 'string') {
          block.text = await compressSystemPrompt(block.text, apiKey, 'haiku')
        }
      }
    }
  }

  const messages = (body.messages ?? []) as unknown[]
  const originalChars = estimateChars(messages)

  const systemExtraChars = typeof body.system === 'string'
    ? body.system.length
    : Array.isArray(body.system)
      ? (body.system as Array<{ text?: string }>).reduce((s, b) => s + (b.text?.length ?? 0), 0)
      : 0

  const [compressedMsgs, savings] = await compressAnthropicMessages(messages as Parameters<typeof compressAnthropicMessages>[0], apiKey, config, systemExtraChars)
  body.messages = compressedMsgs

  // Inject expand tool
  injectExpandToolAnthropic(body)

  stats.record(originalChars, estimateChars(compressedMsgs), savings)

  const fwdHeaders = forwardHeaders(c.req.raw.headers)

  if (body.stream) {
    const upstream = await proxyStream(`${ANTHROPIC_API}/v1/messages`, body, fwdHeaders)
    return stream(c, async (s) => {
      const reader = upstream.body!.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await s.write(value)
      }
    })
  }

  const resp = await fetch(`${ANTHROPIC_API}/v1/messages`, {
    method: 'POST',
    headers: { ...fwdHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const respBody = await resp.json() as Record<string, unknown>

  // Handle expand() call if model requested one
  const expandCall = handleAnthropicExpandCall(respBody)
  if (expandCall) {
    const { toolUseId, original } = expandCall
    const continueMessages = [
      ...(body.messages as unknown[]),
      { role: 'assistant', content: respBody.content },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: original }],
      },
    ]
    body.messages = continueMessages
    const continuedResp = await fetch(`${ANTHROPIC_API}/v1/messages`, {
      method: 'POST',
      headers: { ...fwdHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const continuedBody = await continuedResp.json()
    return c.json(continuedBody, continuedResp.status as any)
  }

  const respHeaders: Record<string, string> = {}
  for (const [k, v] of resp.headers.entries()) {
    if (!SKIP_RESP_HEADERS.has(k.toLowerCase())) respHeaders[k] = v
  }
  return c.json(respBody, resp.status as any, respHeaders)
})

// ── OpenAI / Codex / Ollama ───────────────────────────────────────────────────

app.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const openAIKey = extractOpenAIKey(c.req.raw.headers)
  const isLocal = config.isLocalKey(openAIKey)
  const upstream = isLocal ? `${config.localUpstreamUrl.replace(/\/$/, '')}/v1/chat/completions` : `${OPENAI_API}/v1/chat/completions`

  const messages = (body.messages ?? []) as unknown[]

  // Compress system message for non-local
  if (!isLocal && config.compressSystemPrompt && !config.dryRun) {
    const msgs = messages as Array<{ role: string; content?: string }>
    if (msgs[0]?.role === 'system' && typeof msgs[0].content === 'string') {
      msgs[0].content = await compressSystemPrompt(msgs[0].content, openAIKey, 'gpt-mini')
    }
  }

  const originalChars = estimateChars(messages)
  const [compressedMsgs, savings] = await compressOpenAIMessages(
    messages as Parameters<typeof compressOpenAIMessages>[0],
    openAIKey,
    config,
    isLocal,
  )
  body.messages = compressedMsgs

  if (!isLocal) injectExpandToolOpenAI(body)

  stats.record(originalChars, estimateChars(compressedMsgs), savings)

  const fwdHeaders = forwardHeaders(c.req.raw.headers)

  if (body.stream) {
    const upstreamResp = await proxyStream(upstream, body, fwdHeaders)
    return stream(c, async (s) => {
      const reader = upstreamResp.body!.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await s.write(value)
      }
    })
  }

  const resp = await fetch(upstream, {
    method: 'POST',
    headers: { ...fwdHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const respBody = await resp.json() as Record<string, unknown>

  const expandCall = !isLocal ? handleOpenAIExpandCall(respBody) : null
  if (expandCall) {
    const { toolCallId, original } = expandCall
    const continueMessages = [
      ...(body.messages as unknown[]),
      (respBody.choices as Array<{ message: unknown }>)[0].message,
      { role: 'tool', tool_call_id: toolCallId, content: original },
    ]
    body.messages = continueMessages
    const continuedResp = await fetch(upstream, {
      method: 'POST',
      headers: { ...fwdHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return c.json(await continuedResp.json(), continuedResp.status as any)
  }

  const respHeaders: Record<string, string> = {}
  for (const [k, v] of resp.headers.entries()) {
    if (!SKIP_RESP_HEADERS.has(k.toLowerCase())) respHeaders[k] = v
  }
  return c.json(respBody, resp.status as any, respHeaders)
})

// ── Gemini CLI ────────────────────────────────────────────────────────────────

app.post('/v1beta/models/*', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const url = new URL(c.req.url)
  const googleKey = extractGoogleKey(c.req.raw.headers, url)
  const modelPath = c.req.path.replace('/v1beta/models/', '')

  const contents = (body.contents ?? []) as unknown[]
  const originalChars = estimateChars(contents)

  const [compressedContents, savings] = await compressGeminiContents(
    contents as Parameters<typeof compressGeminiContents>[0],
    googleKey,
    config,
  )
  body.contents = compressedContents

  stats.record(originalChars, estimateChars(compressedContents), savings)

  const targetUrl = `${GOOGLE_API}/v1beta/models/${modelPath}`
  const fwdHeaders = forwardHeaders(c.req.raw.headers)
  const params = url.searchParams

  if (modelPath.includes('stream')) {
    const upstreamResp = await proxyStream(targetUrl, body, fwdHeaders, params)
    return stream(c, async (s) => {
      const reader = upstreamResp.body!.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await s.write(value)
      }
    })
  }

  const paramStr = params.toString()
  const resp = await fetch(paramStr ? `${targetUrl}?${paramStr}` : targetUrl, {
    method: 'POST',
    headers: { ...fwdHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const respHeaders: Record<string, string> = {}
  for (const [k, v] of resp.headers.entries()) {
    if (!SKIP_RESP_HEADERS.has(k.toLowerCase())) respHeaders[k] = v
  }
  return c.body(await resp.arrayBuffer(), resp.status as any, respHeaders)
})

// ── Squeezr internal endpoints ────────────────────────────────────────────────

app.get('/squeezr/stats', (c) => {
  return c.json({ ...stats.summary(), cache: getCache(config).stats(), expand_store_size: expandStoreSize(), session_cache_size: sessionCacheSize(), dry_run: config.dryRun, pattern_hits: detPatternHits, version: VERSION, port: config.port, mode: runtimeOverrides.mode })
})

app.get('/squeezr/health', (c) => {
  return c.json({ status: 'ok', version: VERSION })
})

app.get('/squeezr/expand/:id', (c) => {
  const id = c.req.param('id')
  const original = retrieveOriginal(id)
  if (!original) return c.json({ error: 'Not found or expired' }, 404)
  return c.json({ id, content: original })
})

// ── Dashboard + SSE + config ──────────────────────────────────────────────────

app.get('/squeezr/dashboard', (c) => {
  return c.html(DASHBOARD_HTML)
})

app.get('/squeezr/events', (c) => {
  return streamSSE(c, async (s) => {
    // Send initial data immediately
    const payload = { ...stats.summary(), cache: getCache(config).stats(), expand_store_size: expandStoreSize(), session_cache_size: sessionCacheSize(), dry_run: config.dryRun, pattern_hits: detPatternHits, version: VERSION, port: config.port, mode: runtimeOverrides.mode }
    await s.writeSSE({ data: JSON.stringify(payload) })
    while (true) {
      await s.sleep(2000)
      try {
        const d = { ...stats.summary(), cache: getCache(config).stats(), expand_store_size: expandStoreSize(), session_cache_size: sessionCacheSize(), dry_run: config.dryRun, pattern_hits: detPatternHits, version: VERSION, port: config.port, mode: runtimeOverrides.mode }
        await s.writeSSE({ data: JSON.stringify(d) })
      } catch { break }
    }
  })
})

app.post('/squeezr/config', async (c) => {
  const body = await c.req.json<{ mode?: string }>()
  if (body.mode && ['soft','normal','aggressive','critical'].includes(body.mode)) {
    applyMode(body.mode as 'soft' | 'normal' | 'aggressive' | 'critical')
  }
  return c.json({ ok: true, mode: runtimeOverrides.mode })
})

// ── OAuth token refresh proxy (Codex: set CODEX_REFRESH_TOKEN_URL_OVERRIDE=http://localhost:PORT/oauth/token) ──

app.post('/oauth/token', async (c) => {
  const body = await c.req.arrayBuffer()
  const resp = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': c.req.header('content-type') ?? 'application/json' },
    body,
  })
  const data = await resp.arrayBuffer()
  return c.body(data, resp.status as any, { 'content-type': 'application/json' })
})


// ── Catch-all ─────────────────────────────────────────────────────────────────

app.all('*', async (c) => {
  let upstream = detectUpstream(c.req.raw.headers)
  const url = new URL(c.req.url)
  const NEEDS_V1 = new Set(['/models', '/engines', '/files', '/embeddings', '/moderations', '/completions', '/edits', '/responses'])
  const pathname = NEEDS_V1.has(url.pathname) ? `/v1${url.pathname}` : url.pathname

  // /responses is exclusively an OpenAI Codex endpoint — override upstream regardless
  // of what detectUpstream inferred from headers (Codex sends no auth to custom base URLs).
  if (pathname === '/v1/responses') upstream = OPENAI_API

  const targetUrl = `${upstream}${pathname}${url.search}`
  const body = await c.req.arrayBuffer()
  const fwdHeaders = forwardHeaders(c.req.raw.headers)

  // Inject Codex OAuth token from ~/.codex/auth.json when no auth header present.
  if (upstream === OPENAI_API && !fwdHeaders['authorization']) {
    const codexToken = readCodexToken()
    if (codexToken) fwdHeaders['authorization'] = `Bearer ${codexToken}`
  }

  const resp = await fetch(targetUrl, {
    method: c.req.method,
    headers: fwdHeaders,
    body: body.byteLength > 0 ? body : undefined,
  })

  const respHeaders: Record<string, string> = {}
  for (const [k, v] of resp.headers.entries()) {
    if (!SKIP_RESP_HEADERS.has(k.toLowerCase())) respHeaders[k] = v
  }

  const contentType = resp.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    return stream(c, async (s) => {
      const reader = resp.body!.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await s.write(value)
      }
    })
  }
  return c.body(await resp.arrayBuffer(), resp.status as any, respHeaders)
})
