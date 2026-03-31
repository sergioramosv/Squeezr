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
 *    Covers: git diff, cargo build/test/clippy, vitest/jest, tsc, eslint/biome,
 *            pnpm/npm install, glob listings.
 */

// ── Base pipeline ─────────────────────────────────────────────────────────────

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
    .replace(/\x1B\][^\x07]*\x07/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

function stripProgressBars(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const stripped = line.replace(/[\s=\-#░█▓▒▌▐►◄|]/g, '')
      return stripped.length > line.length * 0.3 || stripped.length > 5
    })
    .join('\n')
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

// ── Tool-specific patterns ────────────────────────────────────────────────────

// git diff: keep only changed lines + hunk headers, max 1 context line per hunk
function compactGitDiff(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let contextBudget = 0

  for (const line of lines) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      out.push(line)
      contextBudget = 0
    } else if (line.startsWith('@@')) {
      out.push(line)
      contextBudget = 1  // allow 1 context line after each hunk header
    } else if (line.startsWith('+') || line.startsWith('-')) {
      out.push(line)
      contextBudget = 1
    } else if (line.startsWith(' ') && contextBudget > 0) {
      out.push(line)
      contextBudget--
    }
    // skip context lines beyond budget
  }
  return out.join('\n')
}

// cargo test: failures + summary only
function extractCargoTestFailures(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inFailureBlock = false

  for (const line of lines) {
    if (line.includes('FAILED') || line.includes('error[') || line.includes('panicked at')) {
      out.push(line)
      inFailureBlock = true
    } else if (line.startsWith('---- ') && line.endsWith(' stdout ----')) {
      out.push(line)
      inFailureBlock = true
    } else if (line.startsWith('test result:') || line.startsWith('failures:') || line.startsWith('error: test failed')) {
      out.push(line)
      inFailureBlock = false
    } else if (inFailureBlock && line.trim() !== '') {
      out.push(line)
    } else if (line.trim() === '') {
      inFailureBlock = false
    }
  }

  if (out.length === 0) {
    const summary = lines.find(l => l.startsWith('test result:'))
    return summary ?? text
  }
  return out.join('\n')
}

// cargo build / check / clippy: errors and warnings grouped, no "Compiling X" spam
function extractCargoErrors(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inDiagnostic = false

  for (const line of lines) {
    if (/^error(\[E\d+\])?:/.test(line) || /^warning(\[.*?\])?:/.test(line)) {
      out.push(line)
      inDiagnostic = true
    } else if (line.startsWith('  -->') || line.startsWith('   |') || line.startsWith('   =')) {
      if (inDiagnostic) out.push(line)
    } else if (line.startsWith('error: aborting') || line.startsWith('error: could not compile')) {
      out.push(line)
      inDiagnostic = false
    } else if (line.trim() === '') {
      inDiagnostic = false
    }
    // skip: "Compiling X", "Checking X", "Finished", "warning: unused import" boilerplate
  }

  if (out.length === 0) {
    const summary = lines.find(l => l.includes('Finished') || l.includes('error: could not compile'))
    return summary ?? text
  }
  return out.join('\n')
}

// vitest / jest: failures only + summary
function extractVitestFailures(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inFailure = false

  for (const line of lines) {
    const isFailLine = line.includes('×') || line.includes('✕') ||
      line.match(/\bFAIL\b/) !== null || line.includes('AssertionError') ||
      line.includes('Error:') || line.includes('Expected') || line.includes('Received')
    const isSummary = line.match(/^(Test Files|Tests|Duration|Suites)/) !== null

    if (isFailLine) {
      out.push(line)
      inFailure = true
    } else if (isSummary) {
      out.push(line)
      inFailure = false
    } else if (inFailure && line.trim() !== '') {
      out.push(line)
    } else if (line.trim() === '') {
      inFailure = false
    }
  }

  if (out.length === 0) {
    // all passed — just the summary
    const summaryLines = lines.filter(l => l.match(/^(Test Files|Tests|Duration)/))
    return summaryLines.join('\n') || text
  }
  return out.join('\n')
}

// tsc: group errors by file, strip verbose context
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
    .map(([file, errs]) => `${file}: ${errs.length} error(s)\n${errs.slice(0, 5).map(e => '  ' + e).join('\n')}`)
    .join('\n')
}

