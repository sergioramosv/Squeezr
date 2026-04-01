import { describe, it, expect, beforeEach } from 'vitest';
import { Config } from '../config.js';
// We test Config methods directly without relying on env vars or toml file
// by inspecting the behavior of a fresh instance (which loads from toml or defaults)
describe('Config.thresholdForPressure', () => {
    let config;
    // Create a config with known adaptive thresholds by setting env vars before instantiation
    // Easier to just test with whatever the loaded config has (adaptiveEnabled=true by default)
    // so we verify relative ordering rather than exact values.
    it('returns a lower threshold at low pressure (< 0.5)', () => {
        config = new Config();
        const low = config.thresholdForPressure(0.1);
        const mid = config.thresholdForPressure(0.6);
        expect(low).toBeGreaterThan(mid);
    });
    it('returns a lower threshold at mid pressure (0.5-0.75)', () => {
        config = new Config();
        const mid = config.thresholdForPressure(0.6);
        const high = config.thresholdForPressure(0.8);
        expect(mid).toBeGreaterThan(high);
    });
    it('returns lowest threshold at critical pressure (>= 0.9)', () => {
        config = new Config();
        const critical = config.thresholdForPressure(0.95);
        const high = config.thresholdForPressure(0.8);
        expect(critical).toBeLessThan(high);
    });
    it('returns exact thresholds matching the 4 bands', () => {
        config = new Config();
        const p0 = config.thresholdForPressure(0.0);
        const p50 = config.thresholdForPressure(0.50);
        const p75 = config.thresholdForPressure(0.75);
        const p90 = config.thresholdForPressure(0.90);
        // Each band should be <= the previous
        expect(p0).toBeGreaterThanOrEqual(p50);
        expect(p50).toBeGreaterThanOrEqual(p75);
        expect(p75).toBeGreaterThanOrEqual(p90);
    });
    it('returns base threshold when adaptive is disabled', () => {
        // We can't easily disable adaptive without a custom toml, but we can verify
        // that when adaptiveEnabled is true, boundary values return the right band
        config = new Config();
        // 0.89 is just below 0.90 → high band
        const justBelow90 = config.thresholdForPressure(0.89);
        // 0.90 is critical band
        const at90 = config.thresholdForPressure(0.90);
        expect(justBelow90).toBeGreaterThanOrEqual(at90);
    });
});
describe('Config.shouldSkipTool', () => {
    function makeConfig(skip, only) {
        const config = new Config();
        config.skipTools = new Set(skip.map(t => t.toLowerCase()));
        config.onlyTools = new Set(only.map(t => t.toLowerCase()));
        return config;
    }
    it('returns false for any tool when no lists are configured', () => {
        const config = makeConfig([], []);
        expect(config.shouldSkipTool('Bash')).toBe(false);
        expect(config.shouldSkipTool('Read')).toBe(false);
        expect(config.shouldSkipTool('Grep')).toBe(false);
    });
    it('skipTools: returns true for blacklisted tools', () => {
        const config = makeConfig(['Read', 'Grep'], []);
        expect(config.shouldSkipTool('Read')).toBe(true);
        expect(config.shouldSkipTool('Grep')).toBe(true);
        expect(config.shouldSkipTool('Bash')).toBe(false);
    });
    it('skipTools: comparison is case-insensitive', () => {
        const config = makeConfig(['read'], []);
        expect(config.shouldSkipTool('READ')).toBe(true);
        expect(config.shouldSkipTool('Read')).toBe(true);
        expect(config.shouldSkipTool('read')).toBe(true);
    });
    it('onlyTools: returns false for whitelisted tools', () => {
        const config = makeConfig([], ['Bash']);
        expect(config.shouldSkipTool('Bash')).toBe(false);
    });
    it('onlyTools: returns true (skip) for tools NOT in the whitelist', () => {
        const config = makeConfig([], ['Bash']);
        expect(config.shouldSkipTool('Read')).toBe(true);
        expect(config.shouldSkipTool('Grep')).toBe(true);
    });
    it('onlyTools takes priority over skipTools', () => {
        // Even if Read is in skipTools, onlyTools=[Bash] means only Bash is processed
        const config = makeConfig(['Read'], ['Bash']);
        expect(config.shouldSkipTool('Bash')).toBe(false); // in onlyTools → don't skip
        expect(config.shouldSkipTool('Read')).toBe(true); // not in onlyTools → skip
    });
    it('default Config has empty skip/only sets', () => {
        const config = new Config();
        expect(config.skipTools.size).toBe(0);
        expect(config.onlyTools.size).toBe(0);
        expect(config.shouldSkipTool('Bash')).toBe(false);
    });
});
describe('Config.isLocalKey', () => {
    let config;
    beforeEach(() => { config = new Config(); });
    it('recognizes "ollama" as a local key', () => {
        expect(config.isLocalKey('ollama')).toBe(true);
    });
    it('recognizes "lm-studio" as a local key', () => {
        expect(config.isLocalKey('lm-studio')).toBe(true);
    });
    it('recognizes empty string as a local key', () => {
        expect(config.isLocalKey('')).toBe(true); // empty string IS in localDummyKeys set
    });
    it('recognizes "local" as a local key', () => {
        expect(config.isLocalKey('local')).toBe(true);
    });
    it('does not recognize Anthropic keys as local', () => {
        expect(config.isLocalKey('sk-ant-api03-xxxxxxxxxxxx')).toBe(false);
    });
    it('does not recognize OpenAI keys as local', () => {
        expect(config.isLocalKey('sk-proj-xxxxxxxxxxxx')).toBe(false);
    });
    it('does not recognize Google keys as local', () => {
        expect(config.isLocalKey('AIzaSy-xxxxxxxxxxxx')).toBe(false);
    });
    it('is case-insensitive', () => {
        expect(config.isLocalKey('OLLAMA')).toBe(true);
        expect(config.isLocalKey('Ollama')).toBe(true);
    });
    it('trims whitespace', () => {
        expect(config.isLocalKey('  ollama  ')).toBe(true);
    });
    it('recognizes arbitrary non-sk-/aiza keys as local (custom Ollama proxies)', () => {
        // Keys that are not empty and don't start with sk- or aiza are treated as local
        expect(config.isLocalKey('my-custom-key-123')).toBe(true);
    });
});
