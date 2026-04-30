/**
 * Tests that anthropic-ratelimit-* headers from upstream are forwarded back to
 * the client in streaming responses (issue #4).
 *
 * Claude Code reads these headers to populate rate_limits in the statusline JSON.
 * Previously the proxy consumed them internally but never relayed them.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'

// ── Helper: start a minimal mock Anthropic server ─────────────────────────────

const RATE_LIMIT_HEADERS: Record<string, string> = {
  'anthropic-ratelimit-requests-limit': '50',
  'anthropic-ratelimit-requests-remaining': '49',
  'anthropic-ratelimit-requests-reset': '2026-01-01T00:00:00Z',
  'anthropic-ratelimit-tokens-limit': '100000',
  'anthropic-ratelimit-tokens-remaining': '99000',
  'anthropic-ratelimit-tokens-reset': '2026-01-01T00:01:00Z',
}

/** Start an upstream mock that returns rate-limit headers + a minimal SSE stream. */
function startMockAnthropic(): Promise<{ port: number; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/v1/messages' && req.method === 'POST') {
        // Consume request body so the socket doesn't stall
        req.resume()
        req.on('end', () => {
          const headers: Record<string, string> = {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            ...RATE_LIMIT_HEADERS,
          }
          res.writeHead(200, headers)
          // Minimal well-formed SSE stream
          res.write('data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-opus-4-5","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n')
          res.write('data: {"type":"message_stop"}\n\n')
          res.end()
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as { port: number }).port, server })
    })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('rate-limit header forwarding (issue #4)', () => {
  const servers: Server[] = []

  afterEach(async () => {
    while (servers.length) {
      const s = servers.pop()!
      await new Promise<void>((r) => s.close(() => r()))
    }
    vi.unstubAllEnvs()
  })

  it('forwards anthropic-ratelimit-* headers on streaming /v1/messages responses', async () => {
    const { port: upstreamPort, server: upstream } = await startMockAnthropic()
    servers.push(upstream)

    // Dynamically import server after env is set so ANTHROPIC_API points at mock.
    // We monkey-patch the module-level constant by intercepting fetch.
    const upstreamBase = `http://127.0.0.1:${upstreamPort}`

    // Stub global fetch to redirect api.anthropic.com calls to our mock
    const realFetch = global.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const redirected = url.replace('https://api.anthropic.com', upstreamBase)
      return realFetch(redirected, init)
    })

    // Import app after stubbing fetch
    const { app } = await import('../server.js')

    const request = new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'sk-ant-test-key',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 100,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

    const response = await app.fetch(request)
    expect(response.status).toBe(200)

    // Consume body so connection closes cleanly
    await response.text()

    // The key assertion: rate-limit headers must be present
    for (const [name, expected] of Object.entries(RATE_LIMIT_HEADERS)) {
      expect(
        response.headers.get(name),
        `Expected header "${name}" to be forwarded`,
      ).toBe(expected)
    }
  })
})