// eslint / biome: group by file, strip rule explanation URLs
function compactEslint(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let currentFile = ''

  for (const line of lines) {
    // File header (absolute path or relative)
    if (/^[/\\]/.test(line) || /^\w:/.test(line) || line.endsWith('.ts') || line.endsWith('.js') || line.endsWith('.tsx')) {
      if (line.trim() && !line.includes(':')) {
        currentFile = line.trim()
        out.push(line)
        continue
      }
    }
    // Error/warning line
    if (line.match(/\d+:\d+\s+(error|warning)/)) {
      // Strip rule URL if present
      out.push(line.replace(/\s+https?:\/\/\S+/g, ''))
      continue
    }
    // Summary line
    if (line.match(/\d+ (problem|error|warning)/)) {
      out.push(line)
    }
    // Skip blank lines and decorative separators
  }

  return out.join('\n') || text
}

// pnpm / npm install: summary only
function extractInstallSummary(text: string): string {
  const lines = text.split('\n')
  const keep = lines.filter(l =>
    /added \d+/.test(l) ||
    /removed \d+/.test(l) ||
    /Done in/.test(l) ||
    /\d+ packages? in/.test(l) ||
    /warn/.test(l) ||
    /vulnerabilit/.test(l) ||
    /up to date/.test(l)
  )
  return keep.join('\n') || text
}

// glob / ls: compact file listings by grouping under directories
function compactFileListing(text: string): string {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 20) return text  // not worth compacting small listings

  const byDir: Record<string, number> = {}
  for (const line of lines) {
    const parts = line.replace(/\\/g, '/').split('/')
    const dir = parts.slice(0, -1).join('/') || '.'
    byDir[dir] = (byDir[dir] ?? 0) + 1
  }

  const dirSummary = Object.entries(byDir)
    .sort(([, a], [, b]) => b - a)
    .map(([dir, count]) => `${dir}/ (${count} files)`)
    .join('\n')

  return `${lines.length} files total:\n${dirSummary}`
}

// ── Detection helpers ─────────────────────────────────────────────────────────

function looksLikeGitDiff(text: string): boolean {
  return text.includes('diff --git') || (text.includes('--- a/') && text.includes('+++ b/'))
}

function looksLikeCargoTest(text: string): boolean {
  return /test .+\.\.\. (ok|FAILED)/.test(text) || text.includes('running \d+ test')
}

function looksLikeCargoBuild(text: string): boolean {
  return /error\[E\d+\]/.test(text) || (text.includes('Compiling') && text.includes('error'))
}

function looksLikeVitest(text: string): boolean {
  return (text.includes('✓') || text.includes('✕') || text.includes('×')) &&
    (text.includes('Test Files') || text.includes('PASS') || text.includes('FAIL'))
}

function looksLikeTsc(text: string): boolean {
  return /error TS\d+:/.test(text)
}

function looksLikeEslint(text: string): boolean {
  return /\d+:\d+\s+(error|warning)\s+/.test(text) && text.includes('rule')
}

function looksLikePkgInstall(text: string): boolean {
  return (/added \d+ package/.test(text) || text.includes('packages are looking for funding')) &&
    text.split('\n').length > 5
}

function looksLikeFileListing(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim())
  return lines.length > 30 && lines.every(l => !l.includes(' ') || l.match(/\.(ts|js|tsx|jsx|py|rs|go|json|md)/) !== null)
}

function applyBashPatterns(text: string): string {
  if (looksLikeGitDiff(text)) return compactGitDiff(text)
  if (looksLikeCargoTest(text)) return extractCargoTestFailures(text)
  if (looksLikeCargoBuild(text)) return extractCargoErrors(text)
  if (looksLikeVitest(text)) return extractVitestFailures(text)
  if (looksLikeTsc(text)) return compactTscErrors(text)
  if (looksLikeEslint(text)) return compactEslint(text)
  if (looksLikePkgInstall(text)) return extractInstallSummary(text)
  return text
}

/**
 * Run all deterministic stages for a given tool result.
 * Applies base pipeline first, then tool-specific patterns.
 * Called on ALL tool results — including recent ones — so Squeezr
 * covers turn-1 compression without the user running `rtk`.
 */
export function preprocessForTool(text: string, toolName: string): string {
  let t = preprocess(text)
  const tool = toolName.toLowerCase()

  if (tool === 'bash') {
    t = applyBashPatterns(t)
  } else if (tool === 'glob') {
    if (looksLikeFileListing(t)) t = compactFileListing(t)
  }
  // Read, Grep, Edit, Write: base pipeline is sufficient

  return t
}
