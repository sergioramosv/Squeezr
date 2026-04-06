/**
 * Squeezr History — per-session, per-project persistence
 *
 * Tracks which project each request belongs to (extracted from the system
 * prompt CWD by server.ts) and stores historical sessions in:
 *   ~/.squeezr/history.json
 *
 * One "session" = one proxy run (process lifetime).
 * Sessions accumulate stats per project. History survives across restarts.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HISTORY_FILE = join(homedir(), '.squeezr', 'history.json')
const CHARS_PER_TOKEN = 3.5
const MAX_SESSIONS = 500

export interface SessionRecord {
  id: string
  project: string
  startTime: number  // epoch ms
  endTime: number    // epoch ms — updated on every flush
  requests: number
  savedChars: number
  savedTokens: number
  compressions: number
  byTool: Record<string, { count: number; savedTokens: number }>
}

interface HistoryFile {
  sessions: SessionRecord[]
}

// ── Current session (in memory) ────────────────────────────────────────────────

const SESSION_ID = Math.random().toString(36).slice(2, 10)
const SESSION_START = Date.now()
let currentProject = 'unknown'
let currentRequests = 0
let currentSavedChars = 0
let currentCompressions = 0
const currentByTool: Record<string, { count: number; savedTokens: number }> = {}

let store: HistoryFile = { sessions: [] }

// ── Load / persist ─────────────────────────────────────────────────────────────

export function loadHistory(): void {
  try {
    if (existsSync(HISTORY_FILE)) {
      const raw = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8')) as Partial<HistoryFile>
      store = { sessions: raw.sessions ?? [] }
    }
  } catch {
    store = { sessions: [] }
  }
}

export function persistHistory(): void {
  try {
    const dir = join(homedir(), '.squeezr')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const record = buildCurrentRecord()
    const idx = store.sessions.findIndex(s => s.id === SESSION_ID)
    if (idx >= 0) {
      store.sessions[idx] = record
    } else {
      store.sessions.push(record)
    }

    // Keep last MAX_SESSIONS to avoid unbounded growth
    if (store.sessions.length > MAX_SESSIONS) {
      store.sessions = store.sessions.slice(-MAX_SESSIONS)
    }

    writeFileSync(HISTORY_FILE, JSON.stringify(store))
  } catch { /* ignore */ }
}

// ── Record a request ───────────────────────────────────────────────────────────

export function recordRequest(
  project: string,
  savedChars: number,
  compressions: number,
  byTool: Array<{ tool: string; savedChars: number }>,
): void {
  if (project !== 'unknown') currentProject = project
  currentRequests++
  currentSavedChars += savedChars
  currentCompressions += compressions
  for (const { tool, savedChars: sc } of byTool) {
    if (!currentByTool[tool]) currentByTool[tool] = { count: 0, savedTokens: 0 }
    currentByTool[tool].count++
    currentByTool[tool].savedTokens += Math.round(sc / CHARS_PER_TOKEN)
  }
}

// ── Getters ────────────────────────────────────────────────────────────────────

function buildCurrentRecord(): SessionRecord {
  return {
    id: SESSION_ID,
    project: currentProject,
    startTime: SESSION_START,
    endTime: Date.now(),
    requests: currentRequests,
    savedChars: currentSavedChars,
    savedTokens: Math.round(currentSavedChars / CHARS_PER_TOKEN),
    compressions: currentCompressions,
    byTool: { ...currentByTool },
  }
}

/** All historical sessions (does NOT include current in-flight session). */
export function getHistorySessions(): SessionRecord[] {
  return store.sessions
}

/** Current in-flight session snapshot. */
export function getCurrentSession(): SessionRecord {
  return buildCurrentRecord()
}

/**
 * Aggregate stats per project across ALL sessions (historical + current).
 * Used by the Projects dashboard page.
 */
export function getProjectAggregates(): Record<string, {
  sessions: number
  requests: number
  savedTokens: number
  lastSeen: number
}> {
  const all = mergeCurrentIntoHistory()
  const agg: Record<string, { sessions: number; requests: number; savedTokens: number; lastSeen: number }> = {}

  for (const s of all) {
    if (s.requests === 0) continue
    const p = s.project
    if (!agg[p]) agg[p] = { sessions: 0, requests: 0, savedTokens: 0, lastSeen: 0 }
    agg[p].sessions++
    agg[p].requests += s.requests
    agg[p].savedTokens += s.savedTokens
    agg[p].lastSeen = Math.max(agg[p].lastSeen, s.endTime)
  }
  return agg
}

/**
 * All sessions for the History dashboard page (historical + current),
 * newest first.
 */
export function getAllSessionsForHistory(): SessionRecord[] {
  return mergeCurrentIntoHistory().slice().reverse()
}

function mergeCurrentIntoHistory(): SessionRecord[] {
  const cur = buildCurrentRecord()
  const list = store.sessions.filter(s => s.id !== SESSION_ID)
  list.push(cur)
  return list
}
