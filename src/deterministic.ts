/**
 * Deterministic pre-compression pipeline.
 *
 * Two layers:
 *
 * 1. Base pipeline — runs on all tool results regardless of tool type.
 *    Pipeline order matters:
 *     1. Strip ANSI codes        (noise removal)
 *     2. Strip progress bars     (noise removal)
 *     3. Collapse whitespace     (size reduction)
 *     4. Deduplicate lines       (size reduction — most impactful for logs)
 *     5. Minify inline JSON      (size reduction)
 *     6. Strip timestamps        (noise removal)
 *
 * 2. Tool-specific patterns — applied after base pipeline, keyed by tool name
 *    and content fingerprint. Replicates RTK-style filters at the proxy level
 *    so the user never needs to prefix commands with `rtk`.
 *
 *    Bash patterns:
 *      git diff/show/log, cargo build/test/clippy, vitest/jest, tsc,
 *      eslint/biome, pnpm/npm install, prettier, next build,
 *      docker ps/images/logs, kubectl get/logs, gh pr/run/issue, curl/wget
 *
 *    Tool patterns:
 *      Grep — group matches by file, cap per-file lines
 *      Read — truncate huge files (logs, lockfiles), keep head + tail
 *      Glob — compact large file listings into directory summary
 */

// ── Pattern hit tracking (for squeezr discover) ───────────────────────────────

export const detPatternHits: Record<string, number> = {}
function hit(pattern: string): void {
  detPatternHits[pattern] = (detPatternHits[pattern] ?? 0) + 1
}
export function hitPattern(pattern: string, count = 1): void {
  detPatternHits[pattern] = (detPatternHits[pattern] ?? 0) + count
}

// ── Base pipeline ─────────────────────────────────────────────────────────────

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
    .replace(/\x1B\][^\x07]*\x07/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

