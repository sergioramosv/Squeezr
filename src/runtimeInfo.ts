import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { VERSION } from './version.js'

/**
 * Writes the actual runtime port to ~/.squeezr/runtime.json so external tools
 * (shell wrappers, auto-heal scripts, other CLIs) can discover where squeezr
 * is currently bound — even when findFreePort drifted away from the configured
 * port. This is the file that lets the bash wrapper resync env vars on every
 * new shell.
 */

export const RUNTIME_FILE = join(homedir(), '.squeezr', 'runtime.json')

export interface RuntimeInfo {
  pid: number
  port: number
  mitmPort: number
  version: string
  startedAt: string
}

export function writeRuntimeInfo(info: Omit<RuntimeInfo, 'version' | 'startedAt'>): void {
  try {
    mkdirSync(join(homedir(), '.squeezr'), { recursive: true })
    const payload: RuntimeInfo = {
      ...info,
      version: VERSION,
      startedAt: new Date().toISOString(),
    }
    writeFileSync(RUNTIME_FILE, JSON.stringify(payload, null, 2))
  } catch {
    // Non-fatal: runtime info is convenience, not correctness.
  }
}

export function clearRuntimeInfo(): void {
  try { unlinkSync(RUNTIME_FILE) } catch {}
}
