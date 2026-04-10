import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Squeezr Limits — real-time rate limit tracking per AI CLI
 *
 * Data sources:
 *  - Anthropic: `anthropic-ratelimit-*` headers on EVERY response ✅
 *  - OpenAI:    `x-ratelimit-*` headers on EVERY response ✅
 *               `/v1/dashboard/billing/subscription` + `/v1/dashboard/billing/credit_grants` (polled every 5 min)
 *  - Gemini:    only available on 429 error responses ⚠️
 *
 * Token usage is accumulated from:
 *  - Non-streaming: response body `usage` field
 *  - Streaming: parsed SSE events (`message_start`, `message_delta` for Anthropic;
 *               final usage chunk for OpenAI when stream_options.include_usage is set)
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RateLimitState {
  requestsLimit: number
  requestsRemaining: number
  requestsResetEpoch: number     // epoch ms
  tokensLimit: number
  tokensRemaining: number
  tokensResetEpoch: number       // epoch ms
  inputTokensLimit: number
  inputTokensRemaining: number
  outputTokensLimit: number
  outputTokensRemaining: number
  lastUpdated: number            // epoch ms
  hasData: boolean
}

export interface UsageState {
  inputSession: number
  outputSession: number
  inputToday: number
  outputToday: number
  requestsSession: number
  dateKey: string                // YYYY-MM-DD
}

export interface OpenAIBillingState {
  creditBalanceUsd: number
  hardLimitUsd: number
  softLimitUsd: number
  lastFetched: number
}

export interface OpenAISessionWindow {
  usedPercent: number
  resetsAt: number
  windowDurationMins: number
}

export interface OpenAISessionCredits {
  balance: string
  hasCredits: boolean
  unlimited: boolean
}

export interface OpenAISessionRateLimitState {
  limitId: string
  limitName: string
  planType: string
  primary: OpenAISessionWindow | null
  secondary: OpenAISessionWindow | null
  credits: OpenAISessionCredits | null
  lastFetched: number
  hasData: boolean
}

export interface GeminiErrorState {
  errorCount429: number
  lastErrorEpoch: number
  hasData: boolean
}

// Subscription (OAuth) uses unified rate limits instead of per-minute token limits
export interface UnifiedRateLimitState {
  fiveHourUtilization: number    // 0-1 fraction of 5h rolling window
  fiveHourResetEpoch: number     // epoch seconds
  fiveHourStatus: string         // 'allowed' | 'throttled' | 'blocked'
  sevenDayUtilization: number    // 0-1 fraction of 7d ceiling
  sevenDayResetEpoch: number     // epoch seconds
  sevenDayStatus: string
  overageUtilization: number
  overageStatus: string
  hasData: boolean
}

// ── State singletons ──────────────────────────────────────────────────────────

