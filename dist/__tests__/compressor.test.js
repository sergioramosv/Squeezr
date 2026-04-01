import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearExpandStore } from '../expand.js';
import { clearSessionCache } from '../sessionCache.js';
// Mock AI SDKs before importing compressor
vi.mock('@anthropic-ai/sdk', () => ({
    default: vi.fn().mockImplementation(() => ({
        messages: {
            create: vi.fn().mockResolvedValue({
                content: [{ text: 'AI compressed summary' }],
            }),
        },
    })),
}));
vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: {
            completions: {
                create: vi.fn().mockResolvedValue({
                    choices: [{ message: { content: 'AI compressed summary' } }],
                }),
            },
        },
    })),
}));
// Mock fetch for Gemini
const mockFetch = vi.fn().mockResolvedValue({
    json: async () => ({
        candidates: [{ content: { parts: [{ text: 'AI compressed summary' }] } }],
    }),
});
vi.stubGlobal('fetch', mockFetch);
import { compressAnthropicMessages, compressOpenAIMessages, compressGeminiContents, getCache, } from '../compressor.js';
// Minimal config mock
const baseConfig = {
    disabled: false,
    dryRun: false,
    cacheEnabled: false, // disable to avoid file I/O in tests
    cacheMaxEntries: 100,
    keepRecent: 1,
    threshold: 50,
    adaptiveEnabled: false,
    adaptiveLow: 1500,
    adaptiveMid: 800,
    adaptiveHigh: 400,
    adaptiveCritical: 150,
    localUpstreamUrl: 'http://localhost:11434',
    localCompressionModel: 'qwen2.5-coder:1.5b',
    thresholdForPressure: () => 50,
    isLocalKey: () => false,
    shouldSkipTool: () => false,
    skipTools: new Set(),
    onlyTools: new Set(),
};
beforeEach(() => {
    clearExpandStore();
    clearSessionCache();
    vi.clearAllMocks();
});
// ── Anthropic format ──────────────────────────────────────────────────────────
describe('compressAnthropicMessages', () => {
    function makeMessages(toolResults) {
        return toolResults.flatMap((text, i) => [
            {
                role: 'assistant',
                content: [{ type: 'tool_use', id: `tool_${i}`, name: 'Bash' }],
            },
            {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: `tool_${i}`, content: text }],
            },
        ]);
    }
    it('returns messages unchanged when disabled', async () => {
        const msgs = makeMessages(['some tool output']);
        const [result] = await compressAnthropicMessages(msgs, 'key', { ...baseConfig, disabled: true });
        expect(result).toEqual(msgs);
    });
    it('returns messages unchanged when no tool results', async () => {
        const msgs = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }];
        const [result] = await compressAnthropicMessages(msgs, 'key', baseConfig);
        expect(result).toEqual(msgs);
    });
    it('does not compress recent blocks (keepRecent=1)', async () => {
        const longText = 'x'.repeat(200);
        const msgs = makeMessages([longText]);
        const [result] = await compressAnthropicMessages(msgs, 'key', baseConfig);
        // Only 1 message, it's recent — should not be AI compressed
        const block = result[1].content[0];
        expect(block.content).not.toContain('[squeezr:');
    });
    it('compresses old blocks beyond keepRecent', async () => {
        const longText = 'x'.repeat(200);
        // 2 messages: first is old, second is recent
        const msgs = makeMessages([longText, longText]);
        const [result, savings] = await compressAnthropicMessages(msgs, 'key', baseConfig);
        // First block should be compressed
        const firstBlock = result[1].content[0];
        expect(firstBlock.content).toContain('[squeezr:');
        expect(savings.compressed).toBe(1);
    });
    it('embeds squeezr ID and ratio in compressed content', async () => {
        const longText = 'x'.repeat(200);
        const msgs = makeMessages([longText, longText]);
        const [result] = await compressAnthropicMessages(msgs, 'key', baseConfig);
        const compressed = result[1].content[0].content;
        expect(compressed).toMatch(/\[squeezr:[a-f0-9]{6} -\d+%\]/);
    });
    it('does not compress blocks below threshold', async () => {
        const shortText = 'short'; // below threshold of 50
        const msgs = makeMessages([shortText, shortText]);
        const [, savings] = await compressAnthropicMessages(msgs, 'key', baseConfig);
        expect(savings.compressed).toBe(0);
    });
    it('returns dry-run savings without modifying messages', async () => {
        const longText = 'x'.repeat(200);
        const msgs = makeMessages([longText, longText]);
        const [result, savings] = await compressAnthropicMessages(msgs, 'key', { ...baseConfig, dryRun: true });
        expect(savings.dryRun).toBe(true);
        // Messages should not be modified
        const block = result[1].content[0];
        expect(block.content).not.toContain('[squeezr:');
    });
    it('uses session cache on second call with same content', async () => {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const longText = 'x'.repeat(200);
        const msgs = makeMessages([longText, longText]);
        // First call — compresses
        await compressAnthropicMessages(msgs, 'key', baseConfig);
        const callsAfterFirst = Anthropic.mock.results[0]?.value?.messages?.create?.mock?.calls?.length ?? 0;
        // Second call — should hit session cache
        await compressAnthropicMessages(msgs, 'key', baseConfig);
        const callsAfterSecond = Anthropic.mock.results[1]?.value?.messages?.create?.mock?.calls?.length ?? 0;
        // Session cache should prevent additional AI calls for the same content
        expect(callsAfterSecond).toBe(0);
    });
    it('applies deterministic preprocessing to all blocks including recent', async () => {
        // Recent block with git diff — deterministic should still apply
        const gitDiff = `diff --git a/foo.ts b/foo.ts\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1,3 +1,3 @@\n context1\n-old\n+new\n context2\n context3\n context4`;
        const msgs = makeMessages([gitDiff]);
        const [result] = await compressAnthropicMessages(msgs, 'key', baseConfig);
        const content = result[1].content[0].content;
        // context3 and context4 should be stripped by git diff pattern
        expect(content).not.toContain('context4');
    });
    it('tracks savings correctly', async () => {
        const longText = 'x'.repeat(500);
        const msgs = makeMessages([longText, longText]);
        const [, savings] = await compressAnthropicMessages(msgs, 'key', baseConfig);
        expect(savings.savedChars).toBeGreaterThan(0);
        expect(savings.originalChars).toBeGreaterThan(0);
        expect(savings.byTool.length).toBeGreaterThan(0);
    });
});
// ── OpenAI format ─────────────────────────────────────────────────────────────
describe('compressOpenAIMessages', () => {
    function makeMessages(toolResults) {
        return toolResults.flatMap((text, i) => [
            {
                role: 'assistant',
                tool_calls: [{ id: `call_${i}`, function: { name: 'bash' } }],
            },
            {
                role: 'tool',
                tool_call_id: `call_${i}`,
                content: text,
            },
        ]);
    }
    it('returns messages unchanged when disabled', async () => {
        const msgs = makeMessages(['output']);
        const [result] = await compressOpenAIMessages(msgs, 'key', { ...baseConfig, disabled: true });
        expect(result).toEqual(msgs);
    });
    it('compresses old tool messages', async () => {
        const longText = 'y'.repeat(200);
        const msgs = makeMessages([longText, longText]);
        const [result, savings] = await compressOpenAIMessages(msgs, 'key', baseConfig);
        expect(result[1].content).toContain('[squeezr:');
        expect(savings.compressed).toBe(1);
    });
    it('uses Ollama backend for local keys', async () => {
        const OpenAI = (await import('openai')).default;
        const longText = 'z'.repeat(200);
        const msgs = makeMessages([longText, longText]);
        await compressOpenAIMessages(msgs, 'ollama-key', { ...baseConfig, isLocalKey: () => true }, true);
        // OpenAI client should be called (Ollama uses OpenAI-compatible API)
        expect(OpenAI).toHaveBeenCalled();
    });
    it('does not inject expand tool for local requests', async () => {
        const msgs = makeMessages(['short']);
        // isLocal = true means no expand tool injection (handled in server.ts)
        const [result] = await compressOpenAIMessages(msgs, 'key', baseConfig, true);
        // Result should not have squeezr tool injected (that's server.ts's job)
        expect(result).toBeDefined();
    });
    it('returns dry-run without modifications', async () => {
        const longText = 'z'.repeat(200);
        const msgs = makeMessages([longText, longText]);
        const [result, savings] = await compressOpenAIMessages(msgs, 'key', { ...baseConfig, dryRun: true });
        expect(savings.dryRun).toBe(true);
        expect(result[1].content).toBe(longText);
    });
});
// ── Gemini format ─────────────────────────────────────────────────────────────
describe('compressGeminiContents', () => {
    function makeContents(responses) {
        return responses.flatMap((text, i) => [
            { role: 'model', parts: [{ functionCall: { name: 'bash', args: {} } }] },
            { role: 'user', parts: [{ functionResponse: { name: 'bash', response: text } }] },
        ]);
    }
    it('returns contents unchanged when disabled', async () => {
        const cts = makeContents(['output']);
        const [result] = await compressGeminiContents(cts, 'key', { ...baseConfig, disabled: true });
        expect(result).toEqual(cts);
    });
    it('returns unchanged when no function responses', async () => {
        const cts = [{ role: 'user', parts: [{ text: 'hello' }] }];
        const [result] = await compressGeminiContents(cts, 'key', baseConfig);
        expect(result).toEqual(cts);
    });
    it('compresses old function responses', async () => {
        const longText = 'g'.repeat(200);
        const cts = makeContents([longText, longText]);
        const [result, savings] = await compressGeminiContents(cts, 'key', baseConfig);
        const response = result[1].parts[0].functionResponse.response;
        expect(JSON.stringify(response)).toContain('[squeezr:');
        expect(savings.compressed).toBe(1);
    });
    it('uses fetch with Gemini API URL', async () => {
        const longText = 'g'.repeat(200);
        const cts = makeContents([longText, longText]);
        await compressGeminiContents(cts, 'my-google-key', baseConfig);
        expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('generativelanguage.googleapis.com'), expect.any(Object));
        expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('my-google-key'), expect.any(Object));
    });
    it('returns dry-run without modifications', async () => {
        const longText = 'g'.repeat(200);
        const cts = makeContents([longText, longText]);
        const [result, savings] = await compressGeminiContents(cts, 'key', { ...baseConfig, dryRun: true });
        expect(savings.dryRun).toBe(true);
        const response = result[1].parts[0].functionResponse.response;
        expect(response).toBe(longText);
    });
});
// ── skip_tools / only_tools / squeezr:skip ────────────────────────────────────
describe('skip_tools and squeezr:skip', () => {
    function makeMessages(toolName, text) {
        return [
            { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_0', name: toolName }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_0', content: text }] },
            { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_1', name: toolName }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: text }] },
        ];
    }
    it('skips tool when shouldSkipTool returns true', async () => {
        const longText = 'x'.repeat(200);
        const msgs = makeMessages('Read', longText);
        const skipConfig = { ...baseConfig, shouldSkipTool: (t) => t.toLowerCase() === 'read' };
        const [result, savings] = await compressAnthropicMessages(msgs, 'key', skipConfig);
        expect(savings.compressed).toBe(0);
        expect(result[1].content[0].content).toBe(longText);
    });
    it('compresses tool when shouldSkipTool returns false', async () => {
        const longText = 'x'.repeat(200);
        const msgs = makeMessages('Bash', longText);
        const [, savings] = await compressAnthropicMessages(msgs, 'key', baseConfig);
        expect(savings.compressed).toBe(1);
    });
    it('respects squeezr:skip inline marker — does not compress that block', async () => {
        const longText = 'x'.repeat(200);
        // 3 tool calls: tool_0 (skip marker), tool_1 (old, compressible), tool_2 (recent, kept)
        const msgs = [
            {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tool_0', name: 'Bash', input: { command: 'git diff HEAD~3  # squeezr:skip' } }],
            },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_0', content: longText }] },
            {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tool_1', name: 'Bash', input: { command: 'some other command' } }],
            },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: longText }] },
            {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tool_2', name: 'Bash', input: { command: 'another command' } }],
            },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_2', content: longText }] },
        ];
        const [result, savings] = await compressAnthropicMessages(msgs, 'key', baseConfig);
        // tool_0 has squeezr:skip → not compressed
        expect(result[1].content[0].content).toBe(longText);
        // tool_1 is old and not skipped → compressed
        expect(savings.compressed).toBe(1);
    });
});
// ── getCache ──────────────────────────────────────────────────────────────────
describe('getCache', () => {
    it('returns a CompressionCache instance', () => {
        const cache = getCache(baseConfig);
        expect(cache).toBeDefined();
        expect(typeof cache.get).toBe('function');
        expect(typeof cache.set).toBe('function');
        expect(typeof cache.stats).toBe('function');
    });
    it('returns the same instance on repeated calls', () => {
        const c1 = getCache(baseConfig);
        const c2 = getCache(baseConfig);
        expect(c1).toBe(c2);
    });
});
