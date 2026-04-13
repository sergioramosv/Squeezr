import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { probePort, findFreePort } from '../probePort.js'

const servers: Server[] = []

function startServer(handler: (req: any, res: any) => void): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer(handler)
    srv.listen(0, '127.0.0.1', () => {
      servers.push(srv)
      resolve((srv.address() as { port: number }).port)
    })
  })
}

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!
    await new Promise<void>((r) => s.close(() => r()))
  }
})

describe('probePort', () => {
  it('returns "free" when nothing is listening on the port', async () => {
    // Pick a high port that is almost certainly free.
    const port = 49000 + Math.floor(Math.random() * 1000)
    const result = await probePort(port)
    expect(result.kind).toBe('free')
  })

  it('returns "squeezr" when the port is owned by an instance with valid identity', async () => {
    const port = await startServer((req, res) => {
      if (req.url === '/squeezr/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ identity: 'squeezr', status: 'ok', version: '1.22.0' }))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    const result = await probePort(port)
    expect(result.kind).toBe('squeezr')
    if (result.kind === 'squeezr') {
      expect(result.version).toBe('1.22.0')
    }
  })

  it('returns "foreign" when the port answers HTTP 200 but identity is missing', async () => {
    // Simulates WordPress / Apache returning 200 on /squeezr/health (e.g. a
    // catch-all redirect or default vhost).
    const port = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>WordPress</body></html>')
    })
    const result = await probePort(port)
    expect(result.kind).toBe('foreign')
  })

  it('returns "foreign" when the port replies with a 301 redirect', async () => {
    // The exact failure mode that triggered the original bug — Apache redirecting
    // /squeezr/health → /squeezr/health/ — was being mistaken for a healthy
    // squeezr by `curl -sf`.
    const port = await startServer((_req, res) => {
      res.writeHead(301, { location: '/somewhere/' })
      res.end()
    })
    const result = await probePort(port)
    expect(result.kind).toBe('foreign')
    if (result.kind === 'foreign') {
      expect(result.description).toMatch(/301/)
    }
  })

  it('returns "foreign" when the port replies with HTTP 200 but identity != squeezr', async () => {
    const port = await startServer((req, res) => {
      if (req.url === '/squeezr/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ identity: 'something-else', status: 'ok' }))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    const result = await probePort(port)
    expect(result.kind).toBe('foreign')
  })
})

describe('findFreePort', () => {
  it('returns the configured port when it is free', async () => {
    // Bind a server to occupy a known port, then ask for the next port range.
    const occupied = await startServer((_req, res) => { res.writeHead(200); res.end() })
    const free = await findFreePort(occupied + 1, 5)
    expect(free).toBeGreaterThanOrEqual(occupied + 1)
    expect(free).toBeLessThan(occupied + 6)
  })

  it('skips occupied ports and finds the next free one', async () => {
    const occupied = await startServer((_req, res) => { res.writeHead(200); res.end() })
    const free = await findFreePort(occupied, 5)
    // Should NOT return the occupied port.
    expect(free).not.toBe(occupied)
  })
})
