import { createHash } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CACHE_FILE = join(homedir(), '.squeezr', 'cache.json')

interface CacheEntry {
  compressed: string
  ts: number
  hits: number
}

export class CompressionCache {
  private store = new Map<string, CacheEntry>()
  private hits = 0
  private misses = 0

  constructor(private maxEntries: number) {
    this.load()
  }

  private key(text: string): string {
    return createHash('md5').update(text).digest('hex')
  }

  get(text: string): string | undefined {
    const entry = this.store.get(this.key(text))
    if (entry) {
      entry.hits++
      this.hits++
      return entry.compressed
    }
    this.misses++
    return undefined
  }

  set(text: string, compressed: string): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = [...this.store.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
      this.store.delete(oldest[0])
    }
    this.store.set(this.key(text), { compressed, ts: Date.now(), hits: 0 })
    this.persist()
  }

  stats() {
    const total = this.hits + this.misses
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hit_rate_pct: total > 0 ? Math.round((this.hits / total) * 1000) / 10 : 0,
    }
  }

  private load(): void {
    try {
      if (existsSync(CACHE_FILE)) {
        const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
        for (const [k, v] of Object.entries(raw)) {
          this.store.set(k, v as CacheEntry)
        }
      }
    } catch { /* ignore */ }
  }

  private persist(): void {
    try {
      const dir = join(homedir(), '.squeezr')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(this.store)))
    } catch { /* ignore */ }
  }
}