function stripProgressBars(text: string): string {
  return text.split('\n').filter(line => {
    const stripped = line.replace(/[\s=\-#░█▓▒▌▐►◄|]/g, '')
    return stripped.length > line.length * 0.3 || stripped.length > 5
  }).join('\n')
}

function collapseWhitespace(text: string): string {
  return text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}

function deduplicateLines(text: string): string {
  const lines = text.split('\n')
  const counts = new Map<string, number>()
  for (const line of lines) {
    const key = line.trim()
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const out: string[] = []
  for (const line of lines) {
    const key = line.trim()
    const total = counts.get(key) ?? 1
    if (total < 3) { out.push(line); continue }
    const emitted = seen.get(key) ?? 0
    if (emitted === 0) {
      out.push(line)
      out.push(`  ... [repeated ${total - 1} more times]`)
    }
    seen.set(key, emitted + 1)
  }
  return out.join('\n')
}

function deduplicateStackTraces(text: string): string {
  // Collapse identical multi-line stack trace blocks (Node.js "at " / Python "File ")
  const isFrameLine = (l: string) => /^[ \t]{2,}(at |File "|in <)/.test(l)

  type Chunk = { isStack: boolean; lines: string[] }
  const chunks: Chunk[] = []
  for (const line of text.split('\n')) {
    const stack = isFrameLine(line)
    if (!chunks.length || chunks[chunks.length - 1].isStack !== stack) {
      chunks.push({ isStack: stack, lines: [line] })
    } else {
      chunks[chunks.length - 1].lines.push(line)
    }
  }

  const stackChunks = chunks.filter(c => c.isStack && c.lines.length >= 3)
  if (stackChunks.length === 0) return text

  const counts = new Map<string, number>()
  for (const c of stackChunks) {
    const key = c.lines.join('\n')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (![...counts.values()].some(v => v > 1)) return text

  const seen = new Set<string>()
  const out: string[] = []
  for (const chunk of chunks) {
    if (!chunk.isStack || chunk.lines.length < 3) { out.push(...chunk.lines); continue }
    const key = chunk.lines.join('\n')
    if (!seen.has(key)) {
      seen.add(key)
      out.push(...chunk.lines)
    } else {
      out.push(`  ... [same ${chunk.lines.length}-frame stack trace repeated]`)
    }
  }
  return out.join('\n')
}

function minifyJson(text: string): string {
  return text.replace(/(\{[\s\S]{200,}?\})/g, (match) => {
    try { return JSON.stringify(JSON.parse(match)) } catch { return match }
  })
}

function stripTimestamps(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/g, '')
    .replace(/\[\d{2}:\d{2}:\d{2}(\.\d+)?\]/g, '')
    .replace(/\d{2}:\d{2}:\d{2}(\.\d+)?\s/g, '')
}

export function preprocess(text: string): string {
  let t = text
  t = stripAnsi(t)
  t = stripProgressBars(t)
  t = stripTimestamps(t)
  t = deduplicateStackTraces(t)
  t = deduplicateLines(t)
  t = minifyJson(t)
  t = collapseWhitespace(t)
  return t
}

export function preprocessRatio(original: string, processed: string): number {
  if (!original.length) return 0
  return 1 - processed.length / original.length
}

// ── Bash: git status ─────────────────────────────────────────────────────────

function looksLikeGitStatus(t: string): boolean {
  return t.startsWith('On branch ') || t.startsWith('HEAD detached at')
}

function compactGitStatus(text: string): string {
  const lines = text.split('\n')
  const staged: string[] = []
  const modified: string[] = []
  const untracked: string[] = []
  let section = ''
  let branch = ''
  let trackingMsg = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (line.startsWith('On branch ')) branch = line.replace('On branch ', '').trim()
    else if (line.startsWith('HEAD detached at')) branch = trimmed
    else if (trimmed.includes('ahead') || trimmed.includes('behind') || trimmed.includes('diverged')) trackingMsg = trimmed
    else if (line.startsWith('Changes to be committed')) section = 'staged'
    else if (line.startsWith('Changes not staged')) section = 'modified'
    else if (line.startsWith('Untracked files:')) section = 'untracked'
    else if (line.startsWith('nothing to commit') || line.startsWith('no changes added')) section = ''
    else if ((line.startsWith('\t') || /^  /.test(line)) && trimmed && !trimmed.startsWith('(')) {
      const file = trimmed.replace(/^(modified|new file|deleted|renamed|both modified|copied):\s+/, '')
      if (section === 'staged') staged.push(file)
      else if (section === 'modified') modified.push(file)
      else if (section === 'untracked') untracked.push(file)
    }
  }

  const out: string[] = []
  if (branch) out.push(`* ${branch}${trackingMsg ? ` [${trackingMsg}]` : ''}`)
  if (staged.length) out.push(`+ Staged: ${staged.length} file${staged.length !== 1 ? 's' : ''}\n${staged.map(f => '   ' + f).join('\n')}`)
  if (modified.length) out.push(`~ Modified: ${modified.length} file${modified.length !== 1 ? 's' : ''}\n${modified.map(f => '   ' + f).join('\n')}`)
  if (untracked.length) out.push(`? Untracked: ${untracked.length} file${untracked.length !== 1 ? 's' : ''}\n${untracked.map(f => '   ' + f).join('\n')}`)
  if (!staged.length && !modified.length && !untracked.length) {
    const cleanMsg = lines.find(l => l.includes('nothing to commit') || l.includes('working tree clean'))
    if (cleanMsg) out.push(cleanMsg.trim())
  }
  if (out.length === 0) return lines.find(l => l.includes('nothing to commit') || l.includes('working tree clean')) ?? text
  return out.join('\n')
}

// ── Bash: git ─────────────────────────────────────────────────────────────────

function compactGitDiff(text: string, pressure = 0): string {
  const lines = text.split('\n')
  const out: string[] = []
  let contextBudget = 0
  const changedFns = new Set<string>()
  // At critical pressure (>90%) strip all context lines — only keep changed lines
  const contextAllowed = pressure >= 0.9 ? 0 : 1

  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') ||
        line.startsWith('--- ') || line.startsWith('+++ ')) {
      out.push(line); contextBudget = 0
    } else if (line.startsWith('@@')) {
      out.push(line); contextBudget = contextAllowed
      // Extract function context from "@@ -l,s +l,s @@ funcName"
      const fnCtx = line.match(/@{2}[^@]+@{2}\s+(.+)/)
      if (fnCtx) {
        const name = fnCtx[1].trim()
          .replace(/^(export\s+)?(default\s+)?(async\s+)?(function\s+)?/, '')
          .split(/[\s(:{<]/)[0]
        if (name && /^\w/.test(name)) changedFns.add(name)
      }
    } else if (line.startsWith('+') || line.startsWith('-')) {
      out.push(line); contextBudget = contextAllowed
    } else if (line.startsWith(' ') && contextBudget > 0) {
      out.push(line); contextBudget--
    }
  }

  // Prepend changed-function summary for large diffs
  if (out.length > 100 && changedFns.size > 0) {
    return `Changed: ${[...changedFns].join(', ')}\n` + out.join('\n')
  }
  return out.join('\n')
}

// compact git log: one line per commit (full format); cap --oneline format
function compactGitLog(text: string, pressure = 0): string {
  const cap = pressure >= 0.9 ? 10 : pressure >= 0.75 ? 20 : 30
  // Full verbose format: commit <hash>\nAuthor: ...\nDate: ...\n\n    message
  if (text.startsWith('commit ') && text.includes('Author:') && text.includes('Date:')) {
    const lines = text.split('\n')
    const out: string[] = []
    let hash = '', author = '', date = '', msg = ''
    for (const line of lines) {
      if (line.startsWith('commit ')) { if (hash) out.push(`${hash} ${msg} (${author}, ${date})`); hash = line.slice(7, 14); author = ''; date = ''; msg = '' }
      else if (line.startsWith('Author:')) author = line.replace('Author:', '').trim().split('<')[0].trim()
      else if (line.startsWith('Date:')) date = line.replace('Date:', '').trim()
      else if (line.trim() && !author.length) { /* skip */ } else if (line.trim()) msg = msg || line.trim()
    }
    if (hash) out.push(`${hash} ${msg} (${author}, ${date})`)
    const commits = out.slice(0, cap)
    if (out.length > cap) commits.push(`... [${out.length - cap} more commits]`)
    return commits.join('\n') || text
  }
  // --oneline or other compact formats: already one line per commit, just cap
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length > cap) return lines.slice(0, cap).join('\n') + `\n... [${lines.length - cap} more commits]`
  return text
}

// ── Bash: cargo ───────────────────────────────────────────────────────────────

function extractCargoTestFailures(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inBlock = false
  for (const line of lines) {
    if (line.includes('FAILED') || line.includes('error[') || line.includes('panicked at')) { out.push(line); inBlock = true }
    else if (line.startsWith('---- ') && line.endsWith(' stdout ----')) { out.push(line); inBlock = true }
    else if (line.startsWith('test result:') || line.startsWith('failures:') || line.startsWith('error: test failed')) { out.push(line); inBlock = false }
    else if (inBlock && line.trim()) out.push(line)
    else if (!line.trim()) inBlock = false
  }
  if (out.length === 0) return lines.find(l => l.startsWith('test result:')) ?? text
  return out.join('\n')
}

function extractCargoErrors(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inDiag = false
  for (const line of lines) {
    if (/^error(\[E\d+\])?:/.test(line) || /^warning(\[.*?\])?:/.test(line)) { out.push(line); inDiag = true }
    else if ((line.startsWith('  -->') || line.startsWith('   |') || line.startsWith('   =')) && inDiag) out.push(line)
    else if (line.startsWith('error: aborting') || line.startsWith('error: could not compile')) { out.push(line); inDiag = false }
    else if (!line.trim()) inDiag = false
  }
  if (out.length === 0) return lines.find(l => l.includes('Finished') || l.includes('error: could not compile')) ?? text
  return out.join('\n')
}

// ── Bash: JS/TS tooling ───────────────────────────────────────────────────────

function extractVitestFailures(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inFail = false
  for (const line of lines) {
    const isFail = line.includes('×') || line.includes('✕') || /\bFAIL\b/.test(line) ||
      line.includes('AssertionError') || line.includes('Error:') ||
      line.includes('Expected') || line.includes('Received')
    const isSummary = /^(Test Files|Tests|Duration|Suites)/.test(line)
    if (isFail) { out.push(line); inFail = true }
    else if (isSummary) { out.push(line); inFail = false }
    else if (inFail && line.trim()) out.push(line)
    else if (!line.trim()) inFail = false
  }
  if (out.length === 0) return lines.filter(l => /^(Test Files|Tests|Duration)/.test(l)).join('\n') || text
  return out.join('\n')
}

function compactTscErrors(text: string): string {
  const errorLines = text.split('\n').filter(l => /error TS\d+:/.test(l) || /warning TS\d+:/.test(l))
  if (errorLines.length === 0) return text
  const byFile: Record<string, string[]> = {}
  for (const line of errorLines) {
    const match = line.match(/^(.+?)\(\d+,\d+\):/)
    const file = match?.[1]?.trim() ?? 'unknown'
    if (!byFile[file]) byFile[file] = []
    byFile[file].push(line.replace(/^.+?\(\d+,\d+\):\s*/, '').trim())
  }
  return Object.entries(byFile)
    .map(([f, errs]) => `${f}: ${errs.length} error(s)\n${errs.slice(0, 5).map(e => '  ' + e).join('\n')}`)
    .join('\n')
}

function compactEslint(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (line.match(/\d+:\d+\s+(error|warning)/)) out.push(line.replace(/\s+https?:\/\/\S+/g, ''))
    else if (/^[/\\]/.test(line) || /^\w:[/\\]/.test(line)) out.push(line)  // file path header
    else if (line.match(/\d+ (problem|error|warning)/)) out.push(line)      // summary
  }
  return out.join('\n') || text
}

// prettier --check: only files that need formatting
function compactPrettier(text: string): string {
  const lines = text.split('\n')
  const files = lines.filter(l => l.startsWith('[warn]') || l.includes('needs formatting') || /^\s{2}\S/.test(l))
  const summary = lines.find(l => l.includes('Code style issues') || l.includes('All matched files'))
  return [...files, summary ?? ''].filter(Boolean).join('\n') || text
}

// next build: route table + errors only, strip webpack noise
function compactNextBuild(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inRouteTable = false
  for (const line of lines) {
    if (line.includes('Route (') || line.includes('○') || line.includes('●') || line.includes('λ')) { inRouteTable = true; out.push(line) }
    else if (line.includes('Error:') || line.includes('error TS') || line.includes('Failed to compile')) out.push(line)
    else if (line.match(/^(info|warn|error)\s+-/)) out.push(line)
    else if (line.includes('First Load JS') || line.includes('Total size')) out.push(line)
    else if (inRouteTable && line.trim() === '') inRouteTable = false
    else if (inRouteTable) out.push(line)
  }
  return out.join('\n') || text
}

// ── Bash: package list / outdated ────────────────────────────────────────────

function looksLikePkgList(t: string): boolean {
  // Require ├── (not just └──) to avoid matching Prisma/other box-drawing outputs
  return t.includes('├──') && (t.includes('@') || /\bv\d+\.\d+/.test(t))
}

function compactPkgList(text: string): string {
  const lines = text.split('\n')
  const direct: string[] = []
  const nested: string[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    if (/^[├└]──/.test(line)) direct.push(line)       // direct dep (no leading indent)
    else if (/^[\s│]/.test(line)) nested.push(line)   // nested dep
    else direct.push(line)                              // root package / section header
  }
  if (nested.length === 0) return text  // nothing to compact
  const result = [...direct.slice(0, 60)]
  result.push(`... [${nested.length} nested packages omitted]`)
  if (direct.length > 60) result.push(`... [${direct.length - 60} more direct packages]`)
  return result.join('\n')
}

function looksLikePkgOutdated(t: string): boolean {
  return /Current\s+Wanted\s+Latest/i.test(t)
}

function compactPkgOutdated(text: string): string {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length <= 30) return text
  return lines.slice(0, 30).join('\n') + `\n... [${lines.length - 30} more outdated packages]`
}

