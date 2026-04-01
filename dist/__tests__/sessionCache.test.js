import { describe, it, expect, beforeEach } from 'vitest';
import { hashText, getBlock, setBlock, sessionCacheSize, clearSessionCache, } from '../sessionCache.js';
describe('sessionCache', () => {
    beforeEach(() => {
        clearSessionCache();
    });
    describe('hashText', () => {
        it('returns a non-empty string', () => {
            expect(hashText('hello')).toBeTruthy();
        });
        it('is deterministic — same input always same hash', () => {
            expect(hashText('foo bar')).toBe(hashText('foo bar'));
        });
        it('produces different hashes for different inputs', () => {
            expect(hashText('abc')).not.toBe(hashText('def'));
        });
        it('returns a 32-char hex string (MD5)', () => {
            expect(hashText('test')).toMatch(/^[a-f0-9]{32}$/);
        });
    });
    describe('getBlock / setBlock', () => {
        it('returns undefined for unknown hash', () => {
            expect(getBlock('nonexistent')).toBeUndefined();
        });
        it('stores and retrieves a block', () => {
            const block = { fullString: '[squeezr:abc123 -80%] summary', savedChars: 100, originalChars: 500 };
            setBlock('key1', block);
            expect(getBlock('key1')).toEqual(block);
        });
        it('overwrites existing block', () => {
            const block1 = { fullString: 'first', savedChars: 10, originalChars: 50 };
            const block2 = { fullString: 'second', savedChars: 20, originalChars: 50 };
            setBlock('k', block1);
            setBlock('k', block2);
            expect(getBlock('k')).toEqual(block2);
        });
        it('stores multiple independent blocks', () => {
            setBlock('k1', { fullString: 'a', savedChars: 1, originalChars: 10 });
            setBlock('k2', { fullString: 'b', savedChars: 2, originalChars: 20 });
            expect(getBlock('k1')?.fullString).toBe('a');
            expect(getBlock('k2')?.fullString).toBe('b');
        });
    });
    describe('sessionCacheSize', () => {
        it('starts at 0 after clear', () => {
            expect(sessionCacheSize()).toBe(0);
        });
        it('increments on new entries', () => {
            setBlock('a', { fullString: 'x', savedChars: 1, originalChars: 10 });
            expect(sessionCacheSize()).toBe(1);
            setBlock('b', { fullString: 'y', savedChars: 1, originalChars: 10 });
            expect(sessionCacheSize()).toBe(2);
        });
        it('does not increment on overwrite', () => {
            setBlock('a', { fullString: 'x', savedChars: 1, originalChars: 10 });
            setBlock('a', { fullString: 'y', savedChars: 2, originalChars: 10 });
            expect(sessionCacheSize()).toBe(1);
        });
    });
    describe('clearSessionCache', () => {
        it('resets size to 0', () => {
            setBlock('x', { fullString: 'y', savedChars: 1, originalChars: 10 });
            clearSessionCache();
            expect(sessionCacheSize()).toBe(0);
        });
        it('makes previously set blocks unretrievable', () => {
            setBlock('k', { fullString: 'v', savedChars: 1, originalChars: 10 });
            clearSessionCache();
            expect(getBlock('k')).toBeUndefined();
        });
    });
});
