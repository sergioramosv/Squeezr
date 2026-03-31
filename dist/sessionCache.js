import { createHash } from 'crypto';
const cache = new Map();
export function hashText(text) {
    return createHash('md5').update(text).digest('hex');
}
export function getBlock(hash) {
    return cache.get(hash);
}
export function setBlock(hash, block) {
    cache.set(hash, block);
}
export function sessionCacheSize() {
    return cache.size;
}