// ── Bash: Prisma ──────────────────────────────────────────────────────────────

function looksLikePrisma(t: string): boolean {
  return t.toLowerCase().includes('prisma') && (t.includes('┌') || t.includes('└─') || t.includes('Prisma schema'))
}

function compactPrisma(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inBox = false
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('┌') || t.startsWith('╔')) { inBox = true; continue }
    if (t.startsWith('└') || t.startsWith('╚')) { inBox = false; continue }
    if (inBox) continue
    out.push(line)
  }
  return out.join('\n') || text
}

// ── Bash: Docker ──────────────────────────────────────────────────────────────

function compactDockerPs(text: string): string {
  // Keep header + one line per container, strip long IDs and redundant ports
  const lines = text.split('\n').filter(Boolean)
  if (lines.length < 3) return text
  return lines.map((line, i) => {
    if (i === 0) return line  // header
    // Shorten container ID to 12 chars
    return line.replace(/^([a-f0-9]{64})\s/, (_, id) => id.slice(0, 12) + '  ')
  }).join('\n')
}

function compactDockerImages(text: string): string {
  const lines = text.split('\n').filter(Boolean)
  if (lines.length < 3) return text
  // Remove <none> dangling images, shorten IDs
  return lines.filter(l => !l.includes('<none>') || l.startsWith('REPOSITORY'))
    .map(l => l.replace(/\b([a-f0-9]{64})\b/g, (id) => id.slice(0, 12)))
    .join('\n')
}


