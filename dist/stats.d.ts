import type { Savings } from './compressor.js';
export declare class Stats {
    private requests;
    private totalOriginalChars;
    private totalCompressedChars;
    private totalCompressions;
    private byTool;
    private sessionStart;
    record(originalChars: number, compressedChars: number, savings: Savings): void;
    summary(): {
        requests: number;
        compressions: number;
        total_original_chars: number;
        total_saved_chars: number;
        total_saved_tokens: number;
        savings_pct: number;
        uptime_seconds: number;
        by_tool: Record<string, {
            count: number;
            saved_chars: number;
            saved_tokens: number;
            avg_pct: number;
        }>;
    };
    private persist;
    static loadGlobal(): Record<string, unknown>;
}
