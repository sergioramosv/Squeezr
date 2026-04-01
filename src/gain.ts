#!/usr/bin/env node
import { Stats } from './stats.js'
import { homedir } from 'os'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'

const args = process.argv.slice(2)

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

const data = Stats.loadGlobal() as Record<string, unknown>

if (!data || !data.requests) {
  console.log('No stats yet. Start Squeezr and make some requests.')
  process.exit(0)
}

const requests = data.requests as number
const savedChars = data.total_saved_chars as number
const originalChars = data.total_original_chars as number
const CHARS_PER_TOKEN = 3.5
const savedTokens = Math.round(savedChars / CHARS_PER_TOKEN)
const byTool = (data.by_tool ?? {}) as Record<string, { count: number; savedChars: number; originalChars: number }>

// Savings % on tool results only (what Squeezr actually compresses).
// Using total context chars gives a misleadingly low number because the
// denominator includes user messages, Claude responses, and history
// re-sent on every request — none of which Squeezr touches.
const toolOriginal = Object.values(byTool).reduce((s, d) => s + d.originalChars, 0)
const toolSaved    = Object.values(byTool).reduce((s, d) => s + d.savedChars, 0)
const toolPct      = toolOriginal > 0 ? Math.round((toolSaved / toolOriginal) * 1000) / 10 : 0

// Context reduction: how much smaller the overall payload became
const ctxPct = originalChars > 0 ? Math.round((savedChars / originalChars) * 1000) / 10 : 0

console.log('┌─────────────────────────────────────────┐')
console.log('│          Squeezr — Token Savings         │')
console.log('├─────────────────────────────────────────┤')
console.log(`│  Requests         ${String(requests).padEnd(23)}│`)
console.log(`│  Saved chars      ${String(savedChars.toLocaleString()).padEnd(23)}│`)
console.log(`│  Saved tokens     ${String(savedTokens.toLocaleString()).padEnd(23)}│`)
console.log(`│  Tool savings     ${String(`${toolPct}%`).padEnd(23)}│`)
console.log(`│  Context reduction ${String(`${ctxPct}%`).padEnd(22)}│`)
if (Object.keys(byTool).length > 0) {
  console.log('├─────────────────────────────────────────┤')
  console.log('│  By Tool                                 │')
  for (const [tool, d] of Object.entries(byTool).sort((a, b) => b[1].savedChars - a[1].savedChars)) {
    const pct = d.originalChars > 0 ? Math.round((d.savedChars / d.originalChars) * 1000) / 10 : 0
    const line = `  ${tool} (${d.count}x): -${pct}%`
    console.log(`│${line.padEnd(41)}│`)
  }
}
console.log('└─────────────────────────────────────────┘')
