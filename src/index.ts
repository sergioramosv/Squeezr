import { createAdaptorServer } from '@hono/node-server'
import { app, stats, setLastSelfTest } from './server.js'
import { config } from './config.js'
import { VERSION } from './version.js'
import { startMitmProxy } from './codexMitm.js'
import { loadSessionCache, persistSessionCache } from './sessionCache.js'
import { loadExpandStore, persistExpandStore } from './expand.js'
import { loadHistory, persistHistory } from './history.js'
import { probePort, findFreePort } from './probePort.js'
import { runSelfTest, formatSelfTest } from './selfTest.js'
import { writeRuntimeInfo, clearRuntimeInfo } from './runtimeInfo.js'

// Load persisted caches before accepting requests
loadSessionCache()
loadExpandStore()
loadHistory()

// ── Port conflict detection ───────────────────────────────────────────────────
// Instead of crashing with EADDRINUSE, find the next available port automatically.
// Crucially, before drifting we identify *what* is occupying the configured port
// — a stale squeezr instance is fine to coexist with, but a foreign HTTP service
// (e.g. a Docker container squatting on 8080) is the source of cryptic errors
// like `undefined is not an object (evaluating '$.speed')` in Claude Code, so
// we surface it loudly.

const initialState = await probePort(config.port)
if (initialState.kind === 'squeezr') {
  console.error(
    `Squeezr v${initialState.version ?? '?'} is already running on port ${config.port}. ` +
    `Use \`squeezr stop\` first if you want to restart.`,
  )
  process.exit(0)
}
if (initialState.kind === 'foreign') {
  console.warn(
    `\n⚠️  Port ${config.port} is occupied by a foreign service (${initialState.description ?? 'unknown'}).\n` +
    `   Squeezr will pick a different port, but your shell env vars likely still point to ${config.port}.\n` +
    `   Run \`squeezr setup\` after startup to refresh them, or stop the offending service.\n`,
  )
}

const PORT = await findFreePort(config.port)
if (PORT !== config.port) {
  console.warn(`\n⚠️  Port ${config.port} is in use. Squeezr will listen on ${PORT} instead.`)
  console.warn(`   Update squeezr.toml or run: squeezr ports\n`)
}

const httpServer = createAdaptorServer({ fetch: app.fetch })

// Persist caches every 60s so a crash doesn't lose more than a minute of work
setInterval(() => { persistSessionCache(); persistExpandStore(); persistHistory() }, 60_000).unref()

httpServer.listen(PORT, () => {
  console.log(`Squeezr v${VERSION} listening on http://localhost:${PORT}`)
  console.log(`Mode: ${config.dryRun ? 'dry-run' : 'active'}`)
  if (config.disabled) console.log('WARNING: compression is disabled')
  console.log(`Backends: Anthropic → Haiku | OpenAI → GPT-4o-mini | Gemini → Flash-8B | Local → ${config.localCompressionModel}`)
  console.log(`Dashboard: http://localhost:${PORT}/squeezr/dashboard`)

  // Persist runtime info so external tools (shell wrapper, auto-heal) can
  // discover where we actually ended up bound, regardless of squeezr.toml.
  const mitmPort = Number(process.env.SQUEEZR_MITM_PORT) || (PORT + 1)
  writeRuntimeInfo({ pid: process.pid, port: PORT, mitmPort })

  // Run self-test asynchronously — never block accepting requests on it. The
  // test exercises loopback health, env-var coherence, upstream reachability
  // and the full compression pipeline (dry-run, no quota cost).
  void runSelfTest({ port: PORT }).then((result) => {
    setLastSelfTest(result)
    const formatted = formatSelfTest(result)
    if (result.status === 'fail') {
      console.error('\n' + formatted + '\n')
    } else if (result.status === 'warn') {
      console.warn('\n' + formatted + '\n')
    } else {
      console.log('\n' + formatted + '\n')
    }
  }).catch((err: Error) => {
    console.error(`[squeezr] self-test crashed: ${err.message}`)
  })
})

// Start MITM proxy for Codex OAuth (chatgpt.com/backend-api)
startMitmProxy()

const isDaemon = !!process.env.SQUEEZR_DAEMON

function persistAndExit(code = 0): void {
  persistSessionCache()
  persistExpandStore()
  persistHistory()
  clearRuntimeInfo()
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
