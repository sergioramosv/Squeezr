import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { Hono, type Context } from 'hono'
import { stream, streamSSE } from 'hono/streaming'
import { config, applyMode, runtimeOverrides } from './config.js'
import { Stats } from './stats.js'
import type { LatencyInfo } from './stats.js'
import { DASHBOARD_HTML } from './dashboard.js'
import { getCache, emptySavings } from './compressor.js'
import {
  compressAnthropicMessages,
  compressOpenAIMessages,
  compressGeminiContents,
} from './compressor.js'
import { isBypassed, setBypassed, toggleBypassed } from './bypass.js'
import { circuitBreaker } from './circuitBreaker.js'
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
import {
  recordRequest,
  getHistorySessions,
  getCurrentSession,
  getProjectAggregates,
  getAllSessionsForHistory,
} from './history.js'
import {
  updateAnthropicFromHeaders,
  updateOpenAIFromHeaders,
  updateGeminiFrom429,
  addAnthropicUsage,
  addOpenAIUsage,
  addGeminiUsage,
  makeSseUsageParser,
  maybeRefreshOpenAIBilling,
  maybeRefreshOpenAISessionLimits,
  storeKey,
  limitsSnapshot,
} from './limits.js'

// ── Project name extraction ────────────────────────────────────────────────────
// Manual project override — set via /squeezr/project endpoint or MCP tool
let manualProject: string | null = null

export function setManualProject(name: string | null): void {
  manualProject = name
}

export function getManualProject(): string | null {
  return manualProject
}

// Reads the CWD from Claude Code's system prompt (injected as <cwd>…</cwd> or
// "current working directory: …") and returns the last path component.

