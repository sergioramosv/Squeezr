import { describe, it, expect, beforeEach } from 'vitest';
import { CompressionCache } from '../cache.js';
describe('CompressionCache', () => {
    let cache;
    beforeEach(() => {
        // maxEntries=5 for fast LRU testing; file I/O fails silently in test env
        cache = new CompressionCache(5);
    });
    it('returns undefined for a cache miss', () => {
        expect(cache.get('never stored this')).toBeUndefined();
    });
    it('returns the compressed value after set', () => {
        cache.set('original text', 'compressed');
        expect(cache.get('original text')).toBe('compressed');
    });
    it('is keyed by text content, not reference', () => {
        cache.set('hello world', 'hi');
        expect(cache.get('hello' + ' ' + 'world')).toBe('hi');
    });
    it('tracks hit and miss counts', () => {
        cache.set('foo', 'bar');
        cache.get('foo'); // hit
        cache.get('foo'); // hit
        cache.get('miss'); // miss
        const s = cache.stats();
        expect(s.hits).toBe(2);
        expect(s.misses).toBe(1);
    });
    it('calculates hit rate correctly', () => {
        cache.set('a', 'x');
        cache.get('a'); // hit
        cache.get('b'); // miss
        const s = cache.stats();
        expect(s.hit_rate_pct).toBe(50);
    });
    it('hit rate is 0 when no requests', () => {
        expect(cache.stats().hit_rate_pct).toBe(0);
    });
    it('evicts oldest entry when maxEntries is reached', () => {
        cache.set('a', '1');
        cache.set('b', '2');
        cache.set('c', '3');
        cache.set('d', '4');
        cache.set('e', '5');
        // All 5 entries stored
        expect(cache.stats().size).toBe(5);
        // Add one more — oldest ('a') should be evicted
        cache.set('f', '6');
        expect(cache.stats().size).toBe(5);
        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('f')).toBe('6');
    });
    it('reports correct size (relative to initial)', () => {
        // Use a large maxEntries so LRU eviction doesn't interfere
        const bigCache = new CompressionCache(1000);
        const initialSize = bigCache.stats().size;
        bigCache.set('unique-key-x-' + Date.now(), 'y');
        expect(bigCache.stats().size).toBe(initialSize + 1);
        bigCache.set('unique-key-z-' + Date.now(), 'w');
        expect(bigCache.stats().size).toBe(initialSize + 2);
    });
    it('overwrites existing entry', () => {
        cache.set('key', 'first');
        cache.set('key', 'second');
        expect(cache.get('key')).toBe('second');
    });
    it('different texts produce different cache entries', () => {
        cache.set('text1', 'compressed1');
        cache.set('text2', 'compressed2');
        expect(cache.get('text1')).toBe('compressed1');
        expect(cache.get('text2')).toBe('compressed2');
    });
});
