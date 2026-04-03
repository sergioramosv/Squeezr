import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse } from 'smol-toml';
function loadTomlFile(path) {
    if (!existsSync(path))
        return {};
    try {
        return parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return {};
    }
}
function deepMerge(base, override) {
    const result = { ...base };
    for (const [k, v] of Object.entries(override)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            result[k] = { ...(result[k] ?? {}), ...v };
        }
        else if (v !== undefined) {
            result[k] = v;
        }
    }
    return result;
}
function loadToml() {
    const globalPath = join(import.meta.dirname, '..', 'squeezr.toml');
    const localPath = join(process.cwd(), '.squeezr.toml');
    const globalCfg = loadTomlFile(globalPath);
    const localCfg = loadTomlFile(localPath);
    if (Object.keys(localCfg).length > 0) {
        console.log(`[squeezr] Using project config: ${localPath}`);
    }
    return deepMerge(globalCfg, localCfg);
}
function env(key, fallback) {
    return process.env[key] ?? fallback;
}
export class Config {
    port;
    threshold;
    keepRecent;
    disabled;
    compressSystemPrompt;
    compressConversation;
    dryRun;
    skipTools;
    onlyTools;
    cacheEnabled;
    cacheMaxEntries;
    adaptiveEnabled;
    adaptiveLow;
    adaptiveMid;
    adaptiveHigh;
    adaptiveCritical;
    localEnabled;
    localUpstreamUrl;
    localCompressionModel;
    localDummyKeys;
    constructor() {
        const t = loadToml();
        const p = t.proxy ?? {};
        const c = t.compression ?? {};
        const ca = t.cache ?? {};
        const ad = t.adaptive ?? {};
        const lo = t.local ?? {};
        this.port = parseInt(env('SQUEEZR_PORT', String(p.port ?? 8080)));
        this.threshold = parseInt(env('SQUEEZR_THRESHOLD', String(c.threshold ?? 800)));
        this.keepRecent = parseInt(env('SQUEEZR_KEEP_RECENT', String(c.keep_recent ?? 3)));
        this.disabled = env('SQUEEZR_DISABLED', String(c.disabled ?? false)) === '1' || env('SQUEEZR_DISABLED', '') === 'true';
        this.compressSystemPrompt = c.compress_system_prompt ?? true;
        this.compressConversation = c.compress_conversation ?? false;
        this.dryRun = env('SQUEEZR_DRY_RUN', '') === '1';
        this.skipTools = new Set((c.skip_tools ?? []).map(t => t.toLowerCase()));
        this.onlyTools = new Set((c.only_tools ?? []).map(t => t.toLowerCase()));
        this.cacheEnabled = ca.enabled ?? true;
        this.cacheMaxEntries = ca.max_entries ?? 1000;
        this.adaptiveEnabled = ad.enabled ?? true;
        this.adaptiveLow = ad.low_threshold ?? 1500;
        this.adaptiveMid = ad.mid_threshold ?? 800;
        this.adaptiveHigh = ad.high_threshold ?? 400;
        this.adaptiveCritical = ad.critical_threshold ?? 150;
        this.localEnabled = lo.enabled ?? true;
        this.localUpstreamUrl = env('SQUEEZR_LOCAL_UPSTREAM', lo.upstream_url ?? 'http://localhost:11434');
        this.localCompressionModel = env('SQUEEZR_LOCAL_MODEL', lo.compression_model ?? 'qwen2.5-coder:1.5b');
        const rawDummies = lo.dummy_keys ?? ['ollama', 'lm-studio', 'sk-no-key-required', 'local', 'none', ''];
        this.localDummyKeys = new Set(rawDummies.map(k => k.toLowerCase()));
    }
    thresholdForPressure(pressure) {
        if (!this.adaptiveEnabled)
            return this.threshold;
        if (pressure >= 0.90)
            return this.adaptiveCritical;
        if (pressure >= 0.75)
            return this.adaptiveHigh;
        if (pressure >= 0.50)
            return this.adaptiveMid;
        return this.adaptiveLow;
    }
    shouldSkipTool(toolName) {
        const t = toolName.toLowerCase();
        if (this.onlyTools.size > 0)
            return !this.onlyTools.has(t);
        return this.skipTools.has(t);
    }
    isLocalKey(key) {
        if (!this.localEnabled)
            return false;
        const k = key.trim().toLowerCase();
        // JWT OAuth tokens (Codex) start with 'eyj' — never route those to local
        return this.localDummyKeys.has(k) || (k.length > 0 && !k.startsWith('sk-') && !k.startsWith('aiza') && !k.startsWith('eyj'));
    }
}
export const config = new Config();
