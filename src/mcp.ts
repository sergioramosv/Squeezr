#!/usr/bin/env node
/**
 * Squeezr MCP Server
 *
 * Gives any MCP-compatible AI CLI (Claude Code, Cursor, Windsurf, Cline…)
 * real-time awareness of Squeezr's state and control over it.
 *
 * Transport: stdio (universal — works with all MCP clients)
 * Queries the Squeezr proxy via HTTP on localhost.
 *
 * Tools exposed:
 *   squeezr_status   — Is proxy running? Port, version, uptime
 *   squeezr_stats    — Token savings, compression %, by-tool breakdown
 *   squeezr_set_mode — Change compression aggressiveness instantly
 *   squeezr_config   — Current thresholds and settings
 *   squeezr_habits   — Detected wasteful patterns this session
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(import.meta.url)

// ── Resolve proxy port from squeezr.toml ─────────────────────────────────────

function getProxyPort(): number {
  try {
    const tomlPath = join(__dirname, '..', 'squeezr.toml')
    if (existsSync(tomlPath)) {
      const toml = readFileSync(tomlPath, 'utf-8')
      const m = toml.match(/^\s*port\s*=\s*(\d+)/m)
      if (m) return parseInt(m[1])
    }
  } catch { /* ignore */ }
  return parseInt(process.env.SQUEEZR_PORT ?? '8080')
}

const BASE_URL = process.env.SQUEEZR_URL ?? `http://localhost:${getProxyPort()}`

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function proxyGet(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    return await res.json() as Record<string, unknown>
  } catch { return null }
}

async function proxyPost(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    return await res.json() as Record<string, unknown>
  } catch { return null }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

// ── MCP Server setup ──────────────────────────────────────────────────────────

const pkg = require('../package.json') as { version: string }

// ── Auto-update check (runs in background, non-blocking) ─────────────────────

let latestVersion: string | null = null
let lastUpdateCheck = 0
const UPDATE_CHECK_INTERVAL = 30 * 60_000 // 30 minutes

