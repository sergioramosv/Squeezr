export declare class CompressionCache {
    private maxEntries;
    private store;
    private hits;
    private misses;
    private readonly cachePath;
    constructor(maxEntries: number, cachePath?: string);
    private key;
    get(text: string): string | undefined;
    set(text: string, compressed: string): void;
    stats(): {
        size: number;
        hits: number;
        misses: number;
        hit_rate_pct: number;
    };
    private load;
    private persist;
}