function emptyRL(): RateLimitState {
  return {
    requestsLimit: 0, requestsRemaining: 0, requestsResetEpoch: 0,
    tokensLimit: 0, tokensRemaining: 0, tokensResetEpoch: 0,
    inputTokensLimit: 0, inputTokensRemaining: 0,
    outputTokensLimit: 0, outputTokensRemaining: 0,
    lastUpdated: 0, hasData: false,
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function emptyUsage(): UsageState {
  return { inputSession: 0, outputSession: 0, inputToday: 0, outputToday: 0, requestsSession: 0, dateKey: todayKey() }
}

export const anthropicRL = emptyRL()
export const openaiRL    = emptyRL()
export const geminiRL    = emptyRL()

export const anthropicUnified: UnifiedRateLimitState = {
  fiveHourUtilization: 0, fiveHourResetEpoch: 0, fiveHourStatus: '',
  sevenDayUtilization: 0, sevenDayResetEpoch: 0, sevenDayStatus: '',
  overageUtilization: 0, overageStatus: '',
  hasData: false,
}

export const anthropicUsage = emptyUsage()
export const openaiUsage    = emptyUsage()
export const geminiUsage    = emptyUsage()

export const geminiErrors: GeminiErrorState = { errorCount429: 0, lastErrorEpoch: 0, hasData: false }

export const openAIBilling: OpenAIBillingState = {
  creditBalanceUsd: 0, hardLimitUsd: 0, softLimitUsd: 0, lastFetched: 0,
}

export const openAISessionLimits: OpenAISessionRateLimitState = {
  limitId: '',
  limitName: '',
  planType: '',
  primary: null,
  secondary: null,
  credits: null,
  lastFetched: 0,
  hasData: false,
}

// Last API key seen per CLI — used for proactive billing fetches
let lastAnthropicKey = ''
let lastOpenAIKey    = ''

export function storeKey(cli: 'anthropic' | 'openai', key: string): void {
  if (!key) return
  if (cli === 'anthropic') lastAnthropicKey = key
  else lastOpenAIKey = key
}

export function storedKey(cli: 'anthropic' | 'openai'): string {
  return cli === 'anthropic' ? lastAnthropicKey : lastOpenAIKey
}

function normalizeWindow(v: unknown): OpenAISessionWindow | null {
  if (!v || typeof v !== 'object') return null
  const w = v as Record<string, unknown>
  const usedPercent = Number(w.usedPercent)
  if (!Number.isFinite(usedPercent)) return null
  return {
    usedPercent: Math.max(0, Math.min(100, Math.round(usedPercent))),
    resetsAt: Number(w.resetsAt) || 0,
    windowDurationMins: Number(w.windowDurationMins) || 0,
  }
}

function normalizeCredits(v: unknown): OpenAISessionCredits | null {
  if (!v || typeof v !== 'object') return null
  const c = v as Record<string, unknown>
  return {
    balance: String(c.balance ?? ''),
    hasCredits: Boolean(c.hasCredits),
    unlimited: Boolean(c.unlimited),
  }
}

function applyOpenAISessionSnapshot(v: unknown): void {
  if (!v || typeof v !== 'object') return
  const snap = v as Record<string, unknown>
  openAISessionLimits.limitId = String(snap.limitId ?? '')
  openAISessionLimits.limitName = String(snap.limitName ?? '')
  openAISessionLimits.planType = String(snap.planType ?? '')
  openAISessionLimits.primary = normalizeWindow(snap.primary)
  openAISessionLimits.secondary = normalizeWindow(snap.secondary)
  openAISessionLimits.credits = normalizeCredits(snap.credits)
  openAISessionLimits.lastFetched = Date.now()
  openAISessionLimits.hasData = Boolean(openAISessionLimits.primary || openAISessionLimits.secondary)
}

// ── Header parsers ────────────────────────────────────────────────────────────

/** Parses RFC 3339 timestamp from Anthropic reset headers → epoch ms */
function parseIsoReset(v: string | null): number {
  if (!v) return 0
  try { return new Date(v).getTime() } catch { return 0 }
}

/** Parses relative reset like "1s", "6m0s", "120ms" from OpenAI → epoch ms */
function parseRelativeReset(v: string | null): number {
  if (!v) return 0
  let ms = 0
  const msMatch = v.match(/^(\d+)ms$/)
  if (msMatch) return Date.now() + parseInt(msMatch[1])
  const h = v.match(/(\d+)h/);  if (h) ms += parseInt(h[1]) * 3_600_000
  const m = v.match(/(\d+)m/);  if (m) ms += parseInt(m[1]) * 60_000
  const s = v.match(/(\d+(?:\.\d+)?)s/); if (s) ms += parseFloat(s[1]) * 1_000
  return ms > 0 ? Date.now() + ms : 0
}

function h(headers: Headers, name: string): number {
  return parseInt(headers.get(name) ?? '0') || 0
}

// ── Rate limit update from headers ────────────────────────────────────────────

export function updateAnthropicFromHeaders(headers: Headers): void {
  // Subscription (OAuth) sends unified rate limits instead of per-minute limits
  const unified5hUtil = headers.get('anthropic-ratelimit-unified-5h-utilization')
  if (unified5hUtil !== null) {
    anthropicUnified.fiveHourUtilization = parseFloat(unified5hUtil) || 0
    anthropicUnified.fiveHourResetEpoch = parseInt(headers.get('anthropic-ratelimit-unified-5h-reset') ?? '0') * 1000
    anthropicUnified.fiveHourStatus = headers.get('anthropic-ratelimit-unified-5h-status') ?? ''
    anthropicUnified.sevenDayUtilization = parseFloat(headers.get('anthropic-ratelimit-unified-7d-utilization') ?? '0') || 0
    anthropicUnified.sevenDayResetEpoch = parseInt(headers.get('anthropic-ratelimit-unified-7d-reset') ?? '0') * 1000
    anthropicUnified.sevenDayStatus = headers.get('anthropic-ratelimit-unified-7d-status') ?? ''
    anthropicUnified.overageUtilization = parseFloat(headers.get('anthropic-ratelimit-unified-overage-utilization') ?? '0') || 0
    anthropicUnified.overageStatus = headers.get('anthropic-ratelimit-unified-overage-status') ?? ''
    anthropicUnified.hasData = true
  }

  // API key users get standard per-minute rate limits
  if (!headers.get('anthropic-ratelimit-requests-limit') &&
      !headers.get('anthropic-ratelimit-tokens-limit')) return

  anthropicRL.requestsLimit        = h(headers, 'anthropic-ratelimit-requests-limit')        || anthropicRL.requestsLimit
  anthropicRL.requestsRemaining    = h(headers, 'anthropic-ratelimit-requests-remaining')
  anthropicRL.requestsResetEpoch   = parseIsoReset(headers.get('anthropic-ratelimit-requests-reset'))
  anthropicRL.tokensLimit          = h(headers, 'anthropic-ratelimit-tokens-limit')          || anthropicRL.tokensLimit
  anthropicRL.tokensRemaining      = h(headers, 'anthropic-ratelimit-tokens-remaining')
  anthropicRL.tokensResetEpoch     = parseIsoReset(headers.get('anthropic-ratelimit-tokens-reset'))
  anthropicRL.inputTokensLimit     = h(headers, 'anthropic-ratelimit-input-tokens-limit')    || anthropicRL.inputTokensLimit
  anthropicRL.inputTokensRemaining = h(headers, 'anthropic-ratelimit-input-tokens-remaining')
  anthropicRL.outputTokensLimit    = h(headers, 'anthropic-ratelimit-output-tokens-limit')   || anthropicRL.outputTokensLimit
  anthropicRL.outputTokensRemaining= h(headers, 'anthropic-ratelimit-output-tokens-remaining')
  anthropicRL.lastUpdated          = Date.now()
  anthropicRL.hasData              = true
}

export function updateOpenAIFromHeaders(headers: Headers): void {
  if (!headers.get('x-ratelimit-limit-requests') &&
      !headers.get('x-ratelimit-limit-tokens')) return

  openaiRL.requestsLimit      = h(headers, 'x-ratelimit-limit-requests')     || openaiRL.requestsLimit
  openaiRL.requestsRemaining  = h(headers, 'x-ratelimit-remaining-requests')
  openaiRL.requestsResetEpoch = parseRelativeReset(headers.get('x-ratelimit-reset-requests'))
  openaiRL.tokensLimit        = h(headers, 'x-ratelimit-limit-tokens')        || openaiRL.tokensLimit
  openaiRL.tokensRemaining    = h(headers, 'x-ratelimit-remaining-tokens')
  openaiRL.tokensResetEpoch   = parseRelativeReset(headers.get('x-ratelimit-reset-tokens'))
  openaiRL.lastUpdated        = Date.now()
  openaiRL.hasData            = true
}

export function updateGeminiFrom429(headers: Headers): void {
  const lim = headers.get('x-ratelimit-limit') ?? headers.get('ratelimit-limit')
  if (lim) geminiRL.tokensLimit = parseInt(lim) || geminiRL.tokensLimit
  geminiErrors.errorCount429++
  geminiErrors.lastErrorEpoch = Date.now()
  geminiErrors.hasData = true
}

// ── Usage accumulation ────────────────────────────────────────────────────────

function rolloverIfNeeded(u: UsageState): void {
  const today = todayKey()
  if (u.dateKey !== today) {
    u.inputToday = 0
    u.outputToday = 0
    u.dateKey = today
  }
}

export function addAnthropicUsage(input: number, output: number): void {
  rolloverIfNeeded(anthropicUsage)
  anthropicUsage.inputSession   += input
  anthropicUsage.outputSession  += output
  anthropicUsage.inputToday     += input
  anthropicUsage.outputToday    += output
  // Only count as new request when input tokens arrive (message_start),
  // not on output (message_delta) — avoids double-counting in streaming.
  if (input > 0) anthropicUsage.requestsSession++
}

export function addOpenAIUsage(input: number, output: number): void {
  rolloverIfNeeded(openaiUsage)
  openaiUsage.inputSession   += input
  openaiUsage.outputSession  += output
  openaiUsage.inputToday     += input
  openaiUsage.outputToday    += output
  // OpenAI sends usage in a single final chunk with both fields, so input > 0 is reliable
  if (input > 0) openaiUsage.requestsSession++
}

export function addGeminiUsage(input: number, output: number): void {
  rolloverIfNeeded(geminiUsage)
  geminiUsage.inputSession   += input
  geminiUsage.outputSession  += output
  geminiUsage.inputToday     += input
  geminiUsage.outputToday    += output
  if (input > 0 || output > 0) geminiUsage.requestsSession++
}

// ── SSE stream parser factory ────────────────────────────────────────────────
// Returns a function you feed decoded SSE text chunks to — calls onUsage
// when it finds usage data in Anthropic or OpenAI event payloads.

export function makeSseUsageParser(
  cli: 'anthropic' | 'openai',
  onUsage: (input: number, output: number) => void,
): (chunk: string) => void {
  let buf = ''
  return function feed(chunk: string) {
    buf += chunk
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') continue
      try {
        const ev = JSON.parse(raw)
        if (cli === 'anthropic') {
          // message_start carries input_tokens in its usage field
          if (ev.type === 'message_start' && ev.message?.usage) {
            onUsage(ev.message.usage.input_tokens ?? 0, 0)
          }
          // message_delta carries cumulative output_tokens
          if (ev.type === 'message_delta' && ev.usage) {
            onUsage(0, ev.usage.output_tokens ?? 0)
          }
        } else {
          // OpenAI: final chunk with stream_options.include_usage has usage field
          if (ev.usage?.prompt_tokens != null) {
            onUsage(ev.usage.prompt_tokens, ev.usage.completion_tokens ?? 0)
          }
        }
      } catch { /* malformed line, ignore */ }
    }
  }
}

// ── OpenAI billing fetch ──────────────────────────────────────────────────────
// Fetches subscription + credit data from OpenAI billing API.
// Only runs if a valid API key is available and not fetched in the last 5 min.

export async function maybeRefreshOpenAIBilling(apiKey: string): Promise<void> {
  if (!apiKey || !apiKey.startsWith('sk-') || apiKey.startsWith('sk-ant')) return
  if (Date.now() - openAIBilling.lastFetched < 5 * 60_000) return

  try {
    const [subResp, creditResp] = await Promise.allSettled([
      fetch('https://api.openai.com/v1/dashboard/billing/subscription', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      }),
      fetch('https://api.openai.com/v1/dashboard/billing/credit_grants', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      }),
    ])

    let gotData = false
    if (subResp.status === 'fulfilled' && subResp.value.ok) {
      const sub = await subResp.value.json() as Record<string, unknown>
      openAIBilling.hardLimitUsd = (sub.hard_limit_usd as number) ?? 0
      openAIBilling.softLimitUsd = (sub.soft_limit_usd as number) ?? 0
      gotData = true
    }
    if (creditResp.status === 'fulfilled' && creditResp.value.ok) {
      const cr = await creditResp.value.json() as Record<string, unknown>
      openAIBilling.creditBalanceUsd = (cr.total_available as number) ?? 0
      gotData = true
    }

    // Only update lastFetched if at least one request succeeded, so we retry on failure
    if (gotData) openAIBilling.lastFetched = Date.now()
  } catch { /* ignore network errors */ }
}