// ── Bash: kubectl ─────────────────────────────────────────────────────────────

function compactKubectlGet(text: string): string {
  // kubectl get output: keep header + data rows, strip extra whitespace
  const lines = text.split('\n').filter(Boolean)
  if (lines.length < 3) return text
  // Collapse multiple spaces to tabs-like alignment
  return lines.map(l => l.replace(/\s{2,}/g, '  ')).join('\n')
}

// ── Bash: gh CLI ──────────────────────────────────────────────────────────────

function compactGhPr(text: string): string {
  // Keep title, state, url, key metadata — strip long body
  const lines = text.split('\n')
  const keep = lines.filter(l =>
    l.match(/^(title|state|author|url|number|labels|milestone|draft|checks)/i) ||
    l.match(/^#\d+/) ||
    l.match(/✓|✗|●|○/) ||
    l.includes('https://github.com')
  )
  return keep.join('\n') || text
}

function compactGhRunList(text: string): string {
  // gh run list / gh run view: keep status + conclusion + name
  const lines = text.split('\n').filter(Boolean)
  return lines.slice(0, 20).join('\n') + (lines.length > 20 ? `\n... [${lines.length - 20} more]` : '')
}

function compactGhIssueList(text: string): string {
  const lines = text.split('\n').filter(Boolean)
  return lines.slice(0, 25).join('\n') + (lines.length > 25 ? `\n... [${lines.length - 25} more]` : '')
}

// ── Bash: Playwright ─────────────────────────────────────────────────────────

function looksLikePlaywright(t: string): boolean {
  return (t.includes('playwright') || /\.(spec|test)\.(ts|js)/.test(t)) &&
    (t.includes('passed') || t.includes('failed') || t.includes('Error') || t.includes('FAILED'))
}

function extractPlaywrightFailures(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  // Collect detail lines for each fail block by scanning forward
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Passing test — always skip
    if (/^\s*[\u2713\u2714]\s/.test(line)) continue
    // Fail test header — collect it plus following detail lines
    if (/^\s*([\u2718\u00D7\u2715]|FAILED)\s/.test(line)) {
      out.push(line)
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]
        if (/^\s*[\u2713\u2714\u2718\u00D7\u2715]\s/.test(next)) break  // next test
        if (/^\s*\d+\s+(passed|failed|skipped)/.test(next)) break        // summary
        if (next.trim()) out.push(next)
      }
      continue
    }
    // Standalone error lines (no ✘ header)
    if (line.includes('Error:') || line.includes('TimeoutError')) out.push(line)
    // Summary lines
    if (/^\s*\d+\s+(passed|failed|skipped|flaky)/.test(line) ||
        line.includes('Slowest') || /^Finished in/.test(line)) out.push(line)
  }
  if (out.length === 0) return lines.filter(l => /\d+\s+(passed|failed)/.test(l)).join('\n') || text
  return out.join('\n')
}

// ── Bash: Python / pytest ─────────────────────────────────────────────────────

function looksLikePyTraceback(t: string): boolean {
  return t.includes('Traceback (most recent call last)') || t.includes('FAILED') && t.includes('.py::')
}

