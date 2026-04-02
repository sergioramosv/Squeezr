import { describe, it, expect, beforeEach } from 'vitest';
import { CompressionCache } from '../cache.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Use a unique temp path per test run so no disk state bleeds between tests
const tmpPath = () => join(tmpdir(), `squeezr-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
describe('CompressionCache', () => {
    let cache;
    beforeEach(() => {
        // maxEntries=5, isolated temp file — no disk bleed between runs
        cache = new CompressionCache(5, tmpPath());
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
        expect(cache.stats().size).toBe(5);
        // Add one more — oldest ('a') should be evicted
        cache.set('f', '6');
        expect(cache.stats().size).toBe(5);
        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('f')).toBe('6');
    });
    it('reports correct size after additions', () => {
        expect(cache.stats().size).toBe(0); // fresh isolated cache
        cache.set('key1', 'val1');
        expect(cache.stats().size).toBe(1);
        cache.set('key2', 'val2');
        expect(cache.stats().size).toBe(2);
    });
    it('overwrites existing entry without growing size', () => {
        cache.set('key', 'first');
        expect(cache.stats().size).toBe(1);
        cache.set('key', 'second');
        expect(cache.get('key')).toBe('second');
        expect(cache.stats().size).toBe(1);
    });
    it('different texts produce different cache entries', () => {
        cache.set('text1', 'compressed1');
        cache.set('text2', 'compressed2');
        expect(cache.get('text1')).toBe('compressed1');
        expect(cache.get('text2')).toBe('compressed2');
    });
});
