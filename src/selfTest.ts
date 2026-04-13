import { request as httpRequest } from 'node:http'
import { connect as tlsConnect } from 'node:tls'
import { VERSION } from './version.js'

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface SelfTestCheck {
  name: string
  status: CheckStatus
  message: string
  hint?: string
}

export interface SelfTestResult {
  status: 'ok' | 'warn' | 'fail'
  port: number
  version: string
  checks: SelfTestCheck[]
  ranAt: string
}

interface RunOptions {
  port: number
  /** When true, skip checks that require network egress (DNS / TLS to upstream). */
  offline?: boolean
}

const HEALTH_TIMEOUT_MS = 2000
const DRYRUN_TIMEOUT_MS = 5000
const TLS_TIMEOUT_MS = 3000

const ANTHROPIC_HOST = 'api.anthropic.com'

function httpJson(
  port: number,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: init.method ?? 'GET',
        headers: init.headers,
        timeout: init.timeoutMs ?? HEALTH_TIMEOUT_MS,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    if (init.body) req.write(init.body)
    req.end()
  })
}

// ── Check A: loopback health ────────────────────────────────────────────────
async function checkLoopbackHealth(port: number): Promise<SelfTestCheck> {
  try {
    const res = await httpJson(port, '/squeezr/health')
    if (res.status !== 200) {
      return {
        name: 'loopback_health',
        status: 'fail',
        message: `Health endpoint returned HTTP ${res.status}`,
        hint: 'Something is bound to this port but it is not squeezr. Check `lsof -i :' + port + '`.',
      }
    }
    const json = JSON.parse(res.body) as { identity?: string; version?: string }
    if (json.identity !== 'squeezr') {
      return {
        name: 'loopback_health',
        status: 'fail',
        message: `Health endpoint replied 200 but identity != "squeezr" (got ${JSON.stringify(json.identity)})`,
        hint: 'Another HTTP service is squatting on this port. Stop it or change squeezr.toml port.',
      }
    }
    if (json.version !== VERSION) {
      return {
        name: 'loopback_health',
        status: 'warn',
        message: `Stale squeezr instance: running v${json.version}, expected v${VERSION}`,
        hint: 'Run `squeezr stop && squeezr start` to refresh.',
      }
    }
    return { name: 'loopback_health', status: 'pass', message: `OK (v${VERSION})` }
  } catch (err) {
    return {
      name: 'loopback_health',
      status: 'fail',
      message: `Could not reach loopback health endpoint: ${(err as Error).message}`,
    }
  }
}

// ── Check B: env var coherence ──────────────────────────────────────────────
const ENV_KEYS = ['ANTHROPIC_BASE_URL', 'openai_base_url', 'GEMINI_API_BASE_URL'] as const

function checkEnvCoherence(port: number): SelfTestCheck {
  const expected = `http://localhost:${port}`
  const expectedAlt = `http://127.0.0.1:${port}`
  const mismatched: Array<{ key: string; value: string }> = []
  const missing: string[] = []
  for (const key of ENV_KEYS) {
    const value = process.env[key]
    if (!value) { missing.push(key); continue }
    const trimmed = value.replace(/\/+$/, '')
    if (trimmed !== expected && trimmed !== expectedAlt) {
      mismatched.push({ key, value })
    }
  }
  if (mismatched.length === 0 && missing.length === 0) {
    return { name: 'env_coherence', status: 'pass', message: `All env vars point to ${expected}` }
  }
  if (mismatched.length > 0) {
    const lines = mismatched.map(m => `  - ${m.key}=${m.value}  (expected ${expected})`).join('\n')
    return {
      name: 'env_coherence',
      status: 'warn',
      message: `Env vars do not match the bound port:\n${lines}`,
      hint: `Update your shell profile and reopen the terminal:\n${ENV_KEYS.map(k => `  export ${k}=${expected}`).join('\n')}`,
    }
  }
  return {
    name: 'env_coherence',
    status: 'warn',
    message: `Some clients have no base URL set: ${missing.join(', ')}`,
    hint: `Run \`squeezr setup\` or add to your shell profile:\n${missing.map(k => `  export ${k}=${expected}`).join('\n')}`,
  }
}

