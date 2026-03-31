import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const STATS_FILE = join(homedir(), '.squeezr', 'stats.json');
const CHARS_PER_TOKEN = 3.5;
export class Stats {
    requests = 0;
    totalOriginalChars = 0;
    totalCompressedChars = 0;
    totalCompressions = 0;
    totalSessionCacheHits = 0;
    byTool = {};
    sessionStart = Date.now();
    record(originalChars, compressedChars, savings) {
        this.requests++;
        this.totalOriginalChars += originalChars;
        this.totalCompressedChars += compressedChars;
        this.totalCompressions += savings.compressed;
        this.totalSessionCacheHits += savings.sessionCacheHits;
        for (const entry of savings.byTool) {
            if (!this.byTool[entry.tool])
                this.byTool[entry.tool] = { count: 0, savedChars: 0, originalChars: 0 };
            this.byTool[entry.tool].count++;
            this.byTool[entry.tool].savedChars += entry.savedChars;
            this.byTool[entry.tool].originalChars += entry.originalChars;
        }
        if (savings.savedChars > 0) {
            const pct = Math.round((savings.savedChars / Math.max(savings.originalChars, 1)) * 100);
            const tokens = Math.round(savings.savedChars / CHARS_PER_TOKEN);
            console.log(`[squeezr] ${savings.compressed} block(s) compressed | -${savings.savedChars.toLocaleString()} chars (~${tokens.toLocaleString()} tokens) (${pct}% saved)`);
        }
        this.persist();
    }
    summary() {
        const totalSaved = this.totalOriginalChars - this.totalCompressedChars;
        const pct = this.totalOriginalChars > 0 ? Math.round((totalSaved / this.totalOriginalChars) * 1000) / 10 : 0;
        const byToolOut = {};
        for (const [tool, data] of Object.entries(this.byTool)) {
            byToolOut[tool] = {
                count: data.count,
                saved_chars: data.savedChars,
                saved_tokens: Math.round(data.savedChars / CHARS_PER_TOKEN),
                avg_pct: Math.round((data.savedChars / Math.max(data.originalChars, 1)) * 1000) / 10,
            };
        }
        return {
            requests: this.requests,
            compressions: this.totalCompressions,
            session_cache_hits: this.totalSessionCacheHits,
            total_original_chars: this.totalOriginalChars,
            total_saved_chars: totalSaved,
            total_saved_tokens: Math.round(totalSaved / CHARS_PER_TOKEN),
            savings_pct: pct,
            uptime_seconds: Math.round((Date.now() - this.sessionStart) / 1000),
            by_tool: byToolOut,
        };
    }
    persist() {
        try {
            const dir = join(homedir(), '.squeezr');
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            const existing = existsSync(STATS_FILE)
                ? JSON.parse(readFileSync(STATS_FILE, 'utf-8'))
                : {};
            existing.requests = (existing.requests ?? 0) + 1;
            existing.total_saved_chars = (existing.total_saved_chars ?? 0) + (this.totalOriginalChars - this.totalCompressedChars);
            existing.total_original_chars = (existing.total_original_chars ?? 0) + this.totalOriginalChars;
            const bt = existing.by_tool ?? {};
            for (const [tool, data] of Object.entries(this.byTool)) {
                if (!bt[tool])
                    bt[tool] = { count: 0, savedChars: 0, originalChars: 0 };
                bt[tool].count = data.count;
                bt[tool].savedChars = data.savedChars;
                bt[tool].originalChars = data.originalChars;
            }
            existing.by_tool = bt;
            writeFileSync(STATS_FILE, JSON.stringify(existing));
        }
        catch { /* ignore */ }
    }
    static loadGlobal() {
        try {
            if (existsSync(STATS_FILE))
                return JSON.parse(readFileSync(STATS_FILE, 'utf-8'));
        }
        catch { /* ignore */ }
        return {};
    }
}