function extractPyFailures(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inTraceback = false
  let inFailBlock = false
  for (const line of lines) {
    if (line.startsWith('Traceback (most recent call last)')) { out.push(line); inTraceback = true; continue }
    if (inTraceback) { out.push(line); if (line.trim() && !line.startsWith(' ') && !line.startsWith('\t')) inTraceback = false; continue }
    if (/^FAILED .+::/.test(line) || /^ERROR .+::/.test(line)) { out.push(line); inFailBlock = true; continue }
    if (/^(PASSED|passed \d+|failed \d+|error \d+|=+ \d+ (passed|failed|error))/.test(line)) { out.push(line); inFailBlock = false; continue }
    if (inFailBlock && line.trim()) out.push(line)
    else if (!line.trim()) inFailBlock = false
  }
  if (out.length === 0) return lines.filter(l => /\d+ (passed|failed|error)/.test(l)).join('\n') || text
  return out.join('\n')
}

// ── Bash: Go test ─────────────────────────────────────────────────────────────

function looksLikeGoTest(t: string): boolean {
  return /^--- (PASS|FAIL):/.test(t) || /^(ok|FAIL)\s+\S+\s+[\d.]+s/.test(t)
}

function extractGoTestFailures(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inFail = false
  for (const line of lines) {
    if (line.startsWith('--- FAIL:') || line.startsWith('FAIL\t')) { out.push(line); inFail = true }
    else if (line.startsWith('--- PASS:') || /^ok\s/.test(line)) { inFail = false }
    else if (line.startsWith('FAIL') || line.startsWith('panic:')) { out.push(line); inFail = true }
    else if (/^(ok|FAIL)\s+\S+\s+[\d.]+s/.test(line)) out.push(line)
    else if (inFail && line.trim()) out.push(line)
    else if (!line.trim()) inFail = false
  }
  if (out.length === 0) return lines.filter(l => /^(ok|FAIL)\s/.test(l)).join('\n') || text
  return out.join('\n')
}

// ── Bash: Terraform ───────────────────────────────────────────────────────────

function looksLikeTerraform(t: string): boolean {
  return (t.includes('# ') && (t.includes('will be created') || t.includes('will be destroyed') || t.includes('must be replaced'))) ||
    t.includes('Terraform will perform')
}

function compactTerraform(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (const line of lines) {
    // Keep resource change summary lines
    if (/^\s*#/.test(line) && (line.includes('will be') || line.includes('must be') || line.includes('has been'))) out.push(line.trim())
    // Keep plan summary
    else if (line.includes('Plan:') || line.includes('Apply complete') || line.includes('No changes') || line.includes('Destroy complete')) out.push(line.trim())
    // Keep error lines
    else if (line.includes('Error:') || line.includes('error:')) out.push(line)
  }
  return out.join('\n') || text
}

// ── Bash: git branch ─────────────────────────────────────────────────────────

function looksLikeGitBranch(t: string): boolean {
  const lines = t.split('\n').filter(l => l.trim())
  if (lines.length < 2) return false
  // Branch names are short identifiers with no colons, parens, brackets, or spaces mid-line
  const branchLine = /^[* ]{1,2}[\w/.\-]+(?: -> [\w/.\-]+)?$/
  return lines.filter(l => branchLine.test(l)).length / lines.length > 0.8
}

function compactGitBranch(text: string): string {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length <= 20) return text
  const current = lines.find(l => l.startsWith('* '))
  const rest = lines.filter(l => !l.startsWith('* ')).slice(0, 15)
  const omitted = lines.length - 1 - rest.length
  const out = current ? [current, ...rest] : rest
  if (omitted > 0) out.push(`... [${omitted} more branches]`)
  return out.join('\n')
}

// ── Bash: npx / npm run ───────────────────────────────────────────────────────

function looksLikeNpx(t: string): boolean {
  return /^npm warn|^npm error|Packages: .*installed|npx: installed/.test(t)
}

function stripNpxNoise(text: string): string {
  // Remove npx install noise lines; keep the actual command output
  const lines = text.split('\n')
  const noiseStart = lines.findIndex(l => /^npx: installed \d+/.test(l) || /^Packages: \d+/.test(l))
  if (noiseStart >= 0) {
    // Find where actual output starts (after the npx banner)
    const outputStart = lines.findIndex((l, i) => i > noiseStart && l.trim() && !/^npm (warn|error)/.test(l))
    if (outputStart > 0) return lines.slice(outputStart).join('\n')
  }
  return lines.filter(l => !/^npm warn (deprecated|WARN)/.test(l)).join('\n')
}

// ── Bash: wget ────────────────────────────────────────────────────────────────

function looksLikeWget(t: string): boolean {
  return t.includes('--') && (t.includes('Resolving ') || t.includes('Connecting to ') || t.includes('HTTP request sent') || t.includes('saved ['))
}

function compactWgetOutput(text: string): string {
  const lines = text.split('\n')
  // Keep final result lines only
  const keep = lines.filter(l =>
    l.includes('saved [') || l.includes('200 OK') || l.includes('404 Not Found') ||
    l.includes('Error') || l.includes('ERROR') || /^\d{4}-\d{2}-\d{2}.*saved/.test(l)
  )
  return keep.join('\n') || text
}

// ── Bash: curl / wget ─────────────────────────────────────────────────────────

function compactCurlOutput(text: string): string {
  // Strip verbose headers (-v output), keep response body
  const lines = text.split('\n')
  const bodyStart = lines.findIndex(l => l.startsWith('* Connected') || l === '' || l.startsWith('{') || l.startsWith('[') || l.startsWith('<'))
  if (bodyStart < 0 || bodyStart < 3) return text
  // If it looks like -v output (lots of > < * lines), strip them
  const verboseLines = lines.filter(l => l.startsWith('>') || l.startsWith('<') || l.startsWith('*'))
  if (verboseLines.length > lines.length * 0.4) {
    return lines.filter(l => !l.startsWith('>') && !l.startsWith('*') && !l.match(/^\s*$/)).join('\n')
  }
  return text
}

