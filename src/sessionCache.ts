import { createHash } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SESSION_CACHE_PATH = join(homedir(), '.squeezr', 'session_cache.json')

/**
 * Session-level cache for compressed blocks.
 *
 * Two problems solved together:
 *
 * 1. Differential compression: tracks which message contents were seen in
 *    previous requests. On request N+1, blocks identical to request N skip
 *    the entire compression pipeline (preprocessing + AI call + LRU lookup).
 *
 * 2. KV cache warming: reuses the exact same compressed string (including
 *    the squeezr:id prefix) for unchanged blocks. Because Anthropic's KV
 *    cache activates only when the message prefix is byte-for-byte identical
 *    between requests, reusing the same compressed string preserves the cache
 *    hit for the entire prior history (90% cost reduction on those tokens).
 *
 * Without this: even if a block was already compressed, compressing it again
 * would produce a different random ID → different bytes → KV cache miss for
 * everything that follows in the conversation.
 */

export interface SessionBlock {
  /** Exact string to embed: "[squeezr:id -ratio%] result" */
  fullString: string
  savedChars: number
  originalChars: number
}

const CACHE_MAX_ENTRIES = 2000  // LRU cap — prevents unbounded growth across sessions

const cache = new Map<string, SessionBlock>()

export function hashText(text: string): string {
  return createHash('md5').update(text).digest('hex')
}

export function getBlock(hash: string): SessionBlock | undefined {
  const block = cache.get(hash)
  if (block) {
    // LRU: move to end on access
    cache.delete(hash)
    cache.set(hash, block)
  }
  return block
}

export function setBlock(hash: string, block: SessionBlock): void {
  if (cache.has(hash)) cache.delete(hash)  // refresh position
  cache.set(hash, block)
  // Evict oldest entries when over cap
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

export function sessionCacheSize(): number {
  return cache.size
}

export function clearSessionCache(): void {
  cache.clear()
}

export function loadSessionCache(): void {
  try {
    if (existsSync(SESSION_CACHE_PATH)) {
      const raw = JSON.parse(readFileSync(SESSION_CACHE_PATH, 'utf-8'))
      for (const [k, v] of Object.entries(raw)) {
        cache.set(k, v as SessionBlock)
      }
      if (cache.size > 0) console.log(`[squeezr] Loaded ${cache.size} session cache entries from disk`)
    }
  } catch { /* ignore */ }
}

export function persistSessionCache(): void {
  try {
    const dir = join(homedir(), '.squeezr')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(SESSION_CACHE_PATH, JSON.stringify(Object.fromEntries(cache)))
  } catch { /* ignore */ }
}
