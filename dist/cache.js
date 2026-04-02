import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const DEFAULT_CACHE_PATH = join(homedir(), '.squeezr', 'cache.json');
export class CompressionCache {
    maxEntries;
    store = new Map();
    hits = 0;
    misses = 0;
    cachePath;
    constructor(maxEntries, cachePath = DEFAULT_CACHE_PATH) {
        this.maxEntries = maxEntries;
        this.cachePath = cachePath;
        this.load();
    }
    key(text) {
        return createHash('md5').update(text).digest('hex');
    }
    get(text) {
        const entry = this.store.get(this.key(text));
        if (entry) {
            entry.hits++;
            this.hits++;
            return entry.compressed;
        }
        this.misses++;
        return undefined;
    }
    set(text, compressed) {
        if (this.store.size >= this.maxEntries) {
            const oldest = [...this.store.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
            this.store.delete(oldest[0]);
        }
        this.store.set(this.key(text), { compressed, ts: Date.now(), hits: 0 });
        this.persist();
    }
    stats() {
        const total = this.hits + this.misses;
        return {
            size: this.store.size,
            hits: this.hits,
            misses: this.misses,
            hit_rate_pct: total > 0 ? Math.round((this.hits / total) * 1000) / 10 : 0,
        };
    }
    load() {
        try {
            if (existsSync(this.cachePath)) {
                const raw = JSON.parse(readFileSync(this.cachePath, 'utf-8'));
                for (const [k, v] of Object.entries(raw)) {
                    this.store.set(k, v);
                }
            }
        }
        catch { /* ignore */ }
    }
    persist() {
        try {
            const dir = join(homedir(), '.squeezr');
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(this.cachePath, JSON.stringify(Object.fromEntries(this.store)));
        }
        catch { /* ignore */ }
    }
}
