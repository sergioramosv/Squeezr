import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { CompressionCache } from './cache.js';
import { preprocess } from './deterministic.js';
import { storeOriginal } from './expand.js';
import { hashText, getBlock, setBlock } from './sessionCache.js';
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
// ── Session cache helpers ─────────────────────────────────────────────────────
/**
 * Build the full compressed string and store it in the session cache.
 * Returns {fullString, savedChars} for the given original+result pair.
 *
 * KV cache warming: by storing and reusing the exact fullString (including the
 * deterministic squeezr:id prefix), subsequent requests produce byte-for-byte
 * identical message content for unchanged blocks — preserving Anthropic's
 * prefix cache across requests.
 */
function buildAndCache(original, result) {
    const ratio = Math.round((1 - result.length / Math.max(original.length, 1)) * 100);
    const id = storeOriginal(original);
    const fullString = `[squeezr:${id} -${ratio}%] ${result}`;
    const savedChars = original.length - result.length;
    setBlock(hashText(original), {
        fullString,
        savedChars,
        originalChars: original.length,
    });
    return { fullString, savedChars };
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
    const toProcess = candidates.filter(c => c.text.length >= threshold);
    if (toProcess.length === 0)
        return [messages, emptySavings()];
    if (config.dryRun) {
        const potential = toProcess.reduce((sum, c) => sum + c.text.length, 0);
        console.log(`[squeezr dry-run] Would compress ${toProcess.length} block(s) | potential -${potential.toLocaleString()} chars | pressure=${Math.round(pressure * 100)}%`);
        return [messages, emptySavings(true)];
    }
    // ── Differential compression: split session cache hits from uncached ──────
    const sessionHits = [];
    const toCompress = [];
    for (const c of toProcess) {
        const cached = getBlock(hashText(c.text));
        if (cached) {
            sessionHits.push({ index: c.index, subIndex: c.subIndex, tool: c.tool, block: cached });
        }
        else {
            toCompress.push(c);
        }
    }
    const freshlyCompressed = toCompress.length > 0
        ? await runCompression(toCompress, t => compressWithHaiku(t, apiKey), config)
        : [];
    const msgs = structuredClone(messages);
    let totalOriginal = 0;
    let totalCompressed = 0;
    const byTool = [];
    // Apply session cache hits (exact same bytes → KV cache preserved)
    for (const { index, subIndex, tool, block } of sessionHits) {
        const msgBlock = msgs[index].content[subIndex];
        msgBlock.content = block.fullString;
        totalOriginal += block.originalChars;
        totalCompressed += block.originalChars - block.savedChars;
        byTool.push({ tool, savedChars: block.savedChars, originalChars: block.originalChars });
    }
    // Apply fresh compressions and populate session cache
    for (const { index, subIndex, original, result, tool } of freshlyCompressed) {
        const { fullString, savedChars } = buildAndCache(original, result);
        const msgBlock = msgs[index].content[subIndex];
        msgBlock.content = fullString;
        totalOriginal += original.length;
        totalCompressed += original.length - savedChars;
        byTool.push({ tool, savedChars, originalChars: original.length });
    }
    if (pressure >= 0.5) {
        console.log(`[squeezr] Context pressure: ${Math.round(pressure * 100)}% → threshold=${threshold} chars`);
    }
    if (sessionHits.length > 0) {
        console.log(`[squeezr] Session cache: ${sessionHits.length} block(s) reused (KV cache preserved)`);
    }
    return [msgs, {
            compressed: freshlyCompressed.length,
            savedChars: totalOriginal - totalCompressed,
            originalChars: totalOriginal,
            byTool,
            dryRun: false,
            sessionCacheHits: sessionHits.length,
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
    const toProcess = candidates.filter(c => c.text.length >= threshold);
    if (toProcess.length === 0)
        return [messages, emptySavings()];
    if (config.dryRun) {
        const potential = toProcess.reduce((sum, c) => sum + c.text.length, 0);
        const tag = isLocal ? 'ollama' : 'codex';
        console.log(`[squeezr dry-run/${tag}] Would compress ${toProcess.length} block(s) | potential -${potential.toLocaleString()} chars`);
        return [messages, emptySavings(true)];
    }
    // ── Differential compression ──────────────────────────────────────────────
    const sessionHits = [];
    const toCompress = [];
    for (const c of toProcess) {
        const cached = getBlock(hashText(c.text));
        if (cached) {
            sessionHits.push({ index: c.index, tool: c.tool, block: cached });
        }
        else {
            toCompress.push(c);
        }
    }
    const compressFn = isLocal
        ? t => compressWithOllama(t, config.localUpstreamUrl, config.localCompressionModel)
        : t => compressWithGptMini(t, apiKey);
    const freshlyCompressed = toCompress.length > 0
        ? await runCompression(toCompress, compressFn, config)
        : [];
    const msgs = structuredClone(messages);
    let totalOriginal = 0;
    let totalCompressed = 0;
    const byTool = [];
    for (const { index, tool, block } of sessionHits) {
        msgs[index].content = block.fullString;
        totalOriginal += block.originalChars;
        totalCompressed += block.originalChars - block.savedChars;
        byTool.push({ tool, savedChars: block.savedChars, originalChars: block.originalChars });
    }
    for (const { index, original, result, tool } of freshlyCompressed) {
        const { fullString, savedChars } = buildAndCache(original, result);
        msgs[index].content = fullString;
        totalOriginal += original.length;
        totalCompressed += original.length - savedChars;
        byTool.push({ tool, savedChars, originalChars: original.length });
    }
    if (pressure >= 0.5) {
        const tag = isLocal ? 'ollama' : 'codex';
        console.log(`[squeezr/${tag}] Context pressure: ${Math.round(pressure * 100)}% → threshold=${threshold} chars`);
    }
    if (sessionHits.length > 0) {
        console.log(`[squeezr] Session cache: ${sessionHits.length} block(s) reused (KV cache preserved)`);
    }
    return [msgs, {
            compressed: freshlyCompressed.length,
            savedChars: totalOriginal - totalCompressed,
            originalChars: totalOriginal,
            byTool,
            dryRun: false,
            sessionCacheHits: sessionHits.length,
        }];
}
export async function compressGeminiContents(contents, apiKey, config) {
    if (config.disabled)
        return [contents, emptySavings()];
    const pressure = estimatePressure(contents);
    const threshold = config.thresholdForPressure(pressure);
    const toProcess = [];
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
                toProcess.push({ index: i, subIndex: j, text, tool: part.functionResponse.name });
            }
        }
    }
    const candidates = toProcess.slice(0, Math.max(0, toProcess.length - config.keepRecent));
    if (candidates.length === 0)
        return [contents, emptySavings()];
    if (config.dryRun) {
        const potential = candidates.reduce((sum, c) => sum + c.text.length, 0);
        console.log(`[squeezr dry-run/gemini] Would compress ${candidates.length} block(s) | potential -${potential.toLocaleString()} chars`);
        return [contents, emptySavings(true)];
    }
    // ── Differential compression ──────────────────────────────────────────────
    const sessionHits = [];
    const toCompress = [];
    for (const c of candidates) {
        const cached = getBlock(hashText(c.text));
        if (cached) {
            sessionHits.push({ index: c.index, subIndex: c.subIndex, tool: c.tool, block: cached });
        }
        else {
            toCompress.push(c);
        }
    }
    const freshlyCompressed = toCompress.length > 0
        ? await runCompression(candidates, t => compressWithGeminiFlash(t, apiKey), config)
        : [];
    const cts = structuredClone(contents);
    let totalOriginal = 0;
    let totalCompressed = 0;
    const byTool = [];
    for (const { index, subIndex, tool, block } of sessionHits) {
        cts[index].parts[subIndex].functionResponse.response = { output: block.fullString };
        totalOriginal += block.originalChars;
        totalCompressed += block.originalChars - block.savedChars;
        byTool.push({ tool, savedChars: block.savedChars, originalChars: block.originalChars });
    }
    for (const { index, subIndex, original, result, tool } of freshlyCompressed) {
        const { fullString, savedChars } = buildAndCache(original, result);
        cts[index].parts[subIndex].functionResponse.response = { output: fullString };
        totalOriginal += original.length;
        totalCompressed += original.length - savedChars;
        byTool.push({ tool, savedChars, originalChars: original.length });
    }
    if (sessionHits.length > 0) {
        console.log(`[squeezr/gemini] Session cache: ${sessionHits.length} block(s) reused (KV cache preserved)`);
    }
    return [cts, {
            compressed: freshlyCompressed.length,
            savedChars: totalOriginal - totalCompressed,
            originalChars: totalOriginal,
            byTool,
            dryRun: false,
            sessionCacheHits: sessionHits.length,
        }];
}
function emptySavings(dryRun = false) {
    return { compressed: 0, savedChars: 0, originalChars: 0, byTool: [], dryRun, sessionCacheHits: 0 };
}
