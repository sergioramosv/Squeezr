import { createHash } from 'crypto'

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

const cache = new Map<string, SessionBlock>()

export function hashText(text: string): string {
  return createHash('md5').update(text).digest('hex')
}

export function getBlock(hash: string): SessionBlock | undefined {
  return cache.get(hash)
}

export function setBlock(hash: string, block: SessionBlock): void {
  cache.set(hash, block)
}

export function sessionCacheSize(): number {
  return cache.size
}