function extractProjectName(body: Record<string, unknown>): string {
  if (manualProject) return manualProject

  try {
    const system = body.system
    let text = ''
    if (Array.isArray(system)) {
      text = (system as Array<{ type?: string; text?: string }>)
        .map(s => s.text ?? '')
        .join(' ')
    } else if (typeof system === 'string') {
      text = system
    }

    // Claude Code format: <cwd>/path/to/project</cwd>
    const xmlCwd = text.match(/<cwd>([^<]+)<\/cwd>/)
    if (xmlCwd) {
      const parts = xmlCwd[1].trim().replace(/\\/g, '/').split('/').filter(Boolean)
      if (parts.length) return parts[parts.length - 1]
    }

    // Plain-text format: "current working directory: /path"
    const plainCwd = text.match(/(?:current working directory|cwd)[:\s]+([^\n<]+)/i)
    if (plainCwd) {
      const parts = plainCwd[1].trim().replace(/\\/g, '/').split('/').filter(Boolean)
      if (parts.length) return parts[parts.length - 1]
    }

    // Fallback: extract LAST meaningful path segment from system prompt
    // e.g. C:\Users\Ramos\Documents\InvoiceApp\src → InvoiceApp
    // Only match filesystem paths (not URLs like https://github.com)
    const pathMatch = text.match(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|workspace|projects|Documents)[\\/])[^\s<>"*?|]+/i)
    if (pathMatch && !pathMatch[0].includes('://')) {
      const parts = pathMatch[0].replace(/\\/g, '/').split('/').filter(Boolean)
      const skip = new Set([
        'users', 'home', 'documents', 'workspace', 'projects', 'desktop',
        'dev', 'src', 'repos', 'mnt', 'c', 'var', 'tmp', 'opt', 'usr',
        'lib', 'bin', 'etc', 'node_modules', '.claude', '.config',
      ])
      for (const pt of parts) {
        if (!skip.has(pt.toLowerCase()) && !/^[a-z]:$/i.test(pt) && pt.length > 1) return pt
      }
      if (parts.length) return parts[parts.length - 1]
    }
  } catch { /* ignore */ }
  return 'unknown'
}

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

  // Extract project name BEFORE compressing system prompt (compression destroys <cwd> tags)
  const project = extractProjectName(body)

  const messages = (body.messages ?? []) as unknown[]
  const originalChars = estimateChars(messages)

  // Dry-run mode: exercises the compression pipeline but does NOT forward to
  // upstream. Used by the post-start self-test to verify the request path is
  // wired correctly without consuming any API quota.
  if (c.req.header('x-squeezr-dryrun') === '1') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [dryMessages, savings] = await compressAnthropicMessages(messages as any, apiKey, config)
    const compressedChars = estimateChars(dryMessages as unknown[])
    return c.json({
      identity: 'squeezr',
      dry_run: true,
      original_chars: originalChars,
      compressed_chars: compressedChars,
      saved_chars: Math.max(0, originalChars - compressedChars),
      savings,
    })
  }

  // Bypass mode: skip all compression, still record request stats
  if (isBypassed()) {
    stats.recordWithProject(project, originalChars, originalChars, emptySavings())
    recordRequest(project, 0, 0, [])
    storeKey('anthropic', apiKey)
    const fwdHeaders = forwardHeaders(c.req.raw.headers)
    if (body.stream) {
      const upstream = await proxyStream(`${ANTHROPIC_API}/v1/messages`, body, fwdHeaders)
      updateAnthropicFromHeaders(upstream.headers)
      for (const [k, v] of upstream.headers.entries()) {
        if (!SKIP_RESP_HEADERS.has(k.toLowerCase())) c.header(k, v)
      }
      return stream(c, async (s) => {
        const reader = upstream.body!.getReader()
        const decoder = new TextDecoder()
        const sseParser = makeSseUsageParser('anthropic', (inp, out) => addAnthropicUsage(inp, out))
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          await s.write(value)
          sseParser(decoder.decode(value, { stream: true }))
        }
      })
    }
    const resp = await fetch(`${ANTHROPIC_API}/v1/messages`, {
      method: 'POST',
      headers: { ...fwdHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    updateAnthropicFromHeaders(resp.headers)
    const respBody = await resp.json()
    const respHeaders: Record<string, string> = {}
    for (const [k, v] of resp.headers.entries()) {
      if (!SKIP_RESP_HEADERS.has(k.toLowerCase())) respHeaders[k] = v
    }
    return c.json(respBody, resp.status as any, respHeaders)
  }

  // System prompt compression (handles both string and array formats — Claude Code sends array)
  if (config.compressSystemPrompt && !config.dryRun) {
    if (typeof body.system === 'string') {
      const sp = await compressSystemPrompt(body.system, apiKey, 'haiku')
      body.system = sp.text
      stats.recordSystemPromptSaved(sp.originalLen, sp.compressedLen)
    } else if (Array.isArray(body.system)) {
      for (const block of body.system as Array<{ type?: string; text?: string }>) {
        if (block.type === 'text' && typeof block.text === 'string') {
          const sp = await compressSystemPrompt(block.text, apiKey, 'haiku')
          block.text = sp.text
          stats.recordSystemPromptSaved(sp.originalLen, sp.compressedLen)
        }
      }
    }
  }

  const systemExtraChars = typeof body.system === 'string'
    ? body.system.length
    : Array.isArray(body.system)
      ? (body.system as Array<{ text?: string }>).reduce((s, b) => s + (b.text?.length ?? 0), 0)
      : 0

  const compT0 = Date.now()
  const [compressedMsgs, savings] = await compressAnthropicMessages(messages as Parameters<typeof compressAnthropicMessages>[0], apiKey, config, systemExtraChars)
  const compLatency: LatencyInfo = { totalMs: Date.now() - compT0, detMs: savings.detMs, aiMs: savings.aiMs }
  body.messages = compressedMsgs

  // Inject expand tool
  injectExpandToolAnthropic(body)
  stats.recordWithProject(project, originalChars, estimateChars(compressedMsgs), savings, compLatency)
  recordRequest(project, savings.savedChars, savings.compressed, savings.byTool)

  storeKey('anthropic', apiKey)
  const fwdHeaders = forwardHeaders(c.req.raw.headers)

  if (body.stream) {
    const upstream = await proxyStream(`${ANTHROPIC_API}/v1/messages`, body, fwdHeaders)
    // Extract rate limit headers immediately (available before body starts)
    updateAnthropicFromHeaders(upstream.headers)
    // Forward anthropic-ratelimit-* (and other response) headers so Claude Code
    // can populate rate_limits in the statusline JSON (issue #4).
    for (const [k, v] of upstream.headers.entries()) {
      if (!SKIP_RESP_HEADERS.has(k.toLowerCase())) c.header(k, v)
    }
    return stream(c, async (s) => {
      const reader = upstream.body!.getReader()
      const decoder = new TextDecoder()
      const sseParser = makeSseUsageParser('anthropic', (inp, out) => addAnthropicUsage(inp, out))
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await s.write(value)
        sseParser(decoder.decode(value, { stream: true }))
      }
    })
  }

  const resp = await fetch(`${ANTHROPIC_API}/v1/messages`, {
    method: 'POST',
    headers: { ...fwdHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  // Extract rate limits and token usage from non-streaming response
  updateAnthropicFromHeaders(resp.headers)
  const respBody = await resp.json() as Record<string, unknown>
  if (respBody.usage) {
    const u = respBody.usage as { input_tokens?: number; output_tokens?: number }
    addAnthropicUsage(u.input_tokens ?? 0, u.output_tokens ?? 0)
  }

  // Handle expand() call if model requested one (track expand rate)
  const expandCall = handleAnthropicExpandCall(respBody)
  if (expandCall) {
    stats.recordExpand(true)
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
    updateAnthropicFromHeaders(continuedResp.headers)
    const continuedBody = await continuedResp.json()
    const continuedHeaders: Record<string, string> = {}
    for (const [k, v] of continuedResp.headers.entries()) {
      if (!SKIP_RESP_HEADERS.has(k.toLowerCase())) continuedHeaders[k] = v
    }
    return c.json(continuedBody, continuedResp.status as any, continuedHeaders)
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

  // Extract project name BEFORE compressing system prompt
  const oaiProject = extractProjectName(body)

  const messages = (body.messages ?? []) as unknown[]
  const originalChars = estimateChars(messages)

  // Bypass mode: skip all compression, still record request stats
  if (isBypassed()) {
    stats.recordWithProject(oaiProject, originalChars, originalChars, emptySavings())
    recordRequest(oaiProject, 0, 0, [])
    if (!isLocal) storeKey('openai', openAIKey)
    const fwdHeaders = forwardHeaders(c.req.raw.headers)
    if (body.stream) {
      const resp = await fetch(upstream, {
        method: 'POST',
        headers: { ...fwdHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!isLocal) updateOpenAIFromHeaders(resp.headers)
      return stream(c, async (s) => {
        const reader = resp.body!.getReader()
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
    if (!isLocal) updateOpenAIFromHeaders(resp.headers)
    const respBody = await resp.json()
    const respHeaders: Record<string, string> = {}
    for (const [k, v] of resp.headers.entries()) {
      if (!SKIP_RESP_HEADERS.has(k.toLowerCase())) respHeaders[k] = v
    }
    return c.json(respBody, resp.status as any, respHeaders)
  }

  // Compress system message for non-local
  if (!isLocal && config.compressSystemPrompt && !config.dryRun) {
    const msgs = messages as Array<{ role: string; content?: string }>
    if (msgs[0]?.role === 'system' && typeof msgs[0].content === 'string') {
      const sp = await compressSystemPrompt(msgs[0].content, openAIKey, 'gpt-mini')
      msgs[0].content = sp.text
      stats.recordSystemPromptSaved(sp.originalLen, sp.compressedLen)
    }
  }

  const oaiCompT0 = Date.now()
  const [compressedMsgs, savings] = await compressOpenAIMessages(
    messages as Parameters<typeof compressOpenAIMessages>[0],
    openAIKey,
    config,
    isLocal,
  )
  const oaiCompLatency: LatencyInfo = { totalMs: Date.now() - oaiCompT0, detMs: savings.detMs, aiMs: savings.aiMs }
  body.messages = compressedMsgs

  if (!isLocal) injectExpandToolOpenAI(body)
  stats.recordWithProject(oaiProject, originalChars, estimateChars(compressedMsgs), savings, oaiCompLatency)
  recordRequest(oaiProject, savings.savedChars, savings.compressed, savings.byTool)

  if (!isLocal) storeKey('openai', openAIKey)
  const fwdHeaders = forwardHeaders(c.req.raw.headers)

  if (body.stream) {
    // Ask OpenAI to include usage in the final chunk (harmless for most clients)
    if (!isLocal && !(body.stream_options as Record<string, unknown>)?.include_usage) {
      body.stream_options = { ...(body.stream_options as Record<string, unknown> ?? {}), include_usage: true }
    }
    const upstreamResp = await proxyStream(upstream, body, fwdHeaders)
    if (!isLocal) {
      updateOpenAIFromHeaders(upstreamResp.headers)
      maybeRefreshOpenAIBilling(openAIKey).catch(() => {})
    }
    return stream(c, async (s) => {
      const reader = upstreamResp.body!.getReader()
      const decoder = new TextDecoder()
      const sseParser = makeSseUsageParser('openai', (inp, out) => addOpenAIUsage(inp, out))
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await s.write(value)
        if (!isLocal) sseParser(decoder.decode(value, { stream: true }))
      }
    })
  }

  const resp = await fetch(upstream, {
    method: 'POST',
    headers: { ...fwdHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!isLocal) {
    updateOpenAIFromHeaders(resp.headers)
    maybeRefreshOpenAIBilling(openAIKey).catch(() => {})
  }
  const respBody = await resp.json() as Record<string, unknown>
  if (!isLocal && respBody.usage) {
    const u = respBody.usage as { prompt_tokens?: number; completion_tokens?: number }
    addOpenAIUsage(u.prompt_tokens ?? 0, u.completion_tokens ?? 0)
  }

  const expandCall = !isLocal ? handleOpenAIExpandCall(respBody) : null
  if (expandCall) {
    stats.recordExpand(true)
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
  const geminiProject = extractProjectName(body)

  // Bypass mode: skip all compression, still record request stats
  if (isBypassed()) {
    stats.recordWithProject(geminiProject, originalChars, originalChars, emptySavings())
    recordRequest(geminiProject, 0, 0, [])
    const targetUrl = `${GOOGLE_API}/v1beta/models/${modelPath}`
    const fwdHeaders = forwardHeaders(c.req.raw.headers)
    const params = url.searchParams
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
  }

  const gemCompT0 = Date.now()
  const [compressedContents, savings] = await compressGeminiContents(
    contents as Parameters<typeof compressGeminiContents>[0],
    googleKey,
    config,
  )
  const gemCompLatency: LatencyInfo = { totalMs: Date.now() - gemCompT0, detMs: savings.detMs, aiMs: savings.aiMs }
  body.contents = compressedContents

  stats.recordWithProject(geminiProject, originalChars, estimateChars(compressedContents), savings, gemCompLatency)
  recordRequest(geminiProject, savings.savedChars, savings.compressed, savings.byTool)

  const targetUrl = `${GOOGLE_API}/v1beta/models/${modelPath}`
  const fwdHeaders = forwardHeaders(c.req.raw.headers)
  const params = url.searchParams

  if (modelPath.includes('stream')) {
    const upstreamResp = await proxyStream(targetUrl, body, fwdHeaders, params)
    if (upstreamResp.status === 429) updateGeminiFrom429(upstreamResp.headers)
    return stream(c, async (s) => {
      const reader = upstreamResp.body!.getReader()
      const decoder = new TextDecoder()
      // Gemini streaming sends JSON array chunks with usageMetadata, not Anthropic-style SSE
      let gemBuf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await s.write(value)
        gemBuf += decoder.decode(value, { stream: true })
        const metaMatch = gemBuf.match(/"usageMetadata"\s*:\s*\{[^}]+\}/)
        if (metaMatch) {
          try {
            const meta = JSON.parse(`{${metaMatch[0]}}`) as { usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number } }
            addGeminiUsage(meta.usageMetadata.promptTokenCount ?? 0, meta.usageMetadata.candidatesTokenCount ?? 0)
          } catch { /* ignore parse errors */ }
          gemBuf = ''
        }
      }
    })
  }

  const paramStr = params.toString()
  const resp = await fetch(paramStr ? `${targetUrl}?${paramStr}` : targetUrl, {
    method: 'POST',
    headers: { ...fwdHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (resp.status === 429) updateGeminiFrom429(resp.headers)

  // Extract Gemini usage from response body
  const geminiRespBuf = await resp.arrayBuffer()
  try {
    const geminiRespJson = JSON.parse(new TextDecoder().decode(geminiRespBuf)) as Record<string, unknown>
    const meta = geminiRespJson.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined
    if (meta) addGeminiUsage(meta.promptTokenCount ?? 0, meta.candidatesTokenCount ?? 0)
  } catch { /* ignore */ }

  const respHeaders: Record<string, string> = {}
  for (const [k, v] of resp.headers.entries()) {
    if (!SKIP_RESP_HEADERS.has(k.toLowerCase())) respHeaders[k] = v
  }
  return c.body(geminiRespBuf, resp.status as any, respHeaders)
})

// ── Squeezr internal endpoints ────────────────────────────────────────────────

async function buildStatsPayload() {
  await maybeRefreshOpenAISessionLimits().catch(() => {})
  return {
    ...stats.summary(),
    cache: getCache(config).stats(),
    expand_store_size: expandStoreSize(),
    session_cache_size: sessionCacheSize(),
    dry_run: config.dryRun,
    pattern_hits: detPatternHits,
    version: VERSION,
    port: config.port,
    mode: runtimeOverrides.mode,
    limits: limitsSnapshot(),
    bypassed: isBypassed(),
    circuit_breaker: circuitBreaker.snapshot(),
  }
}

app.get('/squeezr/stats', (c) => {
  return buildStatsPayload().then(d => c.json(d))
})

app.get('/squeezr/health', (c) => {
  const cb = circuitBreaker.snapshot()
  const s = stats.summary()
  return c.json({
    // Magic identifier so callers can distinguish a real squeezr instance from
    // any other HTTP service that happens to answer 200 on this port (e.g. a
    // Docker container occupying the configured port).
    identity: 'squeezr',
    status: 'ok',
    version: VERSION,
    uptime_seconds: s.uptime_seconds,
    mode: runtimeOverrides.mode,
    bypassed: isBypassed(),
    circuit_breaker: {
      state: cb.state,
      consecutive_failures: cb.consecutive_failures,
      total_trips: cb.total_trips,
      last_success_ago_s: cb.last_success_time
        ? Math.round((Date.now() - cb.last_success_time) / 1000)
        : null,
    },
    expand_store: {
      size: expandStoreSize(),
      pressure: expandStoreSize() > 5000 ? 'high' : expandStoreSize() > 1000 ? 'medium' : 'low',
    },
    compression: {
      requests: s.requests,
      savings_pct: s.savings_pct,
    },
  })
})

// ── Self-test endpoint ─────────────────────────────────────────────────────
// Last self-test results are populated by src/selfTest.ts at startup and on
// demand via GET /squeezr/selftest?run=1.

let lastSelfTest: unknown = null
export function setLastSelfTest(result: unknown): void {
  lastSelfTest = result
}

app.get('/squeezr/selftest', async (c) => {
  if (c.req.query('run') === '1') {
    const { runSelfTest } = await import('./selfTest.js')
    const result = await runSelfTest({ port: Number(c.req.query('port')) || 0 })
    return c.json(result)
  }
  if (!lastSelfTest) {
    return c.json({ status: 'not_run', message: 'Self-test has not been executed yet. Call ?run=1 to execute.' })
  }
  return c.json(lastSelfTest)
})

// ── Project management ─────────────────────────────────────────────────────

app.get('/squeezr/project', (c) => {
  return c.json({ project: getManualProject() ?? stats.currentProjectName() })
})

app.post('/squeezr/project', async (c) => {
  const body = await c.req.json<{ project?: string | null }>()
  if (body.project === null || body.project === '') {
    setManualProject(null)
    return c.json({ project: stats.currentProjectName(), manual: false })
  }
  if (typeof body.project === 'string') {
    setManualProject(body.project)
    stats.setProject(body.project)
    return c.json({ project: body.project, manual: true })
  }
  return c.json({ error: 'Invalid project name' }, 400)
})

app.get('/squeezr/expand/:id', (c) => {
  const id = c.req.param('id')
  const original = retrieveOriginal(id)
  stats.recordExpand(!!original)
  if (!original) return c.json({ error: 'Not found or expired' }, 404)
  return c.json({ id, content: original })
})

// ── Dashboard + SSE + config ──────────────────────────────────────────────────

app.get('/squeezr/dashboard', (c) => {
  return c.html(DASHBOARD_HTML)
})

app.get('/squeezr/events', (c) => {
  return streamSSE(c, async (s) => {
    await s.writeSSE({ data: JSON.stringify(await buildStatsPayload()) })
    while (true) {
      await s.sleep(2000)
      try {
        await s.writeSSE({ data: JSON.stringify(await buildStatsPayload()) })
      } catch { break }
    }
  })
})

app.get('/squeezr/limits', async (c) => {
  await maybeRefreshOpenAISessionLimits().catch(() => {})
  return c.json(limitsSnapshot())
})

// ── History + Projects endpoints ──────────────────────────────────────────────

app.get('/squeezr/history', (c) => {
  return c.json({
    sessions: getAllSessionsForHistory(),
    current: getCurrentSession(),
  })
})

app.get('/squeezr/projects', (c) => {
  return c.json({ projects: getProjectAggregates() })
})

// ── Control endpoints ─────────────────────────────────────────────────────────

app.post('/squeezr/control/stop', (c) => {
  // Respond first, then exit gracefully after a tick
  setTimeout(() => process.emit('SIGTERM' as any), 200)
  return c.json({ ok: true, message: 'Squeezr proxy shutting down…' })
})

app.post('/squeezr/config', async (c) => {
  const body = await c.req.json<{ mode?: string }>()
  if (body.mode && ['soft','normal','aggressive','critical'].includes(body.mode)) {
    applyMode(body.mode as 'soft' | 'normal' | 'aggressive' | 'critical')
  }
  return c.json({ ok: true, mode: runtimeOverrides.mode })
})

// ── Bypass mode (runtime-only compression toggle) ────────────────────────────

app.get('/squeezr/bypass', (c) => {
  return c.json({ bypassed: isBypassed() })
})

app.post('/squeezr/bypass', async (c) => {
  try {
    const body = await c.req.json<{ enabled?: boolean }>().catch(() => ({} as { enabled?: boolean }))
    if (typeof body.enabled === 'boolean') {
      setBypassed(body.enabled)
    } else {
      toggleBypassed()
    }
  } catch {
    toggleBypassed()
  }
  return c.json({ bypassed: isBypassed() })
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
