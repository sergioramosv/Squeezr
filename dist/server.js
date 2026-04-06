import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Hono } from 'hono';
import { stream, streamSSE } from 'hono/streaming';
import { config, applyMode, runtimeOverrides } from './config.js';
import { Stats } from './stats.js';
import { DASHBOARD_HTML } from './dashboard.js';
import { getCache } from './compressor.js';
import { compressAnthropicMessages, compressOpenAIMessages, compressGeminiContents, } from './compressor.js';
import { injectExpandToolAnthropic, injectExpandToolOpenAI, handleAnthropicExpandCall, handleOpenAIExpandCall, retrieveOriginal, expandStoreSize, } from './expand.js';
import { compressSystemPrompt } from './systemPrompt.js';
import { sessionCacheSize } from './sessionCache.js';
import { detPatternHits } from './deterministic.js';
import { VERSION } from './version.js';
import { recordRequest, getCurrentSession, getProjectAggregates, getAllSessionsForHistory, } from './history.js';
import { updateAnthropicFromHeaders, updateOpenAIFromHeaders, updateGeminiFrom429, addAnthropicUsage, addOpenAIUsage, addGeminiUsage, makeSseUsageParser, maybeRefreshOpenAIBilling, storeKey, limitsSnapshot, } from './limits.js';
// ── Project name extraction ────────────────────────────────────────────────────
// Reads the CWD from Claude Code's system prompt (injected as <cwd>…</cwd> or
// "current working directory: …") and returns the last path component.
function extractProjectName(body) {
    try {
        const system = body.system;
        let text = '';
        if (Array.isArray(system)) {
            text = system
                .map(s => s.text ?? '')
                .join(' ');
        }
        else if (typeof system === 'string') {
            text = system;
        }
        // Claude Code format: <cwd>/path/to/project</cwd>
        const xmlCwd = text.match(/<cwd>([^<]+)<\/cwd>/);
        if (xmlCwd) {
            const parts = xmlCwd[1].trim().replace(/\\/g, '/').split('/').filter(Boolean);
            if (parts.length)
                return parts[parts.length - 1];
        }
        // Plain-text format: "current working directory: /path"
        const plainCwd = text.match(/(?:current working directory|cwd)[:\s]+([^\n<]+)/i);
        if (plainCwd) {
            const parts = plainCwd[1].trim().replace(/\\/g, '/').split('/').filter(Boolean);
            if (parts.length)
                return parts[parts.length - 1];
        }
        // Fallback: scan messages for file paths like /Users/…/Project or C:\…\Project
        const messages = body.messages;
        if (Array.isArray(messages)) {
            for (const msg of messages.slice(-5)) {
                const blocks = Array.isArray(msg.content) ? msg.content : [msg.content];
                for (const block of blocks) {
                    const t = typeof block === 'string' ? block : block?.text ?? '';
                    const m = t.match(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|workspace|projects|Documents)[\\/])([^\s<>"\\/:*?|]+)/i);
                    if (m)
                        return m[1];
                }
            }
        }
    }
    catch { /* ignore */ }
    return 'unknown';
}
const ANTHROPIC_API = 'https://api.anthropic.com';
const OPENAI_API = 'https://api.openai.com';
const GOOGLE_API = 'https://generativelanguage.googleapis.com';
const SKIP_REQ_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'expect']);
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
// ── CORS middleware (required for Cursor IDE and browser-based tools) ─────────
// Cursor's Electron renderer sends OPTIONS preflight before every POST.
// Without this the request is blocked and Cursor shows a network error.
app.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS') {
        return c.body(null, 204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400',
        });
    }
    await next();
    c.res.headers.set('Access-Control-Allow-Origin', '*');
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    c.res.headers.set('Access-Control-Allow-Headers', '*');
});
// ── Anthropic / Claude Code ───────────────────────────────────────────────────
app.post('/v1/messages', async (c) => {
    const body = await c.req.json();
    // Support both API key (x-api-key: sk-ant-...) and OAuth bearer token
    // (Authorization: Bearer ...) — Claude Code subscription uses OAuth
    const apiKey = c.req.header('x-api-key')
        ?? c.req.header('authorization')?.replace(/^bearer\s+/i, '').trim()
        ?? process.env.ANTHROPIC_API_KEY
        ?? '';
    // System prompt compression (handles both string and array formats — Claude Code sends array)
    if (config.compressSystemPrompt && !config.dryRun) {
        if (typeof body.system === 'string') {
            body.system = await compressSystemPrompt(body.system, apiKey, 'haiku');
        }
        else if (Array.isArray(body.system)) {
            for (const block of body.system) {
                if (block.type === 'text' && typeof block.text === 'string') {
                    block.text = await compressSystemPrompt(block.text, apiKey, 'haiku');
                }
            }
        }
    }
    const messages = (body.messages ?? []);
    const originalChars = estimateChars(messages);
    const systemExtraChars = typeof body.system === 'string'
        ? body.system.length
        : Array.isArray(body.system)
            ? body.system.reduce((s, b) => s + (b.text?.length ?? 0), 0)
            : 0;
    const [compressedMsgs, savings] = await compressAnthropicMessages(messages, apiKey, config, systemExtraChars);
    body.messages = compressedMsgs;
    // Inject expand tool
    injectExpandToolAnthropic(body);
    const project = extractProjectName(body);
    stats.recordWithProject(project, originalChars, estimateChars(compressedMsgs), savings);
    recordRequest(project, savings.savedChars, savings.compressed, savings.byTool);
    storeKey('anthropic', apiKey);
    const fwdHeaders = forwardHeaders(c.req.raw.headers);
    if (body.stream) {
        const upstream = await proxyStream(`${ANTHROPIC_API}/v1/messages`, body, fwdHeaders);
        // Extract rate limit headers immediately (available before body starts)
        updateAnthropicFromHeaders(upstream.headers);
        return stream(c, async (s) => {
            const reader = upstream.body.getReader();
            const decoder = new TextDecoder();
            const sseParser = makeSseUsageParser('anthropic', (inp, out) => addAnthropicUsage(inp, out));
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                await s.write(value);
                sseParser(decoder.decode(value, { stream: true }));
            }
        });
    }
    const resp = await fetch(`${ANTHROPIC_API}/v1/messages`, {
        method: 'POST',
        headers: { ...fwdHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    // Extract rate limits and token usage from non-streaming response
    updateAnthropicFromHeaders(resp.headers);
    const respBody = await resp.json();
    if (respBody.usage) {
        const u = respBody.usage;
        addAnthropicUsage(u.input_tokens ?? 0, u.output_tokens ?? 0);
    }
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
    const oaiProject = extractProjectName(body);
    stats.recordWithProject(oaiProject, originalChars, estimateChars(compressedMsgs), savings);
    recordRequest(oaiProject, savings.savedChars, savings.compressed, savings.byTool);
    if (!isLocal)
        storeKey('openai', openAIKey);
    const fwdHeaders = forwardHeaders(c.req.raw.headers);
    if (body.stream) {
        // Ask OpenAI to include usage in the final chunk (harmless for most clients)
        if (!isLocal && !body.stream_options?.include_usage) {
            body.stream_options = { ...(body.stream_options ?? {}), include_usage: true };
        }
        const upstreamResp = await proxyStream(upstream, body, fwdHeaders);
        if (!isLocal)
            updateOpenAIFromHeaders(upstreamResp.headers);
        return stream(c, async (s) => {
            const reader = upstreamResp.body.getReader();
            const decoder = new TextDecoder();
            const sseParser = makeSseUsageParser('openai', (inp, out) => addOpenAIUsage(inp, out));
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                await s.write(value);
                if (!isLocal)
                    sseParser(decoder.decode(value, { stream: true }));
            }
        });
    }
    const resp = await fetch(upstream, {
        method: 'POST',
        headers: { ...fwdHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!isLocal) {
        updateOpenAIFromHeaders(resp.headers);
        maybeRefreshOpenAIBilling(openAIKey).catch(() => { });
    }
    const respBody = await resp.json();
    if (!isLocal && respBody.usage) {
        const u = respBody.usage;
        addOpenAIUsage(u.prompt_tokens ?? 0, u.completion_tokens ?? 0);
    }
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
    const geminiProject = extractProjectName(body);
    stats.recordWithProject(geminiProject, originalChars, estimateChars(compressedContents), savings);
    recordRequest(geminiProject, savings.savedChars, savings.compressed, savings.byTool);
    const targetUrl = `${GOOGLE_API}/v1beta/models/${modelPath}`;
    const fwdHeaders = forwardHeaders(c.req.raw.headers);
    const params = url.searchParams;
    if (modelPath.includes('stream')) {
        const upstreamResp = await proxyStream(targetUrl, body, fwdHeaders, params);
        if (upstreamResp.status === 429)
            updateGeminiFrom429(upstreamResp.headers);
        return stream(c, async (s) => {
            const reader = upstreamResp.body.getReader();
            const decoder = new TextDecoder();
            const sseParser = makeSseUsageParser('anthropic', (inp, out) => addGeminiUsage(inp, out)); // Gemini SSE same structure for usage counts
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                await s.write(value);
                sseParser(decoder.decode(value, { stream: true }));
            }
        });
    }
    const paramStr = params.toString();
    const resp = await fetch(paramStr ? `${targetUrl}?${paramStr}` : targetUrl, {
        method: 'POST',
        headers: { ...fwdHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (resp.status === 429)
        updateGeminiFrom429(resp.headers);
    // Extract Gemini usage from response body
    const geminiRespBuf = await resp.arrayBuffer();
    try {
        const geminiRespJson = JSON.parse(new TextDecoder().decode(geminiRespBuf));
        const meta = geminiRespJson.usageMetadata;
        if (meta)
            addGeminiUsage(meta.promptTokenCount ?? 0, meta.candidatesTokenCount ?? 0);
    }
    catch { /* ignore */ }
    const respHeaders = {};
    for (const [k, v] of resp.headers.entries()) {
        if (!SKIP_RESP_HEADERS.has(k.toLowerCase()))
            respHeaders[k] = v;
    }
    return c.body(geminiRespBuf, resp.status, respHeaders);
});
// ── Squeezr internal endpoints ────────────────────────────────────────────────
function buildStatsPayload() {
    return {
        ...stats.summary(),
        cache: getCache(config).stats(),
        expand_store_size: expandStoreSize(),
        session_cache_size: sessionCacheSize(),
        dry_run: config.dryRun,
        pattern_hits: detPatternHits,
        version: VERSION,
        port: config.port,
        mode: runtimeOverrides.mode,
        limits: limitsSnapshot(),
    };
}
app.get('/squeezr/stats', (c) => {
    return c.json(buildStatsPayload());
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
// ── Dashboard + SSE + config ──────────────────────────────────────────────────
app.get('/squeezr/dashboard', (c) => {
    return c.html(DASHBOARD_HTML);
});
app.get('/squeezr/events', (c) => {
    return streamSSE(c, async (s) => {
        await s.writeSSE({ data: JSON.stringify(buildStatsPayload()) });
        while (true) {
            await s.sleep(2000);
            try {
                await s.writeSSE({ data: JSON.stringify(buildStatsPayload()) });
            }
            catch {
                break;
            }
        }
    });
});
app.get('/squeezr/limits', (c) => {
    return c.json(limitsSnapshot());
});
// ── History + Projects endpoints ──────────────────────────────────────────────
app.get('/squeezr/history', (c) => {
    return c.json({
        sessions: getAllSessionsForHistory(),
        current: getCurrentSession(),
    });
});
app.get('/squeezr/projects', (c) => {
    return c.json({ projects: getProjectAggregates() });
});
// ── Control endpoints ─────────────────────────────────────────────────────────
app.post('/squeezr/control/stop', (c) => {
    // Respond first, then exit gracefully after a tick
    setTimeout(() => process.emit('SIGTERM'), 200);
    return c.json({ ok: true, message: 'Squeezr proxy shutting down…' });
});
app.post('/squeezr/config', async (c) => {
    const body = await c.req.json();
    if (body.mode && ['soft', 'normal', 'aggressive', 'critical'].includes(body.mode)) {
        applyMode(body.mode);
    }
    return c.json({ ok: true, mode: runtimeOverrides.mode });
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
    let upstream = detectUpstream(c.req.raw.headers);
    const url = new URL(c.req.url);
    const NEEDS_V1 = new Set(['/models', '/engines', '/files', '/embeddings', '/moderations', '/completions', '/edits', '/responses']);
    const pathname = NEEDS_V1.has(url.pathname) ? `/v1${url.pathname}` : url.pathname;
    // /responses is exclusively an OpenAI Codex endpoint — override upstream regardless
    // of what detectUpstream inferred from headers (Codex sends no auth to custom base URLs).
    if (pathname === '/v1/responses')
        upstream = OPENAI_API;
    const targetUrl = `${upstream}${pathname}${url.search}`;
    const body = await c.req.arrayBuffer();
    const fwdHeaders = forwardHeaders(c.req.raw.headers);
    // Inject Codex OAuth token from ~/.codex/auth.json when no auth header present.
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
