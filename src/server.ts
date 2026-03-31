import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { config } from './config.js'
import { Stats } from './stats.js'
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

const ANTHROPIC_API = 'https://api.anthropic.com'
const OPENAI_API = 'https://api.openai.com'
const GOOGLE_API = 'https://generativelanguage.googleapis.com'

const SKIP_REQ_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection'])
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

// ── Anthropic / Claude Code ───────────────────────────────────────────────────

app.post('/v1/messages', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const apiKey = c.req.header('x-api-key') ?? process.env.ANTHROPIC_API_KEY ?? ''

  // System prompt compression
  if (config.compressSystemPrompt && !config.dryRun && typeof body.system === 'string') {
    body.system = await compressSystemPrompt(body.system, apiKey, 'haiku')
  }

  const messages = (body.messages ?? []) as unknown[]
  const originalChars = estimateChars(messages)

  const [compressedMsgs, savings] = await compressAnthropicMessages(messages as Parameters<typeof compressAnthropicMessages>[0], apiKey, config)
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
  return c.json({ ...stats.summary(), cache: getCache(config).stats(), expand_store_size: expandStoreSize(), session_cache_size: sessionCacheSize(), dry_run: config.dryRun })
})

app.get('/squeezr/health', (c) => {
  return c.json({ status: 'ok', version: '1.0.0' })
})

app.get('/squeezr/expand/:id', (c) => {
  const id = c.req.param('id')
  const original = retrieveOriginal(id)
  if (!original) return c.json({ error: 'Not found or expired' }, 404)
  return c.json({ id, content: original })
})

// ── Catch-all ─────────────────────────────────────────────────────────────────

app.all('*', async (c) => {
  const upstream = detectUpstream(c.req.raw.headers)
  const url = new URL(c.req.url)
  const targetUrl = `${upstream}${url.pathname}${url.search}`
  const body = await c.req.arrayBuffer()
  const fwdHeaders = forwardHeaders(c.req.raw.headers)

  const resp = await fetch(targetUrl, {
    method: c.req.method,
    headers: fwdHeaders,
    body: body.byteLength > 0 ? body : undefined,
  })

  const respHeaders: Record<string, string> = {}
  for (const [k, v] of resp.headers.entries()) {
    if (!SKIP_RESP_HEADERS.has(k.toLowerCase())) respHeaders[k] = v
  }
  return c.body(await resp.arrayBuffer(), resp.status as any, respHeaders)
})
