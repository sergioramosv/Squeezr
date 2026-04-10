#!/usr/bin/env node
import { Stats } from './stats.js'
import { homedir } from 'os'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'

const args = process.argv.slice(2)

// ── Reset ────────────────────────────────────────────────────────────────────

if (args.includes('--reset')) {
  const statsFile = join(homedir(), '.squeezr', 'stats.json')
  const cacheFile = join(homedir(), '.squeezr', 'cache.json')
  const syspromptFile = join(homedir(), '.squeezr', 'sysprompt_cache.json')
  for (const f of [statsFile, cacheFile, syspromptFile]) {
    if (existsSync(f)) { unlinkSync(f); console.log(`Deleted ${f}`) }
  }
  console.log('Stats reset.')
  process.exit(0)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const W = 58 // inner width between │ and │
const CPT = 3.5

const fmtN = (n: number) => n.toLocaleString()
const tok = (c: number) => Math.round(c / CPT)
const fmtCh = (c: number) => `${fmtN(c)} ch`
const fmtTk = (c: number) => `~${fmtN(tok(c))} tk`

/** Print a line that is EXACTLY W chars between the two │ borders */
function row(content: string) {
  const visible = content.length
  if (visible >= W) {
    console.log(`│${content.slice(0, W)}│`)
  } else {
    console.log(`│${content}${' '.repeat(W - visible)}│`)
  }
}

/** Two-column row: label (left-aligned) + value (right-aligned) */
function kv(label: string, value: string) {
  const gap = W - 2 - label.length - value.length
  if (gap < 1) {
    row(`  ${label} ${value}`)
  } else {
    row(`  ${label}${' '.repeat(gap)}${value}`)
  }
}

/** Three-column row: label + chars + tokens */
function kv3(label: string, chars: number, prefix = '-') {
  const ch = `${prefix}${fmtCh(chars)}`
  const tk = fmtTk(chars)
  const col1 = 20
  const col2 = 16
  const padLabel = label.padEnd(col1)
  const padCh = ch.padStart(col2)
  const padTk = tk.padStart(W - 2 - col1 - col2 - 2)
  row(`  ${padLabel}${padCh}  ${padTk}`)
}

function sep() { row('  ' + ' '.repeat(20) + '─'.repeat(16) + '  ' + '─'.repeat(W - 2 - 20 - 16 - 2)) }
function blank() { row('') }
function topLine() { console.log(`┌${'─'.repeat(W)}┐`) }
function midLine() { console.log(`├${'─'.repeat(W)}┤`) }
function botLine() { console.log(`└${'─'.repeat(W)}┘`) }

function fmtUptime(secs: number): string {
  if (secs < 60) return secs + 's'
  if (secs < 3600) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's'
  return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm'
}

// ── Data source ──────────────────────────────────────────────────────────────

interface GainData {
  title: string
  requests: number
  detSaved: number
  aiSaved: number
  dedupSaved: number
  syspromptSaved: number
  overheadAdded: number
  aiCalls: number
  originalChars: number
  savedChars: number
  byTool: Record<string, { count: number; savedChars: number; originalChars: number }>
  project?: string
  uptime?: number
}

function loadHistoric(): GainData | null {
  const data = Stats.loadGlobal() as Record<string, unknown>
  if (!data || !data.requests) return null
  const byTool = (data.by_tool ?? {}) as Record<string, { count: number; savedChars: number; originalChars: number }>
  return {
    title: 'Token Savings (all-time)',
    requests: data.requests as number,
    detSaved: (data.det_saved_chars as number) ?? 0,
    aiSaved: (data.ai_saved_chars as number) ?? 0,
    dedupSaved: (data.dedup_saved_chars as number) ?? 0,
    syspromptSaved: (data.sysprompt_saved_chars as number) ?? 0,
    overheadAdded: (data.overhead_chars as number) ?? 0,
    aiCalls: (data.ai_compression_calls as number) ?? 0,
    originalChars: (data.total_original_chars as number) ?? 0,
    savedChars: (data.total_saved_chars as number) ?? 0,
    byTool,
  }
}

async function loadSession(): Promise<GainData | null> {
  const port = process.env.SQUEEZR_PORT ?? '8080'
  try {
    const resp = await fetch(`http://localhost:${port}/squeezr/stats`)
    if (!resp.ok) return null
    const d = await resp.json() as Record<string, unknown>
    const bd = (d.breakdown ?? {}) as Record<string, number>
    const byTool = (d.by_tool ?? {}) as Record<string, { count: number; saved_chars: number; saved_tokens: number; avg_pct: number }>
    // Convert by_tool format from summary() to gain format
    const bt: Record<string, { count: number; savedChars: number; originalChars: number }> = {}
    for (const [tool, t] of Object.entries(byTool)) {
      bt[tool] = { count: t.count, savedChars: t.saved_chars, originalChars: Math.round(t.saved_chars / Math.max(t.avg_pct / 100, 0.01)) }
    }
    return {
      title: 'Session Savings (live)',
      requests: (d.requests as number) ?? 0,
      detSaved: bd.deterministic ?? 0,
      aiSaved: bd.ai_compression ?? 0,
      dedupSaved: bd.read_dedup ?? 0,
      syspromptSaved: bd.system_prompt ?? 0,
      overheadAdded: bd.overhead ?? 0,
      aiCalls: bd.ai_calls ?? 0,
      originalChars: (d.total_original_chars as number) ?? 0,
      savedChars: (d.total_saved_chars as number) ?? 0,
      byTool: bt,
      project: (d.current_project as string) ?? undefined,
      uptime: (d.uptime_seconds as number) ?? undefined,
    }
  } catch {
    return null
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(d: GainData, showTools: boolean) {
  const grossChars = d.detSaved + d.aiSaved + d.dedupSaved + d.syspromptSaved
  const aiCostChars = d.aiCalls * 1650 * CPT // convert tokens back to chars for consistent display
  const netChars = grossChars - aiCostChars
  const ctxPct = d.originalChars > 0 ? Math.round((d.savedChars / d.originalChars) * 1000) / 10 : 0

  topLine()
  row(`  Squeezr — ${d.title}`)
  midLine()
  if (d.project && d.project !== 'unknown') kv('Project', d.project)
  kv('Requests', String(d.requests))
  if (d.uptime) kv('Uptime', fmtUptime(d.uptime))
  blank()
  if (d.detSaved > 0)       kv3('Deterministic', d.detSaved)
  if (d.aiSaved > 0)        kv3('AI compression', d.aiSaved)
  if (d.dedupSaved > 0)     kv3('Read dedup', d.dedupSaved)
  if (d.syspromptSaved > 0)  kv3('System prompt', d.syspromptSaved)
  if (d.overheadAdded > 0)  kv3('Tag overhead', d.overheadAdded, '+')
  if (d.aiCalls > 0) {
    // AI compression cost: tokens spent on Haiku/GPT-mini calls
    kv3('AI compress cost', Math.round(aiCostChars), '+')
  }
  sep()
  kv3('NET saved', Math.max(0, Math.round(netChars)), ' ')
  kv('Context reduction', `${ctxPct}%`)

  const toolEntries = Object.entries(d.byTool)
    .filter(([, t]) => t.savedChars > 0)
    .sort((a, b) => b[1].savedChars - a[1].savedChars)

  if (showTools && toolEntries.length > 0) {
    midLine()
    row('  By Tool')
    for (const [tool, t] of toolEntries) {
      const pct = t.originalChars > 0 ? Math.round((t.savedChars / t.originalChars) * 1000) / 10 : 0
      kv3(`${tool} (${t.count}x)`, t.savedChars)
    }
  }

  botLine()
  console.log('  ~3.5 chars/token')

  if (d.aiCalls > 0) {
    const cost = d.aiCalls * 1650
    if (cost > tok(netChars)) {
      console.log(`\n  ⚠  AI compression cost exceeds savings. Consider deterministic-only mode.`)
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const showDetails = args.includes('--details') || args.includes('-d')
  const showSession = args.includes('--session') || args.includes('-s')

  if (showSession) {
    const session = await loadSession()
    if (!session) {
      console.log('Squeezr is not running. Start it with: squeezr start')
      process.exit(1)
    }
    if (session.requests === 0) {
      console.log('No requests in this session yet.')
      process.exit(0)
    }
    render(session, true)
    return
  }

  const data = loadHistoric()
  if (!data) {
    console.log('No stats yet. Start Squeezr and make some requests.')
    process.exit(0)
  }
  render(data, showDetails)
}

main()