// ── Check C: upstream reachability (DNS + TLS handshake, no payload) ────────
function checkUpstreamReachable(): Promise<SelfTestCheck> {
  return new Promise((resolve) => {
    const socket = tlsConnect(
      { host: ANTHROPIC_HOST, port: 443, servername: ANTHROPIC_HOST, timeout: TLS_TIMEOUT_MS },
      () => {
        socket.end()
        resolve({ name: 'upstream_reachable', status: 'pass', message: `TLS handshake to ${ANTHROPIC_HOST} OK` })
      },
    )
    socket.on('error', (err) => {
      resolve({
        name: 'upstream_reachable',
        status: 'warn',
        message: `Cannot reach ${ANTHROPIC_HOST}: ${err.message}`,
        hint: 'Check your network / proxy / firewall. Squeezr will still start but cannot proxy requests until upstream is reachable.',
      })
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve({
        name: 'upstream_reachable',
        status: 'warn',
        message: `TLS handshake to ${ANTHROPIC_HOST} timed out after ${TLS_TIMEOUT_MS}ms`,
      })
    })
  })
}

// ── Check D: compression pipeline dry-run ───────────────────────────────────
async function checkPipelineDryRun(port: number): Promise<SelfTestCheck> {
  // Minimal Anthropic-format payload. The dry-run header makes the server
  // exercise compression but skip the upstream forward, so this consumes zero
  // API quota and works without an API key.
  const payload = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'self-test ping' }],
      },
    ],
  })
  try {
    const res = await httpJson(port, '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-squeezr-dryrun': '1',
        'x-api-key': 'self-test-no-key',
      },
      body: payload,
      timeoutMs: DRYRUN_TIMEOUT_MS,
    })
    if (res.status !== 200) {
      return {
        name: 'pipeline_dryrun',
        status: 'fail',
        message: `Dry-run pipeline returned HTTP ${res.status}: ${res.body.slice(0, 120)}`,
      }
    }
    const json = JSON.parse(res.body) as { identity?: string; dry_run?: boolean }
    if (json.identity !== 'squeezr' || json.dry_run !== true) {
      return {
        name: 'pipeline_dryrun',
        status: 'fail',
        message: `Dry-run pipeline returned unexpected payload: ${res.body.slice(0, 120)}`,
      }
    }
    return { name: 'pipeline_dryrun', status: 'pass', message: 'Compression pipeline reachable end-to-end' }
  } catch (err) {
    return {
      name: 'pipeline_dryrun',
      status: 'fail',
      message: `Dry-run pipeline failed: ${(err as Error).message}`,
    }
  }
}

export async function runSelfTest(opts: RunOptions): Promise<SelfTestResult> {
  const port = opts.port
  const checks: SelfTestCheck[] = []

  checks.push(await checkLoopbackHealth(port))
  checks.push(checkEnvCoherence(port))
  if (opts.offline) {
    checks.push({ name: 'upstream_reachable', status: 'skip', message: 'skipped (offline mode)' })
  } else {
    checks.push(await checkUpstreamReachable())
  }
  checks.push(await checkPipelineDryRun(port))

  const hasFail = checks.some(c => c.status === 'fail')
  const hasWarn = checks.some(c => c.status === 'warn')
  const status: SelfTestResult['status'] = hasFail ? 'fail' : hasWarn ? 'warn' : 'ok'

  return {
    status,
    port,
    version: VERSION,
    checks,
    ranAt: new Date().toISOString(),
  }
}

const ICONS: Record<CheckStatus, string> = {
  pass: '✓',
  warn: '⚠',
  fail: '✗',
  skip: '·',
}

export function formatSelfTest(result: SelfTestResult): string {
  const header =
    result.status === 'ok' ? '✓ Self-test passed' :
    result.status === 'warn' ? '⚠ Self-test passed with warnings' :
    '✗ Self-test FAILED'
  const lines = [header, '']
  for (const c of result.checks) {
    lines.push(`  ${ICONS[c.status]} ${c.name}: ${c.message}`)
    if (c.hint && c.status !== 'pass') {
      for (const hintLine of c.hint.split('\n')) {
        lines.push(`      ${hintLine}`)
      }
    }
  }
  return lines.join('\n')
}
