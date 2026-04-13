import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { runSelfTest, formatSelfTest } from '../selfTest.js'
import { VERSION } from '../version.js'

const servers: Server[] = []

function startSqueezrLike(opts: {
  identity?: string
  version?: string
  dryRunOk?: boolean
} = {}): Promise<number> {
  const identity = opts.identity ?? 'squeezr'
  const version = opts.version ?? VERSION
  const dryRunOk = opts.dryRunOk ?? true

  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      if (req.url === '/squeezr/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ identity, status: 'ok', version }))
        return
      }
      if (req.url === '/v1/messages' && req.method === 'POST') {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          if (req.headers['x-squeezr-dryrun'] !== '1') {
            res.writeHead(400); res.end('not dry-run')
            return
          }
          if (!dryRunOk) {
            res.writeHead(500); res.end('forced failure')
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            identity: 'squeezr',
            dry_run: true,
            original_chars: body.length,
            compressed_chars: body.length,
            saved_chars: 0,
          }))
        })
        return
      }
      res.writeHead(404); res.end()
    })
    srv.listen(0, '127.0.0.1', () => {
      servers.push(srv)
      resolve((srv.address() as { port: number }).port)
    })
  })
}

beforeEach(() => {
  // Clear env vars that affect the env_coherence check; individual tests opt-in.
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.openai_base_url
  delete process.env.GEMINI_API_BASE_URL
})

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!
    await new Promise<void>((r) => s.close(() => r()))
  }
})

describe('runSelfTest', () => {
  it('passes all checks against a healthy squeezr-like server with matching env vars', async () => {
    const port = await startSqueezrLike()
    process.env.ANTHROPIC_BASE_URL = `http://localhost:${port}`
    process.env.openai_base_url = `http://localhost:${port}`
    process.env.GEMINI_API_BASE_URL = `http://localhost:${port}`

    const result = await runSelfTest({ port, offline: true })
    const byName = Object.fromEntries(result.checks.map(c => [c.name, c]))
    expect(byName.loopback_health.status).toBe('pass')
    expect(byName.env_coherence.status).toBe('pass')
    expect(byName.upstream_reachable.status).toBe('skip')
    expect(byName.pipeline_dryrun.status).toBe('pass')
    expect(result.status).toBe('ok')
  })

  it('marks env_coherence as warn when env vars point to the wrong port', async () => {
    const port = await startSqueezrLike()
    process.env.ANTHROPIC_BASE_URL = 'http://localhost:9999' // wrong on purpose
    process.env.openai_base_url = `http://localhost:${port}`
    process.env.GEMINI_API_BASE_URL = `http://localhost:${port}`

    const result = await runSelfTest({ port, offline: true })
    const env = result.checks.find(c => c.name === 'env_coherence')!
    expect(env.status).toBe('warn')
    expect(env.hint).toContain(`http://localhost:${port}`)
    expect(result.status).toBe('warn')
  })

  it('marks loopback_health as fail when identity is missing (foreign service squatting)', async () => {
    const port = await startSqueezrLike({ identity: 'wordpress' })
    process.env.ANTHROPIC_BASE_URL = `http://localhost:${port}`
    process.env.openai_base_url = `http://localhost:${port}`
    process.env.GEMINI_API_BASE_URL = `http://localhost:${port}`

    const result = await runSelfTest({ port, offline: true })
    const health = result.checks.find(c => c.name === 'loopback_health')!
    expect(health.status).toBe('fail')
    expect(result.status).toBe('fail')
  })

  it('marks loopback_health as warn when version drifts', async () => {
    const port = await startSqueezrLike({ version: '0.0.1-stale' })
    process.env.ANTHROPIC_BASE_URL = `http://localhost:${port}`
    process.env.openai_base_url = `http://localhost:${port}`
    process.env.GEMINI_API_BASE_URL = `http://localhost:${port}`

    const result = await runSelfTest({ port, offline: true })
    const health = result.checks.find(c => c.name === 'loopback_health')!
    expect(health.status).toBe('warn')
  })

  it('marks pipeline_dryrun as fail when the request path is broken', async () => {
    const port = await startSqueezrLike({ dryRunOk: false })
    process.env.ANTHROPIC_BASE_URL = `http://localhost:${port}`
    process.env.openai_base_url = `http://localhost:${port}`
    process.env.GEMINI_API_BASE_URL = `http://localhost:${port}`

    const result = await runSelfTest({ port, offline: true })
    const pipe = result.checks.find(c => c.name === 'pipeline_dryrun')!
    expect(pipe.status).toBe('fail')
  })
})

describe('formatSelfTest', () => {
  it('renders pass / warn / fail icons and hints', () => {
    const out = formatSelfTest({
      status: 'warn',
      port: 8080,
      version: '1.22.0',
      ranAt: '2026-04-14T00:00:00Z',
      checks: [
        { name: 'loopback_health', status: 'pass', message: 'OK' },
        { name: 'env_coherence', status: 'warn', message: 'mismatched', hint: 'export ANTHROPIC_BASE_URL=...' },
      ],
    })
    expect(out).toContain('warnings')
    expect(out).toContain('✓ loopback_health')
    expect(out).toContain('⚠ env_coherence')
    expect(out).toContain('export ANTHROPIC_BASE_URL=')
  })
})
