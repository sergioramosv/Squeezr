import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { CompressionCache } from './cache.js';
import { preprocess } from './deterministic.js';
import { storeOriginal } from './expand.js';
const COMPRESS_PROMPT = 'You are compressing a coding tool output to save tokens. ' +
    'Extract ONLY what is essential: errors, file paths, function names, ' +
    'test failures, key values, warnings. ' +
    'Be extremely concise, target under 150 tokens. ' +
    'Output only the compressed content, nothing else.';
let _cache = null;
export function getCache(config) {
    if (!_cache)
        _cache = new CompressionCache(config.cacheMaxEntries);
    return _cache;
}
function estimatePressure(messages) {
    const chars = JSON.stringify(messages).length;
    return Math.min(chars / 800_000, 1.0);
}
// ── Compression functions ─────────────────────────────────────────────────────
async function compressWithHaiku(text, apiKey) {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: `${COMPRESS_PROMPT}\n\n---\n${text.slice(0, 4000)}` }],
    });
    return resp.content[0].text;
}
async function compressWithGptMini(text, apiKey) {
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        messages: [{ role: 'user', content: `${COMPRESS_PROMPT}\n\n---\n${text.slice(0, 4000)}` }],
    });
    return resp.choices[0].message.content ?? '';
}
async function compressWithGeminiFlash(text, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${COMPRESS_PROMPT}\n\n---\n${text.slice(0, 4000)}` }] }],
        }),
    });
    const data = (await resp.json());
    return data.candidates[0].content.parts[0].text;
}
async function compressWithOllama(text, baseUrl, model) {
    const client = new OpenAI({ apiKey: 'ollama', baseURL: `${baseUrl.replace(/\/$/, '')}/v1` });
    const resp = await client.chat.completions.create({
        model,
        max_tokens: 300,
        messages: [{ role: 'user', content: `${COMPRESS_PROMPT}\n\n---\n${text.slice(0, 4000)}` }],
    });
    return resp.choices[0].message.content ?? '';
}
async function runCompression(items, compressFn, config) {
    const cache = getCache(config);
    const results = await Promise.allSettled(items.map(async (item) => {
        const preprocessed = preprocess(item.text);
        if (config.cacheEnabled) {
            const cached = cache.get(preprocessed);
            if (cached)
                return { ...item, original: item.text, result: cached };
        }
        const compressed = await compressFn(preprocessed);
        if (config.cacheEnabled)
            cache.set(preprocessed, compressed);
        return { ...item, original: item.text, result: compressed };
    }));
    return results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);
}
function extractAnthropicToolResults(messages, toolIdMap) {
    const results = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role !== 'user' || !Array.isArray(msg.content))
            continue;
        for (let j = 0; j < msg.content.length; j++) {
            const block = msg.content[j];
            if (block.type !== 'tool_result')
                continue;
            const text = typeof block.content === 'string' ? block.content
                : Array.isArray(block.content) ? block.content
                    .filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
                    : '';
            if (text.length > 0) {
                const toolName = toolIdMap.get(block.tool_use_id ?? '') ?? 'unknown';
                results.push({ index: i, subIndex: j, text, tool: toolName });
            }
        }
    }
    return results;
}
function buildAnthropicToolIdMap(messages) {
    const map = new Map();
    for (const msg of messages) {
        if (msg.role !== 'assistant' || !Array.isArray(msg.content))
            continue;
        for (const block of msg.content) {
            if (block.type === 'tool_use' && 'id' in block && 'name' in block) {
                map.set(block.id, block.name);
            }
        }
    }
    return map;
}
export async function compressAnthropicMessages(messages, apiKey, config) {
    if (config.disabled)
        return [messages, emptySavings()];
    const pressure = estimatePressure(messages);
    const threshold = config.thresholdForPressure(pressure);
    const toolIdMap = buildAnthropicToolIdMap(messages);
    const allResults = extractAnthropicToolResults(messages, toolIdMap);
    const candidates = allResults.slice(0, Math.max(0, allResults.length - config.keepRecent));
    const toCompress = candidates.filter(c => c.text.length >= threshold);
    if (toCompress.length === 0)
        return [messages, emptySavings()];
    if (config.dryRun) {
        const potential = toCompress.reduce((sum, c) => sum + c.text.length, 0);
        console.log(`[squeezr dry-run] Would compress ${toCompress.length} block(s) | potential -${potential.toLocaleString()} chars | pressure=${Math.round(pressure * 100)}%`);
        return [messages, emptySavings(true)];
    }
    const compressed = await runCompression(toCompress, t => compressWithHaiku(t, apiKey), config);
    const msgs = structuredClone(messages);
    return applyAnthropicCompressions(msgs, compressed, pressure, threshold);
}
function applyAnthropicCompressions(messages, compressed, pressure, threshold) {
    let totalOriginal = 0;
    let totalCompressed = 0;
    const byTool = [];
    for (const { index, subIndex, original, result, tool } of compressed) {
        const ratio = Math.round((1 - result.length / Math.max(original.length, 1)) * 100);
        const id = storeOriginal(original);
        const newContent = `[squeezr:${id} -${ratio}%] ${result}`;
        const block = messages[index].content[subIndex];
        block.content = newContent;
        const saved = original.length - result.length;
        totalOriginal += original.length;
        totalCompressed += result.length;
        byTool.push({ tool, savedChars: saved, originalChars: original.length });
    }
    if (pressure >= 0.5) {
        console.log(`[squeezr] Context pressure: ${Math.round(pressure * 100)}% → threshold=${threshold} chars`);
    }
    return [messages, {
            compressed: compressed.length,
            savedChars: totalOriginal - totalCompressed,
            originalChars: totalOriginal,
            byTool,
            dryRun: false,
        }];
}
function extractOpenAIToolResults(messages) {
    const nameMap = new Map();
    for (const msg of messages) {
        if (msg.role !== 'assistant')
            continue;
        for (const tc of msg.tool_calls ?? []) {
            nameMap.set(tc.id, tc.function.name);
        }
    }
    const results = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role !== 'tool' || !msg.content)
            continue;
        const text = typeof msg.content === 'string' ? msg.content : '';
        if (text)
            results.push({ index: i, text, tool: nameMap.get(msg.tool_call_id ?? '') ?? 'unknown' });
    }
    return results;
}
export async function compressOpenAIMessages(messages, apiKey, config, isLocal = false) {
    if (config.disabled)
        return [messages, emptySavings()];
    const pressure = estimatePressure(messages);
    const threshold = config.thresholdForPressure(pressure);
    const allResults = extractOpenAIToolResults(messages);
    const candidates = allResults.slice(0, Math.max(0, allResults.length - config.keepRecent));
    const toCompress = candidates.filter(c => c.text.length >= threshold);
    if (toCompress.length === 0)
        return [messages, emptySavings()];
    if (config.dryRun) {
        const potential = toCompress.reduce((sum, c) => sum + c.text.length, 0);
        const tag = isLocal ? 'ollama' : 'codex';
        console.log(`[squeezr dry-run/${tag}] Would compress ${toCompress.length} block(s) | potential -${potential.toLocaleString()} chars`);
        return [messages, emptySavings(true)];
    }
    const compressFn = isLocal
        ? t => compressWithOllama(t, config.localUpstreamUrl, config.localCompressionModel)
        : t => compressWithGptMini(t, apiKey);
    const compressed = await runCompression(toCompress, compressFn, config);
    const msgs = structuredClone(messages);
    let totalOriginal = 0;
    let totalCompressed = 0;
    const byTool = [];
    for (const { index, original, result, tool } of compressed) {
        const ratio = Math.round((1 - result.length / Math.max(original.length, 1)) * 100);
        const id = storeOriginal(original);
        msgs[index].content = `[squeezr:${id} -${ratio}%] ${result}`;
        const saved = original.length - result.length;
        totalOriginal += original.length;
        totalCompressed += result.length;
        byTool.push({ tool, savedChars: saved, originalChars: original.length });
    }
    if (pressure >= 0.5) {
        const tag = isLocal ? 'ollama' : 'codex';
        console.log(`[squeezr/${tag}] Context pressure: ${Math.round(pressure * 100)}% → threshold=${threshold} chars`);
    }
    return [msgs, { compressed: compressed.length, savedChars: totalOriginal - totalCompressed, originalChars: totalOriginal, byTool, dryRun: false }];
}
export async function compressGeminiContents(contents, apiKey, config) {
    if (config.disabled)
        return [contents, emptySavings()];
    const pressure = estimatePressure(contents);
    const threshold = config.thresholdForPressure(pressure);
    const toCompress = [];
    for (let i = 0; i < contents.length; i++) {
        const content = contents[i];
        if (content.role !== 'user')
            continue;
        for (let j = 0; j < content.parts.length; j++) {
            const part = content.parts[j];
            if (!part.functionResponse)
                continue;
            const text = typeof part.functionResponse.response === 'string'
                ? part.functionResponse.response
                : JSON.stringify(part.functionResponse.response);
            if (text.length >= threshold) {
                toCompress.push({ index: i, subIndex: j, text, tool: part.functionResponse.name });
            }
        }
    }
    const candidates = toCompress.slice(0, Math.max(0, toCompress.length - config.keepRecent));
    if (candidates.length === 0)
        return [contents, emptySavings()];
    if (config.dryRun) {
        const potential = candidates.reduce((sum, c) => sum + c.text.length, 0);
        console.log(`[squeezr dry-run/gemini] Would compress ${candidates.length} block(s) | potential -${potential.toLocaleString()} chars`);
        return [contents, emptySavings(true)];
    }
    const compressed = await runCompression(candidates, t => compressWithGeminiFlash(t, apiKey), config);
    const cts = structuredClone(contents);
    let totalOriginal = 0;
    let totalCompressed = 0;
    const byTool = [];
    for (const { index, subIndex, original, result, tool } of compressed) {
        const ratio = Math.round((1 - result.length / Math.max(original.length, 1)) * 100);
        const id = storeOriginal(original);
        cts[index].parts[subIndex].functionResponse.response = { output: `[squeezr:${id} -${ratio}%] ${result}` };
        const saved = original.length - result.length;
        totalOriginal += original.length;
        totalCompressed += result.length;
        byTool.push({ tool, savedChars: saved, originalChars: original.length });
    }
    return [cts, { compressed: compressed.length, savedChars: totalOriginal - totalCompressed, originalChars: totalOriginal, byTool, dryRun: false }];
}
function emptySavings(dryRun = false) {
    return { compressed: 0, savedChars: 0, originalChars: 0, byTool: [], dryRun };
}