// ── Bash detection helpers ────────────────────────────────────────────────────

function looksLikeGitDiff(t: string): boolean { return t.includes('diff --git') || (t.includes('--- a/') && t.includes('+++ b/')) }
function looksLikeGitLog(t: string): boolean {
  if (t.startsWith('commit ') && t.includes('Author:') && t.includes('Date:')) return true
  // --oneline: 3+ lines each starting with a 7-12 char hex hash (not followed by another hex char)
  const lines = t.split('\n').filter(l => l.trim())
  if (lines.length < 3) return false
  const hashLines = lines.filter(l => /^[a-f0-9]{7,12}[^a-f0-9]/.test(l))
  return hashLines.length >= 3 && hashLines.length / lines.length > 0.6
}
function looksLikeCargoTest(t: string): boolean { return /test .+\.\.\. (ok|FAILED)/.test(t) }
function looksLikeCargoBuild(t: string): boolean { return /error\[E\d+\]/.test(t) || (t.includes('Compiling') && (t.includes('error') || t.includes('warning'))) }
function looksLikeVitest(t: string): boolean { return (t.includes('✓') || t.includes('✕') || t.includes('×')) && (t.includes('Test Files') || t.includes('PASS') || t.includes('FAIL')) }
function looksLikeTsc(t: string): boolean { return /error TS\d+:/.test(t) }
function looksLikeEslint(t: string): boolean { return /\d+:\d+\s+(error|warning)\s+/.test(t) }
function looksLikePrettier(t: string): boolean { return t.includes('[warn]') && (t.includes('needs formatting') || t.includes('Code style issues')) }
function looksLikeNextBuild(t: string): boolean { return t.includes('Next.js') && (t.includes('Route (') || t.includes('Failed to compile')) }
function looksLikePkgInstall(t: string): boolean { return /added \d+ package/.test(t) || (t.includes('packages are looking for funding') && t.split('\n').length > 5) }
function looksLikeDockerPs(t: string): boolean { return t.includes('CONTAINER ID') && t.includes('IMAGE') }
function looksLikeDockerImages(t: string): boolean { return t.includes('REPOSITORY') && t.includes('TAG') && t.includes('IMAGE ID') }
function looksLikeKubectl(t: string): boolean {
  // Be specific to avoid matching gh pr checks (NAME STATUS CONCLUSION) or similar
  return /^NAME\s+READY\s+STATUS/.test(t) || /^NAME\s+STATUS\s+ROLES/.test(t) ||
    /^NAME\s+TYPE\b/.test(t) || /^NAME\s+AGE\b/.test(t) || /^NAME\s+SHORTNAMES\b/.test(t)
}
function looksLikeGhPrChecks(t: string): boolean { return /\bCONCLUSION\b/.test(t) && /(success|failure|neutral|cancelled|skipped)/i.test(t) && !t.includes('WORKFLOW') }
function looksLikeGhPr(t: string): boolean { return t.match(/^(title|state|url):?\s/im) !== null && t.includes('github.com') }
function looksLikeGhRunList(t: string): boolean { return t.includes('STATUS') && t.includes('CONCLUSION') && t.includes('WORKFLOW') }
function looksLikeGhIssueList(t: string): boolean { return t.includes('ISSUE') && t.includes('TITLE') && t.includes('STATE') }
function looksLikeCurl(t: string): boolean { return t.includes('* Connected to') || (t.split('\n').filter(l => l.startsWith('>')).length > 3) }

// gh pr checks: compact table of check name/status/conclusion
function compactGhPrChecks(text: string): string {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length <= 25) return text
  return lines.slice(0, 25).join('\n') + `\n... [${lines.length - 25} more checks]`
}

// ── Generic error extractor (rtk err equivalent) ─────────────────────────────
// Applied before truncation when output is long and error-dense but unrecognised.
// Unique Squeezr advantage: RTK needs explicit `rtk err <cmd>` prefix; Squeezr
// detects automatically from content.

function extractGenericErrors(text: string): string {
  const lines = text.split('\n')
  if (lines.length < 30) return text
  const errorLines = lines.filter(l =>
    /\b(Error|ERROR|error|FATAL|fatal|WARN|Warning|warning|Exception|exception|failed|FAILED)\b/.test(l) &&
    !/^\s*\/\//.test(l)  // skip commented-out lines
  )
  if (errorLines.length === 0 || errorLines.length > lines.length * 0.5) return text  // not error-heavy
  // Gather errors + 1 line of context each
  const seen = new Set<number>()
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/\b(Error|ERROR|error|FATAL|fatal|Exception|exception|failed|FAILED)\b/.test(lines[i]) &&
        !/^\s*\/\//.test(lines[i])) {
      if (!seen.has(i - 1) && i > 0 && lines[i - 1].trim()) { seen.add(i - 1); out.push(lines[i - 1]) }
      seen.add(i); out.push(lines[i])
      if (i + 1 < lines.length && lines[i + 1].trim()) { seen.add(i + 1); out.push(lines[i + 1]) }
    }
  }
  const saved = lines.length - out.length
  if (out.length > 0 && saved > 10) return out.join('\n') + `\n... [${saved} non-error lines omitted]`
  return text
}

