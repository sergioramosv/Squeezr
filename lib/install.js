'use strict'

const { execSync } = require('child_process')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const REQ = path.join(ROOT, 'requirements.txt')

function findPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const out = execSync(`${cmd} --version`, { stdio: 'pipe' }).toString()
      const match = out.match(/(\d+)\.(\d+)/)
      if (match && parseInt(match[1]) >= 3 && parseInt(match[2]) >= 9) {
        return cmd
      }
    } catch {}
  }
  return null
}

function findPip(python) {
  // Try pip module first (most reliable cross-platform)
  try {
    execSync(`${python} -m pip --version`, { stdio: 'pipe' })
    return `${python} -m pip`
  } catch {}
  for (const cmd of ['pip3', 'pip']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' })
      return cmd
    } catch {}
  }
  return null
}

console.log('[squeezr] Checking Python...')

const python = findPython()
if (!python) {
  console.warn('[squeezr] Warning: Python 3.9+ not found.')
  console.warn('[squeezr] Install it from https://python.org, then run:')
  console.warn(`[squeezr]   pip install -r "${REQ}"`)
  process.exit(0)
}

console.log(`[squeezr] Found ${python}. Installing Python dependencies...`)

const pip = findPip(python)
if (!pip) {
  console.warn('[squeezr] Warning: pip not found. Run manually:')
  console.warn(`[squeezr]   pip install -r "${REQ}"`)
  process.exit(0)
}

try {
  execSync(`${pip} install -r "${REQ}" --quiet`, { stdio: 'inherit' })
  console.log('[squeezr] Python dependencies installed.')
  console.log('[squeezr] Ready. Run: squeezr start')
} catch {
  console.warn('[squeezr] Could not install Python deps automatically. Run manually:')
  console.warn(`[squeezr]   pip install -r "${REQ}"`)
}
