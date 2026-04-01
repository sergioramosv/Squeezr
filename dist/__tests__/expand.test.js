import { describe, it, expect, beforeEach } from 'vitest';
import { storeOriginal, retrieveOriginal, expandStoreSize, clearExpandStore, injectExpandToolAnthropic, injectExpandToolOpenAI, handleAnthropicExpandCall, handleOpenAIExpandCall, } from '../expand.js';
describe('storeOriginal / retrieveOriginal', () => {
    beforeEach(() => clearExpandStore());
    it('stores and retrieves original content', () => {
        const id = storeOriginal('hello world');
        expect(retrieveOriginal(id)).toBe('hello world');
    });
    it('returns undefined for unknown ID', () => {
        expect(retrieveOriginal('zzzzzz')).toBeUndefined();
    });
    it('returns a 6-char hex ID', () => {
        const id = storeOriginal('test');
        expect(id).toMatch(/^[a-f0-9]{6}$/);
    });
    it('is deterministic — same content always same ID', () => {
        const id1 = storeOriginal('foo bar baz');
        clearExpandStore();
        const id2 = storeOriginal('foo bar baz');
        expect(id1).toBe(id2);
    });
    it('different content produces different IDs', () => {
        const id1 = storeOriginal('content one');
        const id2 = storeOriginal('content two');
        expect(id1).not.toBe(id2);
    });
    it('overwrites store entry if same content stored twice', () => {
        storeOriginal('same');
        storeOriginal('same');
        expect(expandStoreSize()).toBe(1);
    });
});
describe('expandStoreSize / clearExpandStore', () => {
    beforeEach(() => clearExpandStore());
    it('starts at 0', () => {
        expect(expandStoreSize()).toBe(0);
    });
    it('increments on store', () => {
        storeOriginal('a');
        storeOriginal('b');
        expect(expandStoreSize()).toBe(2);
    });
    it('clears to 0', () => {
        storeOriginal('x');
        clearExpandStore();
        expect(expandStoreSize()).toBe(0);
    });
});
// ── injectExpandToolAnthropic ─────────────────────────────────────────────────
describe('injectExpandToolAnthropic', () => {
    it('adds squeezr_expand tool when tools array is empty', () => {
        const body = { tools: [] };
        injectExpandToolAnthropic(body);
        expect(body.tools.length).toBe(1);
        expect(body.tools[0].name).toBe('squeezr_expand');
    });
    it('creates tools array if missing', () => {
        const body = {};
        injectExpandToolAnthropic(body);
        expect(Array.isArray(body.tools)).toBe(true);
        expect(body.tools.length).toBe(1);
    });
    it('does not add duplicate if already injected', () => {
        const body = { tools: [] };
        injectExpandToolAnthropic(body);
        injectExpandToolAnthropic(body);
        expect(body.tools.length).toBe(1);
    });
    it('preserves existing tools', () => {
        const body = { tools: [{ name: 'read_file' }] };
        injectExpandToolAnthropic(body);
        expect(body.tools.length).toBe(2);
        expect(body.tools[0].name).toBe('read_file');
    });
    it('injected tool has correct input_schema', () => {
        const body = {};
        injectExpandToolAnthropic(body);
        const tool = body.tools[0];
        expect(tool.input_schema.properties.id).toBeDefined();
    });
});
// ── injectExpandToolOpenAI ────────────────────────────────────────────────────
describe('injectExpandToolOpenAI', () => {
    it('adds squeezr_expand tool in OpenAI format', () => {
        const body = {};
        injectExpandToolOpenAI(body);
        const tools = body.tools;
        expect(tools[0].type).toBe('function');
        expect(tools[0].function.name).toBe('squeezr_expand');
    });
    it('does not add duplicate', () => {
        const body = {};
        injectExpandToolOpenAI(body);
        injectExpandToolOpenAI(body);
        expect(body.tools.length).toBe(1);
    });
});
// ── handleAnthropicExpandCall ─────────────────────────────────────────────────
describe('handleAnthropicExpandCall', () => {
    beforeEach(() => clearExpandStore());
    it('returns null when no tool_use in response', () => {
        const resp = { content: [{ type: 'text', text: 'hello' }] };
        expect(handleAnthropicExpandCall(resp)).toBeNull();
    });
    it('returns null for non-squeezr tool calls', () => {
        const resp = { content: [{ type: 'tool_use', id: 'x', name: 'read_file', input: { path: '/foo' } }] };
        expect(handleAnthropicExpandCall(resp)).toBeNull();
    });
    it('returns null when ID not in store', () => {
        const resp = {
            content: [{ type: 'tool_use', id: 'call_1', name: 'squeezr_expand', input: { id: 'aabbcc' } }],
        };
        expect(handleAnthropicExpandCall(resp)).toBeNull();
    });
    it('returns toolUseId and original when ID found', () => {
        const id = storeOriginal('the original content');
        const resp = {
            content: [{ type: 'tool_use', id: 'call_abc', name: 'squeezr_expand', input: { id } }],
        };
        const result = handleAnthropicExpandCall(resp);
        expect(result).not.toBeNull();
        expect(result.toolUseId).toBe('call_abc');
        expect(result.original).toBe('the original content');
    });
    it('returns null when response has no content', () => {
        expect(handleAnthropicExpandCall({})).toBeNull();
    });
});
// ── handleOpenAIExpandCall ────────────────────────────────────────────────────
describe('handleOpenAIExpandCall', () => {
    beforeEach(() => clearExpandStore());
    it('returns null when no choices', () => {
        expect(handleOpenAIExpandCall({})).toBeNull();
    });
    it('returns null when no tool_calls', () => {
        const resp = { choices: [{ message: { content: 'hello' } }] };
        expect(handleOpenAIExpandCall(resp)).toBeNull();
    });
    it('returns null for non-squeezr tool calls', () => {
        const resp = {
            choices: [{
                    message: {
                        tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: '{}' } }],
                    },
                }],
        };
        expect(handleOpenAIExpandCall(resp)).toBeNull();
    });
    it('returns toolCallId and original when ID found', () => {
        const id = storeOriginal('openai original');
        const resp = {
            choices: [{
                    message: {
                        tool_calls: [{
                                id: 'call_xyz',
                                function: { name: 'squeezr_expand', arguments: JSON.stringify({ id }) },
                            }],
                    },
                }],
        };
        const result = handleOpenAIExpandCall(resp);
        expect(result).not.toBeNull();
        expect(result.toolCallId).toBe('call_xyz');
        expect(result.original).toBe('openai original');
    });
    it('returns null when ID not in store', () => {
        const resp = {
            choices: [{
                    message: {
                        tool_calls: [{
                                id: 'call_1',
                                function: { name: 'squeezr_expand', arguments: JSON.stringify({ id: 'zzzzzz' }) },
                            }],
                    },
                }],
        };
        expect(handleOpenAIExpandCall(resp)).toBeNull();
    });
    it('handles malformed arguments gracefully', () => {
        const resp = {
            choices: [{
                    message: {
                        tool_calls: [{
                                id: 'call_1',
                                function: { name: 'squeezr_expand', arguments: 'NOT JSON{{{' },
                            }],
                    },
                }],
        };
        expect(handleOpenAIExpandCall(resp)).toBeNull();
    });
});
