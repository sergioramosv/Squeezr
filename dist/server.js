import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { config } from './config.js';
import { Stats } from './stats.js';
import { getCache } from './compressor.js';
import { compressAnthropicMessages, compressOpenAIMessages, compressGeminiContents, } from './compressor.js';
import { injectExpandToolAnthropic, injectExpandToolOpenAI, handleAnthropicExpandCall, handleOpenAIExpandCall, retrieveOriginal, expandStoreSize, } from './expand.js';
import { compressSystemPrompt } from './systemPrompt.js';
import { sessionCacheSize } from './sessionCache.js';
import { detPatternHits } from './deterministic.js';
import { VERSION } from './version.js';
const ANTHROPIC_API = 'https://api.anthropic.com';
const OPENAI_API = 'https://api.openai.com';
const GOOGLE_API = 'https://generativelanguage.googleapis.com';
const SKIP_REQ_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection']);
function readCodexToken() {
    try {
        const d = JSON.parse(readFileSync(join(homedir(), '.codex', 'auth.json'), 'utf-8'));
        return d?.tokens?.access_token ?? null;
    }
    catch {
        return null;
    }
}
const SKIP_RESP_HEADERS = new Set(['content-encoding', 'transfer-encoding', 'connection', 'content-length']);
export const stats = new Stats();
function forwardHeaders(headers) {
    const out = {};
    for (const [k, v] of headers.entries()) {
        if (!SKIP_REQ_HEADERS.has(k.toLowerCase()))
            out[k] = v;
    }
    return out;
}
function extractOpenAIKey(headers) {
    const auth = headers.get('authorization') ?? '';
    return auth.replace(/^bearer\s+/i, '').trim();
}
function extractGoogleKey(headers, url) {
    return headers.get('x-goog-api-key') ?? url.searchParams.get('key') ?? '';
}
function detectUpstream(headers) {
    if (headers.get('x-goog-api-key'))
        return GOOGLE_API;
    const auth = headers.get('authorization') ?? '';
    if (auth && !headers.get('x-api-key'))
        return OPENAI_API;
    return ANTHROPIC_API;
}
function estimateChars(data) {
    return JSON.stringify(data).length;
}
async function proxyStream(upstream, body, headers, params) {
    const url = params?.toString() ? `${upstream}?${params}` : upstream;
    return fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}
