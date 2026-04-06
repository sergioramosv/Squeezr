import { createAdaptorServer } from '@hono/node-server'
import { createServer } from 'node:net'
import { app, stats } from './server.js'
import { config } from './config.js'
import { VERSION } from './version.js'
import { startMitmProxy } from './codexMitm.js'
import { loadSessionCache, persistSessionCache } from './sessionCache.js'
import { loadExpandStore, persistExpandStore } from './expand.js'

// Load persisted caches before accepting requests
loadSessionCache()
loadExpandStore()

// ── Port conflict detection ───────────────────────────────────────────────────
// Instead of crashing with EADDRINUSE, find the next available port automatically.

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port)
  })
}

async function findFreePort(start: number, max = 10): Promise<number> {
  for (let i = 0; i < max; i++) {
    if (await isPortFree(start + i)) return start + i
  }
  throw new Error(`No free port found in range ${start}–${start + max - 1}`)
}

const PORT = await findFreePort(config.port)
if (PORT !== config.port) {
  console.warn(`\n⚠️  Port ${config.port} is already in use. Using port ${PORT} instead.`)
  console.warn(`   Update squeezr.toml or run: squeezr ports\n`)
}

const httpServer = createAdaptorServer({ fetch: app.fetch })

// Persist caches every 60s so a crash doesn't lose more than a minute of work
setInterval(() => { persistSessionCache(); persistExpandStore() }, 60_000).unref()

httpServer.listen(PORT, () => {
  console.log(`Squeezr v${VERSION} listening on http://localhost:${PORT}`)
  console.log(`Mode: ${config.dryRun ? 'dry-run' : 'active'}`)
  if (config.disabled) console.log('WARNING: compression is disabled')
  console.log(`Backends: Anthropic → Haiku | OpenAI → GPT-4o-mini | Gemini → Flash-8B | Local → ${config.localCompressionModel}`)
  console.log(`Dashboard: http://localhost:${PORT}/squeezr/dashboard`)
})

// Start MITM proxy for Codex OAuth (chatgpt.com/backend-api)
startMitmProxy()

const isDaemon = !!process.env.SQUEEZR_DAEMON

function persistAndExit(code = 0): void {
  persistSessionCache()
  persistExpandStore()
  process.exit(code)
}

if (isDaemon) {
  process.on('SIGINT', () => { persistAndExit(0) })
  process.on('SIGHUP', () => { persistAndExit(0) })
} else {
  process.on('SIGINT', () => {
    const s = stats.summary()
    console.log(`\n[squeezr] Session summary: ${s.requests} requests | -${s.total_saved_chars.toLocaleString()} chars (~${s.total_saved_tokens.toLocaleString()} tokens, ${s.savings_pct}% saved)`)
    persistAndExit(0)
  })
}

process.on('SIGTERM', () => { persistAndExit(0) })
