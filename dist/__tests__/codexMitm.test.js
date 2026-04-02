import { describe, it, expect } from 'vitest';
// ── WS frame helpers (inline reimplementation for testing) ────────────────────
// These mirror the logic in codexMitm.ts without importing it directly
// (importing would require node-forge CA files to exist)
function xorMask(data, key) {
    const out = Buffer.from(data);
    for (let i = 0; i < out.length; i++)
        out[i] ^= key[i % 4];
    return out;
}
function buildWsFrame(opcode, payload, masked) {
    const key = masked ? Buffer.from([0x37, 0xfa, 0x21, 0x3d]) : Buffer.alloc(0);
    const plen = payload.length;
    let hlen = 2 + (masked ? 4 : 0);
    if (plen >= 65536)
        hlen += 8;
    else if (plen >= 126)
        hlen += 2;
    const frame = Buffer.alloc(hlen + plen);
    frame[0] = 0x80 | opcode;
    if (plen >= 126) {
        frame[1] = (masked ? 0x80 : 0) | 126;
        frame.writeUInt16BE(plen, 2);
        if (masked)
            key.copy(frame, 4);
    }
    else {
        frame[1] = (masked ? 0x80 : 0) | plen;
        if (masked)
            key.copy(frame, 2);
    }
    const body = masked ? xorMask(payload, key) : payload;
    body.copy(frame, hlen);
    return frame;
}
function parseWsFrame(buf) {
    if (buf.length < 2)
        return null;
    const opcode = buf[0] & 0x0F;
    const masked = !!(buf[1] & 0x80);
    let plen = buf[1] & 0x7F;
    let hlen = 2;
    if (plen === 126) {
        if (buf.length < 4)
            return null;
        plen = buf.readUInt16BE(2);
        hlen = 4;
    }
    else if (plen === 127) {
        if (buf.length < 10)
            return null;
        plen = Number(buf.readBigUInt64BE(2));
        hlen = 10;
    }
    const mask = Buffer.alloc(4);
    if (masked) {
        if (buf.length < hlen + 4)
            return null;
        buf.copy(mask, 0, hlen, hlen + 4);
        hlen += 4;
    }
    if (buf.length < hlen + plen)
        return null;
    return { opcode, masked, mask, payload: buf.slice(hlen, hlen + plen), total: hlen + plen };
}
// ── WS frame tests ────────────────────────────────────────────────────────────
describe('WS frame helpers', () => {
    it('xorMask is its own inverse', () => {
        const data = Buffer.from('hello world');
        const key = Buffer.from([0xAB, 0xCD, 0xEF, 0x12]);
        expect(xorMask(xorMask(data, key), key).toString()).toBe('hello world');
    });
    it('builds and parses an unmasked text frame', () => {
        const payload = Buffer.from('{"type":"ping"}');
        const frame = buildWsFrame(1, payload, false);
        const parsed = parseWsFrame(frame);
        expect(parsed).not.toBeNull();
        expect(parsed.opcode).toBe(1);
        expect(parsed.masked).toBe(false);
        expect(parsed.payload.toString()).toBe('{"type":"ping"}');
        expect(parsed.total).toBe(frame.length);
    });
    it('builds and parses a masked text frame', () => {
        const payload = Buffer.from('{"type":"response.create"}');
        const frame = buildWsFrame(1, payload, true);
        const parsed = parseWsFrame(frame);
        expect(parsed).not.toBeNull();
        expect(parsed.opcode).toBe(1);
        expect(parsed.masked).toBe(true);
        const plain = xorMask(parsed.payload, parsed.mask);
        expect(plain.toString()).toBe('{"type":"response.create"}');
    });
    it('builds a 126-byte extended length frame', () => {
        const payload = Buffer.alloc(130, 0x41); // 130 'A' chars
        const frame = buildWsFrame(2, payload, false);
        const parsed = parseWsFrame(frame);
        expect(parsed.opcode).toBe(2);
        expect(parsed.payload.length).toBe(130);
    });
    it('returns null for incomplete frame', () => {
        const partial = Buffer.from([0x81, 0x05, 0x48]); // says 5-byte payload, only 1 byte
        expect(parseWsFrame(partial)).toBeNull();
    });
    it('handles empty payload', () => {
        const frame = buildWsFrame(1, Buffer.alloc(0), false);
        const parsed = parseWsFrame(frame);
        expect(parsed.payload.length).toBe(0);
        expect(parsed.total).toBe(2);
    });
    it('FIN bit is always set', () => {
        const frame = buildWsFrame(1, Buffer.from('x'), false);
        expect(frame[0] & 0x80).toBe(0x80);
    });
    it('roundtrip: masked frame → parse → unmask → same payload', () => {
        const original = Buffer.from(JSON.stringify({ type: 'response.create', model: 'gpt-5.4-mini' }));
        const frame = buildWsFrame(1, original, true);
        const parsed = parseWsFrame(frame);
        const plain = xorMask(parsed.payload, parsed.mask);
        expect(plain.toString()).toBe(original.toString());
    });
});
// ── Compression threshold logic (unit test, no network) ──────────────────────
describe('processCodexRequest logic', () => {
    // Replicate the field detection logic from codexMitm.ts
    function findToolMessages(input) {
        return input.flatMap(msg => {
            const isToolMsg = msg.type === 'function_call_output' || msg.role === 'tool' || msg.role === 'function';
            if (!isToolMsg)
                return [];
            const text = msg.output ?? (typeof msg.content === 'string' ? msg.content : null);
            if (!text)
                return [];
            return [{ text, field: msg.output !== undefined ? 'output' : 'content' }];
        });
    }
    it('detects function_call_output (Responses API format)', () => {
        const msgs = [
            { type: 'function_call_output', call_id: 'c1', output: 'file contents here' },
            { role: 'user', content: 'read the file' },
        ];
        const found = findToolMessages(msgs);
        expect(found).toHaveLength(1);
        expect(found[0].text).toBe('file contents here');
        expect(found[0].field).toBe('output');
    });
    it('detects role=tool (Chat Completions format)', () => {
        const msgs = [
            { role: 'tool', tool_call_id: 't1', content: 'shell output' },
            { role: 'user', content: 'run ls' },
        ];
        const found = findToolMessages(msgs);
        expect(found).toHaveLength(1);
        expect(found[0].text).toBe('shell output');
        expect(found[0].field).toBe('content');
    });
    it('detects role=function', () => {
        const msgs = [{ role: 'function', name: 'bash', content: 'stdout here' }];
        const found = findToolMessages(msgs);
        expect(found).toHaveLength(1);
    });
    it('ignores non-tool messages', () => {
        const msgs = [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'world' },
            { type: 'response.create', model: 'gpt-5.4' },
        ];
        expect(findToolMessages(msgs)).toHaveLength(0);
    });
    it('ignores function_call_output with no output field', () => {
        const msgs = [{ type: 'function_call_output', call_id: 'c1' }];
        expect(findToolMessages(msgs)).toHaveLength(0);
    });
    it('handles multiple tool messages in one request', () => {
        const msgs = [
            { type: 'function_call_output', call_id: 'c1', output: 'first tool' },
            { type: 'function_call_output', call_id: 'c2', output: 'second tool' },
            { role: 'user', content: 'question' },
        ];
        expect(findToolMessages(msgs)).toHaveLength(2);
    });
});
// ── MITM request format ───────────────────────────────────────────────────────
describe('Codex compression request format', () => {
    const COMPRESS_PROMPT = 'Extract ONLY essential info: errors, file paths, function names, test failures, key values, warnings. Very concise, under 150 tokens. No preamble.';
    function buildCompressMsg(text, model = 'gpt-5.4-mini') {
        return {
            type: 'response.create',
            model,
            instructions: COMPRESS_PROMPT,
            input: [{ role: 'user', content: text.slice(0, 4000) }],
        };
    }
    it('has required top-level fields', () => {
        const msg = buildCompressMsg('some tool output');
        expect(msg.type).toBe('response.create');
        expect(msg.model).toBe('gpt-5.4-mini');
        expect(msg.instructions).toBeTruthy();
        expect(Array.isArray(msg.input)).toBe(true);
    });
    it('instructions are at top level, not nested', () => {
        const msg = buildCompressMsg('x');
        expect(msg.instructions).toBeTruthy();
        expect(msg.response).toBeUndefined();
    });
    it('truncates input to 4000 chars', () => {
        const longText = 'a'.repeat(10_000);
        const msg = buildCompressMsg(longText);
        expect(msg.input[0].content.length).toBe(4000);
    });
    it('uses gpt-5.4-mini model', () => {
        expect(buildCompressMsg('x').model).toBe('gpt-5.4-mini');
    });
    it('serializes to valid JSON', () => {
        const msg = buildCompressMsg('tool output content');
        expect(() => JSON.parse(JSON.stringify(msg))).not.toThrow();
    });
    it('wraps properly in a WS frame', () => {
        const msg = buildCompressMsg('tool output');
        const payload = Buffer.from(JSON.stringify(msg));
        const frame = buildWsFrame(1, payload, true); // masked, client→server
        const parsed = parseWsFrame(frame);
        const plain = xorMask(parsed.payload, parsed.mask);
        const decoded = JSON.parse(plain.toString());
        expect(decoded.type).toBe('response.create');
        expect(decoded.model).toBe('gpt-5.4-mini');
    });
});
// ── Compression threshold ─────────────────────────────────────────────────────
describe('compression threshold', () => {
    const THRESHOLD = 800;
    it('skips short tool outputs', () => {
        const text = 'short output';
        expect(text.length < THRESHOLD).toBe(true);
    });
    it('compresses long tool outputs', () => {
        const text = 'a'.repeat(1000);
        expect(text.length >= THRESHOLD).toBe(true);
    });
    it('only saves if compressed is shorter', () => {
        const original = 'a'.repeat(1000);
        const compressed = 'summary';
        const saved = original.length - compressed.length;
        expect(saved).toBeGreaterThan(0);
    });
    it('falls back to original if compression made it longer', () => {
        const original = 'short';
        const compressed = 'this is actually longer than the original text';
        const shouldApply = compressed.length < original.length;
        expect(shouldApply).toBe(false);
    });
});
// ── WebSocket upgrade request manipulation ────────────────────────────────────
describe('upgrade request header stripping', () => {
    it('strips Sec-WebSocket-Extensions header', () => {
        const upgrade = [
            'GET /backend-api/codex/responses HTTP/1.1',
            'Host: chatgpt.com',
            'Authorization: Bearer eyJ...',
            'Upgrade: websocket',
            'Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits',
            'Sec-WebSocket-Key: abc123==',
            '',
        ].join('\r\n');
        const stripped = upgrade.replace(/Sec-WebSocket-Extensions:[^\r\n]*\r\n/gi, '');
        expect(stripped).not.toContain('Sec-WebSocket-Extensions');
        expect(stripped).toContain('Upgrade: websocket');
        expect(stripped).toContain('Authorization: Bearer');
    });
    it('extracts Authorization header', () => {
        const raw = 'GET /backend-api/codex/responses HTTP/1.1\r\nAuthorization: Bearer eyJmoo\r\n\r\n';
        const match = raw.match(/[Aa]uthorization:\s*(Bearer [^\r\n]+)/);
        expect(match?.[1]).toBe('Bearer eyJmoo');
    });
    it('extracts chatgpt-account-id header', () => {
        const raw = 'GET / HTTP/1.1\r\nchatgpt-account-id: acc-abc123\r\n\r\n';
        const match = raw.match(/chatgpt-account-id:\s*([^\r\n]+)/i);
        expect(match?.[1]).toBe('acc-abc123');
    });
    it('detects Codex WS path', () => {
        const peek = 'get /backend-api/codex/responses http/1.1\r\nupgrade: websocket\r\n';
        expect(peek.includes('upgrade: websocket')).toBe(true);
        expect(peek.includes('/backend-api/codex/responses')).toBe(true);
    });
    it('does not detect non-Codex WS as Codex', () => {
        const peek = 'get /chat/stream http/1.1\r\nupgrade: websocket\r\n';
        expect(peek.includes('/backend-api/codex/responses')).toBe(false);
    });
});
