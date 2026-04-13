import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'

export type PortState =
  | { kind: 'free' }
  | { kind: 'squeezr'; version?: string }
  | { kind: 'foreign'; description?: string }

const HEALTH_PATH = '/squeezr/health'
const PROBE_TIMEOUT_MS = 1500

function tryBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port)
  })
}

function fetchHealth(port: number): Promise<{ ok: boolean; body: string; status: number }> {
  return new Promise((resolve) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: HEALTH_PATH, method: 'GET', timeout: PROBE_TIMEOUT_MS },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => resolve({ ok: true, body: data, status: res.statusCode ?? 0 }))
      },
    )
    req.on('error', () => resolve({ ok: false, body: '', status: 0 }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, body: '', status: 0 }) })
    req.end()
  })
}

/**
 * Determines whether a port is free, occupied by an existing squeezr instance,
 * or occupied by an unrelated foreign service.
 *
 * The 'foreign' branch matters because Node's findFreePort + a hardcoded env
 * var pointing to the foreign port is exactly the bug class that produces
 * cryptic Claude Code errors like `undefined is not an object (evaluating '$.speed')`
 * — Claude routes its API calls into a Docker WordPress (or whatever else owns
 * the port) and chokes on the unexpected response shape.
 */
export async function probePort(port: number): Promise<PortState> {
  const free = await tryBind(port)
  if (free) return { kind: 'free' }

  // Port is bound by something. Ask it whether it's squeezr.
  const res = await fetchHealth(port)
  if (res.ok && res.status === 200) {
    try {
      const json = JSON.parse(res.body) as { identity?: string; version?: string }
      if (json && json.identity === 'squeezr') {
        return { kind: 'squeezr', version: json.version }
      }
      return { kind: 'foreign', description: `HTTP 200 but identity != squeezr (got ${json.identity ?? 'undefined'})` }
    } catch {
      return { kind: 'foreign', description: `HTTP 200 but body is not valid JSON (${res.body.slice(0, 60)}…)` }
    }
  }
  if (res.status >= 300 && res.status < 400) {
    return { kind: 'foreign', description: `HTTP ${res.status} redirect — likely a web server (Apache/nginx/WordPress)` }
  }
  if (res.status >= 400) {
    return { kind: 'foreign', description: `HTTP ${res.status}` }
  }
  return { kind: 'foreign', description: 'TCP bind failed but no HTTP response — non-HTTP service' }
}

export async function findFreePort(start: number, max = 10): Promise<number> {
  for (let i = 0; i < max; i++) {
    const state = await probePort(start + i)
    if (state.kind === 'free') return start + i
  }
  throw new Error(`No free port found in range ${start}–${start + max - 1}`)
}