async function checkForUpdate(): Promise<string | null> {
  if (Date.now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL && latestVersion !== null) {
    return latestVersion !== pkg.version ? latestVersion : null
  }
  try {
    const res = await fetch('https://registry.npmjs.org/squeezr-ai/latest', {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json() as { version: string }
      latestVersion = data.version
      lastUpdateCheck = Date.now()
      return latestVersion !== pkg.version ? latestVersion : null
    }
  } catch { /* ignore */ }
  lastUpdateCheck = Date.now()
  return null
}

function updateBanner(newVersion: string): string {
  return `\n\n🆕 Squeezr v${newVersion} available (you have v${pkg.version}). Run: squeezr update`
}

const server = new Server(
  { name: 'squeezr', version: pkg.version },
  { capabilities: { tools: {} } },
)

// ── Tool definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'squeezr_status',
      description:
        'Check if the Squeezr proxy is running. Returns version, port, uptime, ' +
        'compression mode, and whether dry-run is active. ' +
        'Call this first to confirm Squeezr is active before querying other tools.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'squeezr_stats',
      description:
        'Get real-time token compression statistics for the current Squeezr session. ' +
        'Returns: tokens saved, chars saved, compression %, total requests, ' +
        'session cache hits, cost saved estimate, and per-tool breakdown. ' +
        'Use this to understand how much context Squeezr is saving right now.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'squeezr_set_mode',
      description:
        'Change Squeezr compression aggressiveness instantly without restarting. ' +
        'Takes effect on the next request. Use "aggressive" or "critical" when ' +
        'approaching context limits. Use "soft" when you need full fidelity on outputs.',
      inputSchema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['soft', 'normal', 'aggressive', 'critical'],
            description:
              'soft: minimal compression, last 10 results kept, no AI compression. ' +
              'normal: default (threshold 800 chars, last 3 kept). ' +
              'aggressive: threshold 200 chars, last 1 kept, AI compression on. ' +
              'critical: threshold 50 chars, everything compressed, max savings.',
          },
        },
        required: ['mode'],
      },
    },
    {
      name: 'squeezr_config',
      description:
        'Get the current Squeezr configuration: active compression mode, ' +
        'threshold values, keepRecent setting, which tools are AI-skipped, ' +
        'and whether AI compression is currently enabled.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'squeezr_habits',
      description:
        'Get a report of detected token-wasteful patterns in the current session. ' +
        'Shows which deterministic patterns fired (duplicate reads, lock files, ' +
        'repeated errors, large outputs) and how many tokens they saved or wasted. ' +
        'Useful for improving how you use Claude to spend fewer tokens.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'squeezr_stop',
      description:
        'Stop the Squeezr proxy gracefully. The proxy will persist its caches and exit. ' +
        'After stopping, tool results will no longer be compressed until you restart with: squeezr start',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'squeezr_check_updates',
      description:
        'Check if a newer version of Squeezr is available on npm. ' +
        'Compares the running version to the latest published release and returns ' +
        'the update command if an update is available.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'squeezr_update',
      description:
        'Update Squeezr to the latest version from npm. ' +
        'Runs: npm install -g squeezr-ai@latest ' +
        'After updating, restart the proxy with: squeezr start',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'squeezr_set_project',
      description:
        'Set or change the current project name for Squeezr tracking. ' +
        'Useful when auto-detection shows the wrong name. ' +
        'Pass project name to set, or null/empty to clear and use auto-detection. ' +
        'The project name appears in the dashboard, history, and gain reports.',
      inputSchema: {
        type: 'object',
        properties: {
          project: {
            type: 'string',
            description: 'Project name to set, or empty string to clear and use auto-detection.',
          },
        },
        required: ['project'],
      },
    },
  ],
}))

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  // Check for updates in background (non-blocking, cached for 30 min)
  const newVer = await checkForUpdate()
  const appendUpdate = (result: { content: Array<{ type: string; text: string }>; isError?: boolean }) => {
    if (newVer && result.content[0]?.type === 'text') {
      result.content[0].text += updateBanner(newVer)
    }
    return result
  }

  // ── squeezr_status ──────────────────────────────────────────────────────────
  if (name === 'squeezr_status') {
    const health = await proxyGet('/squeezr/health')
    const stats = await proxyGet('/squeezr/stats')

    if (!health) {
      return {
        content: [{
          type: 'text',
          text: [
            '❌ Squeezr proxy is NOT running.',
            '',
            `Expected at: ${BASE_URL}`,
            'Start it with: squeezr start',
            '',
            'Without Squeezr, your tool results are sent to the API uncompressed.',
          ].join('\n'),
        }],
        isError: false,
      }
    }

    const uptime = stats ? fmtUptime((stats.uptime_seconds as number) ?? 0) : '?'
    const mode = stats ? (stats.mode as string ?? 'normal') : 'normal'
    const dryRun = stats ? (stats.dry_run as boolean) : false

    return appendUpdate({
      content: [{
        type: 'text',
        text: [
          `✅ Squeezr v${health.version ?? '?'} is running`,
          `   Port    : ${BASE_URL}`,
          `   Uptime  : ${uptime}`,
          `   Mode    : ${mode}${dryRun ? ' (dry-run)' : ''}`,
          `   Dashboard: ${BASE_URL}/squeezr/dashboard`,
        ].join('\n'),
      }],
    })
  }

  // ── squeezr_stats ───────────────────────────────────────────────────────────
  if (name === 'squeezr_stats') {
    const data = await proxyGet('/squeezr/stats')

    if (!data) {
      return {
        content: [{ type: 'text', text: '❌ Squeezr proxy is not running. Start with: squeezr start' }],
        isError: false,
      }
    }

    const savedTokens = (data.total_saved_tokens as number) ?? 0
    const savedChars = (data.total_saved_chars as number) ?? 0
    const pct = (data.savings_pct as number) ?? 0
    const requests = (data.requests as number) ?? 0
    const compressions = (data.compressions as number) ?? 0
    const cacheHits = (data.session_cache_hits as number) ?? 0
    const uptime = fmtUptime((data.uptime_seconds as number) ?? 0)
    const costUsd = (savedTokens / 1_000_000) * 3
    const byTool = (data.by_tool as Record<string, { count: number; saved_tokens: number; avg_pct: number }>) ?? {}
    const sessionCache = (data.session_cache_size as number) ?? 0
    const patternHits = data.pattern_hits as Record<string, number> ?? {}
    const totalPatterns = Object.values(patternHits).reduce((s, v) => s + v, 0)

    const toolLines = Object.entries(byTool)
      .sort((a, b) => b[1].saved_tokens - a[1].saved_tokens)
      .slice(0, 8)
      .map(([tool, t]) => `   ${tool.padEnd(16)} ${fmtNum(t.saved_tokens).padStart(7)} tokens  ${t.avg_pct}% avg  ×${t.count}`)

    return appendUpdate({
      content: [{
        type: 'text',
        text: [
          '📊 Squeezr Session Stats',
          '─'.repeat(40),
          `Tokens saved     : ${fmtNum(savedTokens)} (~${savedChars.toLocaleString()} chars)`,
          `Compression      : ${pct}% of tool results`,
          `Cost saved       : $${costUsd.toFixed(3)} (@ $3/MTok)`,
          `Requests         : ${requests} (${compressions} compressions)`,
          `Session cache    : ${cacheHits} hits (${sessionCache} entries)`,
          `Pattern hits     : ${totalPatterns.toLocaleString()}`,
          `Uptime           : ${uptime}`,
          '',
          toolLines.length > 0 ? 'By tool:\n' + toolLines.join('\n') : 'No tool results compressed yet.',
          '',
          '── Savings Breakdown ──',
          ,
          ,
          ,
          ,
          ,
        ].join('\n'),
      }],
    })
  }

  // ── squeezr_set_mode ────────────────────────────────────────────────────────
  if (name === 'squeezr_set_mode') {
    const parsed = z.object({
      mode: z.enum(['soft', 'normal', 'aggressive', 'critical']),
    }).parse(args)

    const modeInfo: Record<string, string> = {
      soft:       'threshold=3000 chars, last 10 results uncompressed, AI off',
      normal:     'threshold=800 chars, last 3 results uncompressed, AI on new blocks',
      aggressive: 'threshold=200 chars, last 1 result uncompressed, AI on',
      critical:   'threshold=50 chars, all results compressed, maximum savings',
    }

    const result = await proxyPost('/squeezr/config', { mode: parsed.mode })

    if (!result) {
      return {
        content: [{ type: 'text', text: '❌ Squeezr proxy is not running. Start with: squeezr start' }],
        isError: false,
      }
    }

    return {
      content: [{
        type: 'text',
        text: [
          `✅ Compression mode set to: ${parsed.mode}`,
          `   ${modeInfo[parsed.mode]}`,
          '',
          parsed.mode === 'critical'
            ? '⚠️  Critical mode compresses everything aggressively. Switch back to normal when context pressure drops.'
            : parsed.mode === 'aggressive'
            ? '🔥 Aggressive mode active. Use when context is above 70%.'
            : '',
        ].filter(Boolean).join('\n'),
      }],
    }
  }

  // ── squeezr_config ──────────────────────────────────────────────────────────
  if (name === 'squeezr_config') {
    const data = await proxyGet('/squeezr/stats')

    if (!data) {
      return {
        content: [{ type: 'text', text: '❌ Squeezr proxy is not running. Start with: squeezr start' }],
        isError: false,
      }
    }

    const mode = (data.mode as string) ?? 'normal'
    const dryRun = (data.dry_run as boolean) ?? false
    const cacheStats = data.cache as { size: number; hits: number; misses: number; hit_rate_pct: number } | undefined

    return {
      content: [{
        type: 'text',
        text: [
          '⚙️  Squeezr Configuration',
          '─'.repeat(40),
          `Compression mode : ${mode}`,
          `Dry-run          : ${dryRun ? 'yes (no actual compression)' : 'no'}`,
          `LRU cache        : ${cacheStats?.size ?? '?'} entries | ${cacheStats?.hit_rate_pct ?? '?'}% hit rate`,
          `Session cache    : ${(data.session_cache_size as number) ?? '?'} entries`,
          `Expand store     : ${(data.expand_store_size as number) ?? '?'} entries`,
          '',
          'Modes available:',
          '  soft       — minimal, no AI compression',
          '  normal     — default balanced',
          '  aggressive — max useful compression',
          '  critical   — compress everything',
          '',
          `Change with: squeezr_set_mode({ mode: "aggressive" })`,
        ].join('\n'),
      }],
    }
  }

  // ── squeezr_habits ──────────────────────────────────────────────────────────
  if (name === 'squeezr_habits') {
    const data = await proxyGet('/squeezr/stats')

    if (!data) {
      return {
        content: [{ type: 'text', text: '❌ Squeezr proxy is not running. Start with: squeezr start' }],
        isError: false,
      }
    }

    const patternHits = data.pattern_hits as Record<string, number> ?? {}
    const byTool = data.by_tool as Record<string, { count: number; saved_tokens: number; avg_pct: number }> ?? {}

    type Habit = { level: string; msg: string }
    const habits: Habit[] = []

    // Detect lock file reads
    const readTool = byTool['Read'] ?? byTool['read']
    if (readTool && readTool.count > 5) {
      habits.push({
        level: readTool.count > 20 ? '🔴' : '🟡',
        msg: `Read tool called ${readTool.count}× this session. Check for lock file reads or repeated file reads.`,
      })
    }

    // Detect read-dedup pattern hits (same file read multiple times)
    if ((patternHits['readDedup'] ?? 0) > 0) {
      habits.push({
        level: '🟡',
        msg: `${patternHits['readDedup']} duplicate file read(s) detected and collapsed. Consider using @file to pin frequently needed files.`,
      })
    }

    // Detect high bash call count
    const bashTool = byTool['Bash'] ?? byTool['bash']
    if (bashTool && bashTool.count > 30) {
      habits.push({
        level: '🟡',
        msg: `Bash called ${bashTool.count}× — if repeatedly running the same command, consider using --watch mode.`,
      })
    }

    // Detect low compression on Read (code quality concern)
    if (readTool && readTool.avg_pct < 10 && readTool.count > 3) {
      habits.push({
        level: '🟢',
        msg: `Read tool results have ${readTool.avg_pct}% compression (code files protected from AI summarization — this is correct).`,
      })
    }

    // Session cache effectiveness
    const cacheHits = (data.session_cache_hits as number) ?? 0
    const compressions = (data.compressions as number) ?? 0
    if (compressions > 0) {
      const hitRate = Math.round((cacheHits / (cacheHits + compressions)) * 100)
      if (hitRate > 50) {
        habits.push({
          level: '🟢',
          msg: `Session cache ${hitRate}% hit rate — repeated tool results are being reused efficiently.`,
        })
      }
    }

    const totalSaved = (data.total_saved_tokens as number) ?? 0
    const requests = (data.requests as number) ?? 0

    if (habits.length === 0) {
      habits.push({ level: '🟢', msg: 'No significant wasteful patterns detected this session.' })
    }

    return {
      content: [{
        type: 'text',
        text: [
          '🔍 Squeezr Habit Report (current session)',
          '─'.repeat(40),
          `Session: ${requests} requests | ${fmtNum(totalSaved)} tokens saved`,
          '',
          ...habits.map(h => `${h.level} ${h.msg}`),
          '',
          'Tip: use squeezr_set_mode to control compression aggressiveness.',
        ].join('\n'),
      }],
    }
  }

  // ── squeezr_stop ────────────────────────────────────────────────────────────
  if (name === 'squeezr_stop') {
    const result = await proxyPost('/squeezr/control/stop', {})

    if (!result) {
      return {
        content: [{ type: 'text', text: '❌ Squeezr proxy is not running (or already stopped).' }],
        isError: false,
      }
    }

    return {
      content: [{
        type: 'text',
        text: [
          '✅ Squeezr proxy is shutting down gracefully.',
          '   Caches persisted to ~/.squeezr/',
          '',
          'Restart with: squeezr start',
        ].join('\n'),
      }],
    }
  }

  // ── squeezr_check_updates ────────────────────────────────────────────────────
  if (name === 'squeezr_check_updates') {
    let latest = 'unknown'
    let current = pkg.version

    try {
      const npmRes = await fetch('https://registry.npmjs.org/squeezr-ai/latest', {
        signal: AbortSignal.timeout(5000),
      })
      if (npmRes.ok) {
        const data = await npmRes.json() as { version: string }
        latest = data.version
      }
    } catch { /* network error */ }

    const isUpToDate = current === latest || latest === 'unknown'

    return {
      content: [{
        type: 'text',
        text: isUpToDate
          ? [
              `✅ Squeezr is up to date (v${current})`,
              latest === 'unknown' ? '   (Could not reach npm registry to verify)' : '',
            ].filter(Boolean).join('\n')
          : [
              `🆕 Update available: v${current} → v${latest}`,
              '',
              'Run to update:',
              '   squeezr update',
              '   (or: npm install -g squeezr-ai@latest)',
            ].join('\n'),
      }],
    }
  }

  // ── squeezr_update ────────────────────────────────────────────────────────────
  if (name === 'squeezr_update') {
    // First check latest version
    let latest = 'latest'
    try {
      const npmRes = await fetch('https://registry.npmjs.org/squeezr-ai/latest', {
        signal: AbortSignal.timeout(5000),
      })
      if (npmRes.ok) {
        const data = await npmRes.json() as { version: string }
        latest = data.version
      }
    } catch { /* ignore */ }

    try {
      execSync('npm install -g squeezr-ai@latest', { timeout: 60000, stdio: 'pipe' })
      return {
        content: [{
          type: 'text',
          text: [
            `✅ Squeezr updated to v${latest}`,
            '',
            'Restart the proxy to use the new version:',
            '   squeezr start',
          ].join('\n'),
        }],
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        content: [{
          type: 'text',
          text: [
            '❌ Update failed.',
            '',
            'Try manually:',
            '   npm install -g squeezr-ai@latest',
            '',
            `Error: ${msg.slice(0, 300)}`,
          ].join('\n'),
        }],
        isError: true,
      }
    }
  }

  // ── squeezr_set_project ───────────────────────────────────────────────────
  if (name === 'squeezr_set_project') {
    const parsed = z.object({ project: z.string() }).parse(args)
    const projName = parsed.project.trim()

    const result = await proxyPost('/squeezr/project', {
      project: projName || null,
    })

    if (!result) {
      return {
        content: [{ type: 'text', text: '❌ Squeezr proxy is not running. Start with: squeezr start' }],
        isError: false,
      }
    }

    const isManual = (result as any).manual
    const name_ = (result as any).project

    return {
      content: [{
        type: 'text',
        text: isManual
          ? `✅ Project set to: ${name_}
   All future requests will be tracked under this project.
   Clear with: squeezr_set_project({ project: "" })`
          : `✅ Project cleared. Auto-detection active (current: ${name_}).`,
      }],
    }
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  }
})

// ── Start server ──────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
// stderr only — stdout is reserved for MCP protocol
process.stderr.write(`[squeezr-mcp] Squeezr MCP server v${pkg.version} ready (proxy: ${BASE_URL})\n`)
