#!/usr/bin/env node
/**
 * squeezr discover — pattern coverage report
 *
 * Queries the running Squeezr proxy for pattern hit stats and prints a
 * formatted report. Shows which deterministic patterns fired, how many
 * outputs hit the generic fallback (potential new patterns), and
 * Read-tool breakdown.
 */

const PORT = parseInt(process.env.SQUEEZR_PORT ?? '8080')

const PATTERN_LABELS: Record<string, string> = {
  gitDiff: 'git diff / show',
  gitLog: 'git log',
  gitStatus: 'git status',
  gitBranch: 'git branch',
  cargoTest: 'cargo test',
  cargoBuild: 'cargo build/check/clippy',
  vitest: 'vitest / jest',
  playwright: 'playwright',
  pyTraceback: 'python / pytest',
  goTest: 'go test',
  tsc: 'tsc errors',
  eslint: 'eslint / biome',
  prettier: 'prettier --check',
  nextBuild: 'next build',
  pkgInstall: 'npm/pnpm install',
  pkgList: 'pnpm/npm list',
  pkgOutdated: 'pnpm/npm outdated',
  terraform: 'terraform plan/apply',
  npx: 'npx noise',
  dockerPs: 'docker ps',
  dockerImages: 'docker images',
  kubectl: 'kubectl get',
  prisma: 'prisma CLI',
  ghPrChecks: 'gh pr checks',
  ghPr: 'gh pr view',
  ghRunList: 'gh run list',
  ghIssueList: 'gh issue list',
  curl: 'curl -v',
  wget: 'wget',
}

const READ_LABELS: Record<string, string> = {
  readLockfile: 'lockfile replaced',
  readSemantic: 'semantic code structure',
  readHeadTail: 'head+tail truncation',
  readDedup: 'cross-turn dedup',
  grepCompacted: 'grep grouped by file',
  globCompacted: 'glob → directory summary',
}

async function main() {
  let data: Record<string, unknown>
  try {
    const resp = await fetch(`http://localhost:${PORT}/squeezr/stats`)
    data = await resp.json() as Record<string, unknown>
  } catch {
    console.log(`Squeezr is not running on port ${PORT}.`)
    console.log(`Start it with: squeezr start`)
    process.exit(1)
  }

  const patterns = data.pattern_hits as Record<string, number> ?? {}
  const requests = data.requests as number ?? 0
  const sessionHits = data.session_cache_hits as number ?? 0
  const savedChars = data.total_saved_chars as number ?? 0
  const savedPct = data.savings_pct as string ?? '0%'

  const W = 46
  const line = '─'.repeat(W)
  const pad = (s: string, n: number) => s.padEnd(n)
  const rpad = (s: string, n: number) => s.padStart(n)

  console.log(`┌${line}┐`)
  console.log(`│${pad('  Squeezr — Pattern Coverage Report', W)}│`)
  console.log(`├${line}┤`)

  if (requests === 0) {
    console.log(`│${pad('  No requests yet. Make some tool calls and retry.', W)}│`)
    console.log(`└${line}┘`)
    return
  }

  console.log(`│  ${pad(`Requests: ${requests}`, 20)}  Session cache hits: ${rpad(String(sessionHits), 4)}  │`)
  console.log(`│  ${pad(`Saved: ${savedChars.toLocaleString()} chars (${savedPct})`, W - 2)}│`)
  console.log(`├${line}┤`)

  // Bash patterns
  const bashPatterns = Object.entries(patterns)
    .filter(([k, v]) => PATTERN_LABELS[k] && v > 0)
    .sort(([, a], [, b]) => b - a)

  if (bashPatterns.length > 0) {
    console.log(`│  ${pad('Bash patterns fired:', W - 2)}│`)
    for (const [k, count] of bashPatterns) {
      const label = PATTERN_LABELS[k]
      const col = `    ${pad(label, 30)} ${rpad(count + 'x', 5)}`
      console.log(`│${pad(col, W)}│`)
    }
    console.log(`├${line}┤`)
  }

  // Read / Grep / Glob
  const readPatterns = Object.entries(patterns)
    .filter(([k, v]) => READ_LABELS[k] && v > 0)
    .sort(([, a], [, b]) => b - a)

  if (readPatterns.length > 0) {
    console.log(`│  ${pad('Read / Grep / Glob:', W - 2)}│`)
    for (const [k, count] of readPatterns) {
      const label = READ_LABELS[k]
      const col = `    ${pad(label, 30)} ${rpad(count + 'x', 5)}`
      console.log(`│${pad(col, W)}│`)
    }
    console.log(`├${line}┤`)
  }

  // Fallback handlers
  const errorExtracted = patterns.errorExtracted ?? 0
  const truncated = patterns.truncated ?? 0
  if (errorExtracted > 0 || truncated > 0) {
    console.log(`│  ${pad('Fallback handlers:', W - 2)}│`)
    if (errorExtracted > 0) {
      const col = `    ${pad('auto error extraction', 30)} ${rpad(errorExtracted + 'x', 5)}`
      console.log(`│${pad(col, W)}│`)
    }
    if (truncated > 0) {
      const col = `    ${pad('generic truncation (>80 lines)', 30)} ${rpad(truncated + 'x', 5)}`
      console.log(`│${pad(col, W)}│`)
    }
    console.log(`├${line}┤`)
  }

  if (truncated > 3) {
    console.log(`│  ${pad(`Tip: ${truncated} output(s) hit the generic fallback.`, W - 2)}│`)
    console.log(`│  ${pad('These may benefit from new patterns. Open an issue:', W - 2)}│`)
    console.log(`│  ${pad('github.com/sergioramosv/Squeezr/issues', W - 2)}│`)
  } else {
    console.log(`│  ${pad('Pattern coverage looks good.', W - 2)}│`)
  }
  console.log(`└${line}┘`)
}

main()