export const app = new Hono();
// ── Anthropic / Claude Code ───────────────────────────────────────────────────
app.post('/v1/messages', async (c) => {
    const body = await c.req.json();
    // Support both API key (x-api-key: sk-ant-...) and OAuth bearer token
    // (Authorization: Bearer ...) — Claude Code subscription uses OAuth
    const apiKey = c.req.header('x-api-key')
        ?? c.req.header('authorization')?.replace(/^bearer\s+/i, '').trim()
        ?? process.env.ANTHROPIC_API_KEY
        ?? '';
    // System prompt compression
    if (config.compressSystemPrompt && !config.dryRun && typeof body.system === 'string') {
        body.system = await compressSystemPrompt(body.system, apiKey, 'haiku');
    }
    const messages = (body.messages ?? []);
    const originalChars = estimateChars(messages);
    const [compressedMsgs, savings] = await compressAnthropicMessages(messages, apiKey, config);
    body.messages = compressedMsgs;
    // Inject expand tool
    injectExpandToolAnthropic(body);
    stats.record(originalChars, estimateChars(compressedMsgs), savings);
    const fwdHeaders = forwardHeaders(c.req.raw.headers);
    if (body.stream) {
        const upstream = await proxyStream(`${ANTHROPIC_API}/v1/messages`, body, fwdHeaders);
        return stream(c, async (s) => {
            const reader = upstream.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                await s.write(value);
            }
        });
    }
    const resp = await fetch(`${ANTHROPIC_API}/v1/messages`, {
        method: 'POST',
        headers: { ...fwdHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const respBody = await resp.json();
    // Handle expand() call if model requested one
    const expandCall = handleAnthropicExpandCall(respBody);
    if (expandCall) {
        const { toolUseId, original } = expandCall;
        const continueMessages = [
            ...body.messages,
            { role: 'assistant', content: respBody.content },
            {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: toolUseId, content: original }],
            },
        ];
        body.messages = continueMessages;
        const continuedResp = await fetch(`${ANTHROPIC_API}/v1/messages`, {
            method: 'POST',
            headers: { ...fwdHeaders, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        const continuedBody = await continuedResp.json();
        return c.json(continuedBody, continuedResp.status);
    }
    const respHeaders = {};
    for (const [k, v] of resp.headers.entries()) {
        if (!SKIP_RESP_HEADERS.has(k.toLowerCase()))
            respHeaders[k] = v;
    }
    return c.json(respBody, resp.status, respHeaders);
});
// ── OpenAI / Codex / Ollama ───────────────────────────────────────────────────
app.post('/v1/chat/completions', async (c) => {
    const body = await c.req.json();
    const openAIKey = extractOpenAIKey(c.req.raw.headers);
    const isLocal = config.isLocalKey(openAIKey);
    const upstream = isLocal ? `${config.localUpstreamUrl.replace(/\/$/, '')}/v1/chat/completions` : `${OPENAI_API}/v1/chat/completions`;
    const messages = (body.messages ?? []);
    // Compress system message for non-local
    if (!isLocal && config.compressSystemPrompt && !config.dryRun) {
        const msgs = messages;
        if (msgs[0]?.role === 'system' && typeof msgs[0].content === 'string') {
            msgs[0].content = await compressSystemPrompt(msgs[0].content, openAIKey, 'gpt-mini');
        }
    }
    const originalChars = estimateChars(messages);
    const [compressedMsgs, savings] = await compressOpenAIMessages(messages, openAIKey, config, isLocal);
    body.messages = compressedMsgs;
    if (!isLocal)
        injectExpandToolOpenAI(body);
    stats.record(originalChars, estimateChars(compressedMsgs), savings);
    const fwdHeaders = forwardHeaders(c.req.raw.headers);
    if (body.stream) {
        const upstreamResp = await proxyStream(upstream, body, fwdHeaders);
        return stream(c, async (s) => {
            const reader = upstreamResp.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                await s.write(value);
            }
        });
    }
    const resp = await fetch(upstream, {
        method: 'POST',
        headers: { ...fwdHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const respBody = await resp.json();
    const expandCall = !isLocal ? handleOpenAIExpandCall(respBody) : null;
    if (expandCall) {
        const { toolCallId, original } = expandCall;
        const continueMessages = [
            ...body.messages,
            respBody.choices[0].message,
            { role: 'tool', tool_call_id: toolCallId, content: original },
        ];
        body.messages = continueMessages;
        const continuedResp = await fetch(upstream, {
            method: 'POST',
            headers: { ...fwdHeaders, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        return c.json(await continuedResp.json(), continuedResp.status);
    }
    const respHeaders = {};
    for (const [k, v] of resp.headers.entries()) {
        if (!SKIP_RESP_HEADERS.has(k.toLowerCase()))
            respHeaders[k] = v;
    }
    return c.json(respBody, resp.status, respHeaders);
});
// ── Gemini CLI ────────────────────────────────────────────────────────────────
app.post('/v1beta/models/*', async (c) => {
    const body = await c.req.json();
    const url = new URL(c.req.url);
    const googleKey = extractGoogleKey(c.req.raw.headers, url);
    const modelPath = c.req.path.replace('/v1beta/models/', '');
    const contents = (body.contents ?? []);
    const originalChars = estimateChars(contents);
    const [compressedContents, savings] = await compressGeminiContents(contents, googleKey, config);
    body.contents = compressedContents;
    stats.record(originalChars, estimateChars(compressedContents), savings);
    const targetUrl = `${GOOGLE_API}/v1beta/models/${modelPath}`;
    const fwdHeaders = forwardHeaders(c.req.raw.headers);
    const params = url.searchParams;
    if (modelPath.includes('stream')) {
        const upstreamResp = await proxyStream(targetUrl, body, fwdHeaders, params);
        return stream(c, async (s) => {
            const reader = upstreamResp.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                await s.write(value);
            }
        });
    }
    const paramStr = params.toString();
    const resp = await fetch(paramStr ? `${targetUrl}?${paramStr}` : targetUrl, {
        method: 'POST',
        headers: { ...fwdHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const respHeaders = {};
    for (const [k, v] of resp.headers.entries()) {
        if (!SKIP_RESP_HEADERS.has(k.toLowerCase()))
            respHeaders[k] = v;
    }
    return c.body(await resp.arrayBuffer(), resp.status, respHeaders);
});
// ── Squeezr internal endpoints ────────────────────────────────────────────────
app.get('/squeezr/stats', (c) => {
    return c.json({ ...stats.summary(), cache: getCache(config).stats(), expand_store_size: expandStoreSize(), session_cache_size: sessionCacheSize(), dry_run: config.dryRun, pattern_hits: detPatternHits });
});
app.get('/squeezr/health', (c) => {
    return c.json({ status: 'ok', version: VERSION });
});
app.get('/squeezr/expand/:id', (c) => {
    const id = c.req.param('id');
    const original = retrieveOriginal(id);
    if (!original)
        return c.json({ error: 'Not found or expired' }, 404);
    return c.json({ id, content: original });
});
// ── OAuth token refresh proxy (Codex: set CODEX_REFRESH_TOKEN_URL_OVERRIDE=http://localhost:PORT/oauth/token) ──
app.post('/oauth/token', async (c) => {
    const body = await c.req.arrayBuffer();
    const resp = await fetch('https://auth.openai.com/oauth/token', {
        method: 'POST',
        headers: { 'content-type': c.req.header('content-type') ?? 'application/json' },
        body,
    });
    const data = await resp.arrayBuffer();
    return c.body(data, resp.status, { 'content-type': 'application/json' });
});
// ── Catch-all ─────────────────────────────────────────────────────────────────
app.all('*', async (c) => {
    const upstream = detectUpstream(c.req.raw.headers);
    const url = new URL(c.req.url);
    const NEEDS_V1 = new Set(['/models', '/engines', '/files', '/embeddings', '/moderations', '/completions', '/edits', '/responses']);
    const pathname = NEEDS_V1.has(url.pathname) ? `/v1${url.pathname}` : url.pathname;
    const targetUrl = `${upstream}${pathname}${url.search}`;
    const body = await c.req.arrayBuffer();
    const fwdHeaders = forwardHeaders(c.req.raw.headers);
    // Codex CLI does not send its OAuth token when using a custom openai_base_url.
    // Inject it from ~/.codex/auth.json if the request has no authorization header.
    if (upstream === OPENAI_API && !fwdHeaders['authorization']) {
        const codexToken = readCodexToken();
        if (codexToken)
            fwdHeaders['authorization'] = `Bearer ${codexToken}`;
    }
    const resp = await fetch(targetUrl, {
        method: c.req.method,
        headers: fwdHeaders,
        body: body.byteLength > 0 ? body : undefined,
    });
    const respHeaders = {};
    for (const [k, v] of resp.headers.entries()) {
        if (!SKIP_RESP_HEADERS.has(k.toLowerCase()))
            respHeaders[k] = v;
    }
    const contentType = resp.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
        return stream(c, async (s) => {
            const reader = resp.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                await s.write(value);
            }
        });
    }
    return c.body(await resp.arrayBuffer(), resp.status, respHeaders);
});