// Generic fallback: long unrecognised bash output — keep last N lines
function truncateLongOutput(text: string, pressure = 0): string {
  const threshold = pressure >= 0.9 ? 50 : 80
  const keepLines = pressure >= 0.9 ? 30 : 50
  const lines = text.split('\n')
  if (lines.length <= threshold) return text
  const omitted = lines.length - keepLines
  return `... [${omitted} earlier lines omitted]\n` + lines.slice(-keepLines).join('\n')
}

function extractInstallSummary(text: string): string {
  const lines = text.split('\n')
  return lines.filter(l => /added \d+/.test(l) || /removed \d+/.test(l) || /Done in/.test(l) || /\d+ packages? in \d/.test(l) || /warn/.test(l) || /vulnerabilit/.test(l) || /up to date/.test(l)).join('\n') || text
}

function compactFileListing(text: string): string {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 20) return text
  const byDir: Record<string, number> = {}
  for (const line of lines) {
    const parts = line.replace(/\\/g, '/').split('/')
    const dir = parts.slice(0, -1).join('/') || '.'
    byDir[dir] = (byDir[dir] ?? 0) + 1
  }
  const summary = Object.entries(byDir).sort(([, a], [, b]) => b - a).map(([d, n]) => `${d}/ (${n} files)`).join('\n')
  return `${lines.length} files total:\n${summary}`
}

function applyBashPatterns(text: string, pressure = 0): string {
  if (looksLikeGitDiff(text))       { hit('gitDiff');      return compactGitDiff(text, pressure) }
  if (looksLikeGitLog(text))        { hit('gitLog');       return compactGitLog(text, pressure) }
  if (looksLikeGitStatus(text))     { hit('gitStatus');    return compactGitStatus(text) }
  if (looksLikeGitBranch(text))     { hit('gitBranch');    return compactGitBranch(text) }
  if (looksLikeCargoTest(text))     { hit('cargoTest');    return extractCargoTestFailures(text) }
  if (looksLikeCargoBuild(text))    { hit('cargoBuild');   return extractCargoErrors(text) }
  if (looksLikeVitest(text))        { hit('vitest');       return extractVitestFailures(text) }
  if (looksLikePlaywright(text))    { hit('playwright');   return extractPlaywrightFailures(text) }
  if (looksLikePyTraceback(text))   { hit('pyTraceback');  return extractPyFailures(text) }
  if (looksLikeGoTest(text))        { hit('goTest');       return extractGoTestFailures(text) }
  if (looksLikeTsc(text))           { hit('tsc');          return compactTscErrors(text) }
  if (looksLikeEslint(text))        { hit('eslint');       return compactEslint(text) }
  if (looksLikePrettier(text))      { hit('prettier');     return compactPrettier(text) }
  if (looksLikeNextBuild(text))     { hit('nextBuild');    return compactNextBuild(text) }
  if (looksLikePkgInstall(text))    { hit('pkgInstall');   return extractInstallSummary(text) }
  if (looksLikePkgList(text))       { hit('pkgList');      return compactPkgList(text) }
  if (looksLikePkgOutdated(text))   { hit('pkgOutdated');  return compactPkgOutdated(text) }
  if (looksLikeTerraform(text))     { hit('terraform');    return compactTerraform(text) }
  if (looksLikeNpx(text))           { hit('npx');          return stripNpxNoise(text) }
  if (looksLikeDockerPs(text))      { hit('dockerPs');     return compactDockerPs(text) }
  if (looksLikeDockerImages(text))  { hit('dockerImages'); return compactDockerImages(text) }
  if (looksLikeKubectl(text))       { hit('kubectl');      return compactKubectlGet(text) }
  if (looksLikePrisma(text))        { hit('prisma');       return compactPrisma(text) }
  if (looksLikeGhPrChecks(text))   { hit('ghPrChecks');   return compactGhPrChecks(text) }
  if (looksLikeGhPr(text))          { hit('ghPr');         return compactGhPr(text) }
  if (looksLikeGhRunList(text))     { hit('ghRunList');    return compactGhRunList(text) }
  if (looksLikeGhIssueList(text))   { hit('ghIssueList');  return compactGhIssueList(text) }
  if (looksLikeCurl(text))          { hit('curl');         return compactCurlOutput(text) }
  if (looksLikeWget(text))          { hit('wget');         return compactWgetOutput(text) }
  // Generic error extractor: auto-applies rtk err logic when errors are dense
  const errExtracted = extractGenericErrors(text)
  if (errExtracted !== text)        { hit('errorExtracted'); return errExtracted }
  hit('truncated'); return truncateLongOutput(text, pressure)
}

// ── Grep tool ─────────────────────────────────────────────────────────────────

// Group matches by file, cap at MAX_PER_FILE lines each, truncate if too many files
const MAX_GREP_PER_FILE = 8
const MAX_GREP_FILES = 30

