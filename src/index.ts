import { createAdaptorServer } from '@hono/node-server'
import { app, stats } from './server.js'
import { config } from './config.js'
import { VERSION } from './version.js'
import { startMitmProxy } from './codexMitm.js'
import { loadSessionCache, persistSessionCache } from './sessionCache.js'
import { loadExpandStore, persistExpandStore } from './expand.js'

// Load persisted caches before accepting requests
loadSessionCache()
loadExpandStore()

const PORT = config.port

const httpServer = createAdaptorServer({ fetch: app.fetch })

// Persist caches every 60s so a crash doesn't lose more than a minute of work
setInterval(() => { persistSessionCache(); persistExpandStore() }, 60_000).unref()

httpServer.listen(PORT, () => {
  console.log(`Squeezr v${VERSION} listening on http://localhost:${PORT}`)
  console.log(`Mode: ${config.dryRun ? 'dry-run' : 'active'}`)
  if (config.disabled) console.log('WARNING: compression is disabled')
  console.log(`Backends: Anthropic → Haiku | OpenAI → GPT-4o-mini | Gemini → Flash-8B | Local → ${config.localCompressionModel}`)
  console.log(`Stats: http://localhost:${PORT}/squeezr/stats`)
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
