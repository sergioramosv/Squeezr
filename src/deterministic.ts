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
  t = deduplicateLines(t)
  t = minifyJson(t)
  t = collapseWhitespace(t)
  return t
}

export function preprocessRatio(original: string, processed: string): number {
  if (!original.length) return 0
  return 1 - processed.length / original.length
}

// ── Bash: git ─────────────────────────────────────────────────────────────────

function compactGitDiff(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let contextBudget = 0
  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') ||
        line.startsWith('--- ') || line.startsWith('+++ ')) {
      out.push(line); contextBudget = 0
    } else if (line.startsWith('@@')) {
      out.push(line); contextBudget = 1
    } else if (line.startsWith('+') || line.startsWith('-')) {
      out.push(line); contextBudget = 1
    } else if (line.startsWith(' ') && contextBudget > 0) {
      out.push(line); contextBudget--
    }
  }
  return out.join('\n')
}

// compact git log: one line per commit
function compactGitLog(text: string): string {
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
  return out.join('\n') || text
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

function compactDockerLogs(text: string): string {
  // Logs are already handled well by base pipeline (dedup + timestamp strip)
  // Just cap to last 50 lines if very long
  const lines = text.split('\n')
  if (lines.length <= 50) return text
  return `... [${lines.length - 50} earlier lines omitted]\n` + lines.slice(-50).join('\n')
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
function looksLikeGitLog(t: string): boolean { return t.startsWith('commit ') && t.includes('Author:') && t.includes('Date:') }
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
function looksLikeDockerLogs(t: string): boolean { return t.split('\n').length > 50 }
function looksLikeKubectl(t: string): boolean { return /^(NAME\s+READY|NAME\s+STATUS|NAME\s+AGE)/.test(t) }
function looksLikeGhPr(t: string): boolean { return t.match(/^(title|state|url):?\s/im) !== null && t.includes('github.com') }
function looksLikeGhRunList(t: string): boolean { return t.includes('STATUS') && t.includes('CONCLUSION') && t.includes('WORKFLOW') }
function looksLikeGhIssueList(t: string): boolean { return t.includes('ISSUE') && t.includes('TITLE') && t.includes('STATE') }
function looksLikeCurl(t: string): boolean { return t.includes('* Connected to') || (t.split('\n').filter(l => l.startsWith('>')).length > 3) }

function extractInstallSummary(text: string): string {
  const lines = text.split('\n')
  return lines.filter(l => /added \d+/.test(l) || /removed \d+/.test(l) || /Done in/.test(l) || /\d+ packages? in/.test(l) || /warn/.test(l) || /vulnerabilit/.test(l) || /up to date/.test(l)).join('\n') || text
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

function applyBashPatterns(text: string): string {
  if (looksLikeGitDiff(text))     return compactGitDiff(text)
  if (looksLikeGitLog(text))      return compactGitLog(text)
  if (looksLikeCargoTest(text))   return extractCargoTestFailures(text)
  if (looksLikeCargoBuild(text))  return extractCargoErrors(text)
  if (looksLikeVitest(text))      return extractVitestFailures(text)
  if (looksLikeTsc(text))         return compactTscErrors(text)
  if (looksLikeEslint(text))      return compactEslint(text)
  if (looksLikePrettier(text))    return compactPrettier(text)
  if (looksLikeNextBuild(text))   return compactNextBuild(text)
  if (looksLikePkgInstall(text))  return extractInstallSummary(text)
  if (looksLikeDockerPs(text))    return compactDockerPs(text)
  if (looksLikeDockerImages(text))return compactDockerImages(text)
  if (looksLikeDockerLogs(text))  return compactDockerLogs(text)
  if (looksLikeKubectl(text))     return compactKubectlGet(text)
  if (looksLikeGhPr(text))        return compactGhPr(text)
  if (looksLikeGhRunList(text))   return compactGhRunList(text)
  if (looksLikeGhIssueList(text)) return compactGhIssueList(text)
  if (looksLikeCurl(text))        return compactCurlOutput(text)
  return text
}

// ── Grep tool ─────────────────────────────────────────────────────────────────

// Group matches by file, cap at MAX_PER_FILE lines each, truncate if too many files
const MAX_GREP_PER_FILE = 8
const MAX_GREP_FILES = 30

function compactGrepOutput(text: string): string {
  const lines = text.split('\n').filter(Boolean)
  if (lines.length < 20) return text

  const byFile: Record<string, string[]> = {}
  const fileOrder: string[] = []

  for (const line of lines) {
    // Standard grep format: filepath:linenum:content  or  filepath:content
    const match = line.match(/^([^:]+):(\d+:)?(.*)$/)
    if (match) {
      const file = match[1]
      const content = match[3] ?? ''
      if (!byFile[file]) { byFile[file] = []; fileOrder.push(file) }
      if (byFile[file].length < MAX_GREP_PER_FILE) byFile[file].push(content.trim())
      else if (byFile[file].length === MAX_GREP_PER_FILE) byFile[file].push(`  ... (+more)`)
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

function compactReadOutput(text: string): string {
  const lines = text.split('\n')
  if (lines.length <= READ_MAX_LINES) return text

  // Lockfiles: just show counts
  if (looksLikeLockfile(text)) {
    const pkgCount = (text.match(/^"?[a-z@]/gm) ?? []).length
    return `[lockfile — ${lines.length} lines, ~${pkgCount} packages — omitted to save tokens]`
  }

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
export function preprocessForTool(text: string, toolName: string): string {
  let t = preprocess(text)
  const tool = toolName.toLowerCase()

  if (tool === 'bash') {
    t = applyBashPatterns(t)
  } else if (tool === 'grep') {
    t = compactGrepOutput(t)
  } else if (tool === 'read') {
    t = compactReadOutput(t)
  } else if (tool === 'glob') {
    if (t.split('\n').filter(l => l.trim()).length > 30) t = compactFileListing(t)
  }

  return t
}