function compactGrepOutput(text: string, pressure = 0): string {
  const lines = text.split('\n').filter(Boolean)
  if (lines.length < 20) return text
  const maxPerFile = pressure >= 0.9 ? 4 : pressure >= 0.75 ? 6 : MAX_GREP_PER_FILE

  const byFile: Record<string, string[]> = {}
  const fileOrder: string[] = []

  for (const line of lines) {
    // Standard grep format: filepath:linenum:content  or  filepath:content
    const match = line.match(/^([^:]+):(\d+:)?(.*)$/)
    if (match) {
      const file = match[1]
      const content = match[3] ?? ''
      if (!byFile[file]) { byFile[file] = []; fileOrder.push(file) }
      if (byFile[file].length < maxPerFile) byFile[file].push(content.trim())
      else if (byFile[file].length === maxPerFile) byFile[file].push(`  ... (+more)`)
    } else {
      // Unformatted line — keep as-is
      const key = '__raw__'
      if (!byFile[key]) { byFile[key] = []; fileOrder.push(key) }
      byFile[key].push(line)
    }
  }

  const files = fileOrder.slice(0, MAX_GREP_FILES)
  const truncated = fileOrder.length > MAX_GREP_FILES

  const out = files.map(f => {
    if (f === '__raw__') return byFile[f].slice(0, MAX_GREP_PER_FILE).join('\n')
    return `${f} (${byFile[f].length} match${byFile[f].length !== 1 ? 'es' : ''}):\n${byFile[f].map(l => '  ' + l).join('\n')}`
  })

  if (truncated) out.push(`... [${fileOrder.length - MAX_GREP_FILES} more files]`)
  return out.join('\n\n')
}

// ── Read tool ─────────────────────────────────────────────────────────────────

// Large files: keep head + tail, note omitted lines
const READ_MAX_LINES = 200
const READ_HEAD_LINES = 100
const READ_TAIL_LINES = 80

function looksLikeLockfile(text: string): boolean {
  return text.includes('integrity sha') || text.includes('"resolved"') || text.includes('# yarn lockfile')
}

// Detect source language from first 30 lines of content
function detectCodeLanguage(text: string): 'ts' | 'py' | 'go' | 'rs' | null {
  const sample = text.split('\n').slice(0, 30).join('\n')
  if (/^import .+ from ['"]|^export (function|class|const|type|interface|default)\b|: (string|number|boolean|void|unknown)\b/.test(sample)) return 'ts'
  if (/^from \S+ import |^def \w+\(|^class \w+[:(]/.test(sample)) return 'py'
  if (/^package \w+|^func \w+\(|^\s*import \(/.test(sample)) return 'go'
  if (/^use (std|crate|self)::|^(pub\s+)?fn \w+\(|^impl\s+/.test(sample)) return 'rs'
  return null
}

// Extract top-level structural lines (imports, signatures) — bodies omitted
function extractCodeStructure(text: string, lang: 'ts' | 'py' | 'go' | 'rs'): string {
  const lines = text.split('\n')
  const checks: Record<string, (t: string) => boolean> = {
    ts: (t) => /^(import |export |async function |function |class |const |let |var |type |interface |enum |@\w)/.test(t),
    py: (t) => /^(import |from .+ import|def |class |@\w)/.test(t),
    go: (t) => /^(import|func |type |var |const |package )\b/.test(t),
    rs: (t) => /^(use |pub |fn |struct |enum |impl |trait |mod |const |static )\b/.test(t),
  }
  const check = checks[lang]
  const structural = lines.filter(l => check(l))
  if (structural.length < 2) return text  // not enough structure — fall through
  const omitted = lines.length - structural.length
  return structural.join('\n') + `\n... [${omitted} implementation lines omitted]`
}

function compactReadOutput(text: string): string {
  const lines = text.split('\n')
  if (lines.length <= READ_MAX_LINES) return text

  // Lockfiles: just show counts
  if (looksLikeLockfile(text)) {
    const pkgCount = (text.match(/^"?[a-z@]/gm) ?? []).length
    hit('readLockfile')
    return `[lockfile — ${lines.length} lines, ~${pkgCount} packages — omitted to save tokens]`
  }

  // Very large code files (>500 lines): semantic structure extraction
  if (lines.length > 500) {
    const lang = detectCodeLanguage(text)
    if (lang) {
      const structured = extractCodeStructure(text, lang)
      if (structured !== text) { hit('readSemantic'); return structured }
    }
  }

  hit('readHeadTail')
  const head = lines.slice(0, READ_HEAD_LINES)
  const tail = lines.slice(-READ_TAIL_LINES)
  const omitted = lines.length - READ_HEAD_LINES - READ_TAIL_LINES
  return [...head, `\n... [${omitted} lines omitted] ...\n`, ...tail].join('\n')
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Run all deterministic stages for a given tool result.
 * Applies base pipeline first, then tool-specific patterns.
 * Called on ALL tool results including recent ones — covers turn-1 compression
 * without the user needing to prefix commands with `rtk`.
 */
export function preprocessForTool(text: string, toolName: string, pressure = 0): string {
  let t = preprocess(text)
  const tool = toolName.toLowerCase()

  if (tool === 'bash') {
    t = applyBashPatterns(t, pressure)
  } else if (tool === 'grep') {
    const before = t
    t = compactGrepOutput(t, pressure)
    if (t !== before) hit('grepCompacted')
  } else if (tool === 'read') {
    t = compactReadOutput(t)
  } else if (tool === 'glob') {
    const lines = t.split('\n').filter(l => l.trim())
    if (lines.length > 30) { hit('globCompacted'); t = compactFileListing(t) }
  }

  return t
}