// ── Snapshot for API / SSE ────────────────────────────────────────────────────

let openAISessionRefreshInFlight: Promise<void> | null = null

function codexAppServerCommand(): { cmd: string, args: string[] } {
  if (process.platform === 'win32') {
    const cmdShim = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'codex.cmd') : 'codex.cmd'
    const codexCmd = existsSync(cmdShim) ? cmdShim : 'codex.cmd'
    return {
      cmd: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', codexCmd, 'app-server', '--listen', 'stdio://'],
    }
  }
  return { cmd: 'codex', args: ['app-server', '--listen', 'stdio://'] }
}

export async function maybeRefreshOpenAISessionLimits(force = false): Promise<void> {
  if (!force && openAISessionLimits.lastFetched > 0 && Date.now() - openAISessionLimits.lastFetched < 60_000) return
  if (openAISessionRefreshInFlight) return openAISessionRefreshInFlight

  openAISessionRefreshInFlight = new Promise<void>((resolve) => {
    const { cmd, args } = codexAppServerCommand()
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdoutBuf = ''
    let finished = false

    const finish = () => {
      if (finished) return
      finished = true
      try { child.kill() } catch { /* ignore */ }
      openAISessionRefreshInFlight = null
      resolve()
    }

    const timer = setTimeout(finish, 4000)
    const send = (msg: unknown) => {
      try { child.stdin.write(JSON.stringify(msg) + '\n') } catch { finish() }
    }

    child.on('error', finish)
    child.on('exit', () => {
      clearTimeout(timer)
      finish()
    })
    child.stderr.on('data', () => { /* ignore wrapper warnings */ })
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8')
      const lines = stdoutBuf.split(/\r?\n/)
      stdoutBuf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('{')) continue
        try {
          const msg = JSON.parse(trimmed) as { id?: number, result?: Record<string, unknown> }
          if (msg.id === 1) {
            send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: null })
            continue
          }
          if (msg.id === 2 && msg.result) {
            const buckets = msg.result.rateLimitsByLimitId as Record<string, unknown> | undefined
            applyOpenAISessionSnapshot(buckets?.codex ?? msg.result.rateLimits)
            clearTimeout(timer)
            finish()
            return
          }
        } catch { /* ignore malformed lines */ }
      }
    })

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'squeezr', version: '1.0.0' } },
    })
  })

  return openAISessionRefreshInFlight
}

export function limitsSnapshot() {
  return {
    anthropic: { rl: anthropicRL, usage: anthropicUsage, unified: anthropicUnified },
    openai:    { rl: openaiRL,    usage: openaiUsage, billing: openAIBilling, session: openAISessionLimits },
    gemini:    { rl: geminiRL,    usage: geminiUsage, errors: geminiErrors },
  }
}
