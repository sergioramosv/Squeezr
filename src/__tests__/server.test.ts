import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks (accessible inside vi.mock factories) ─────────────────────

const {
  mockCompressAnthropic,
  mockCompressOpenAI,
  mockCompressGemini,
  mockGetCache,
  mockCompressSystemPrompt,
  mockInjectExpandAnthropic,
  mockInjectExpandOpenAI,
  mockHandleAnthropicExpandCall,
  mockHandleOpenAIExpandCall,
  mockRetrieveOriginal,
  mockExpandStoreSize,
  mockConfig,
  mockStatsRecord,
  mockFetch,
} = vi.hoisted(() => {
  const emptySavings = { compressed: 0, savedChars: 0, originalChars: 0, byTool: [], dryRun: false, sessionCacheHits: 0 }
  return {
    mockCompressAnthropic: vi.fn().mockResolvedValue([[], emptySavings]),
    mockCompressOpenAI: vi.fn().mockResolvedValue([[], emptySavings]),
    mockCompressGemini: vi.fn().mockResolvedValue([[], emptySavings]),
    mockGetCache: vi.fn().mockReturnValue({ stats: () => ({ size: 0, hits: 0, misses: 0 }) }),
    mockCompressSystemPrompt: vi.fn().mockResolvedValue('compressed system'),
    mockInjectExpandAnthropic: vi.fn(),
    mockInjectExpandOpenAI: vi.fn(),
    mockHandleAnthropicExpandCall: vi.fn().mockReturnValue(null),
    mockHandleOpenAIExpandCall: vi.fn().mockReturnValue(null),
    mockRetrieveOriginal: vi.fn(),
    mockExpandStoreSize: vi.fn().mockReturnValue(0),
    mockConfig: {
      compressSystemPrompt: false,
      dryRun: false,
      isLocalKey: vi.fn().mockReturnValue(false),
      localUpstreamUrl: 'http://localhost:11434',
      disabled: false,
      skipTools: new Set<string>(),
      onlyTools: new Set<string>(),
    },
    mockStatsRecord: vi.fn(),
    mockFetch: vi.fn(),
  }
})

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../compressor.js', () => ({
  compressAnthropicMessages: (...args: unknown[]) => mockCompressAnthropic(...args),
  compressOpenAIMessages: (...args: unknown[]) => mockCompressOpenAI(...args),
  compressGeminiContents: (...args: unknown[]) => mockCompressGemini(...args),
  getCache: (...args: unknown[]) => mockGetCache(...args),
}))

vi.mock('../systemPrompt.js', () => ({
  compressSystemPrompt: (...args: unknown[]) => mockCompressSystemPrompt(...args),
}))

vi.mock('../expand.js', () => ({
  injectExpandToolAnthropic: (...args: unknown[]) => mockInjectExpandAnthropic(...args),
  injectExpandToolOpenAI: (...args: unknown[]) => mockInjectExpandOpenAI(...args),
  handleAnthropicExpandCall: (...args: unknown[]) => mockHandleAnthropicExpandCall(...args),
  handleOpenAIExpandCall: (...args: unknown[]) => mockHandleOpenAIExpandCall(...args),
  retrieveOriginal: (...args: unknown[]) => mockRetrieveOriginal(...args),
  expandStoreSize: () => mockExpandStoreSize(),
}))

vi.mock('../sessionCache.js', () => ({
  sessionCacheSize: () => 0,
}))

vi.mock('../deterministic.js', () => ({
  detPatternHits: {},
}))

vi.mock('../version.js', () => ({
  VERSION: '1.0.0-test',
}))

vi.mock('../config.js', () => ({
  config: mockConfig,
}))

vi.mock('../stats.js', () => ({
  Stats: vi.fn().mockImplementation(() => ({
    record: mockStatsRecord,
    summary: () => ({ requests: 0, saved_chars: 0, saved_tokens: 0, savings_pct: '0%' }),
  })),
}))

vi.stubGlobal('fetch', mockFetch)

import { app } from '../server.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function streamResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(ctrl) {
      for (const chunk of chunks) ctrl.enqueue(encoder.encode(chunk))
      ctrl.close()
    },
  })
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } })
}

function makeRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:8080${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.compressSystemPrompt = false
  mockConfig.dryRun = false
  mockConfig.isLocalKey.mockReturnValue(false)
  mockCompressAnthropic.mockResolvedValue([
    [{ role: 'user', content: 'compressed' }],
    { compressed: 1, savedChars: 100, originalChars: 200, byTool: [], dryRun: false, sessionCacheHits: 0 },
  ])
  mockCompressOpenAI.mockResolvedValue([
    [{ role: 'user', content: 'compressed' }],
    { compressed: 1, savedChars: 50, originalChars: 150, byTool: [], dryRun: false, sessionCacheHits: 0 },
  ])
  mockCompressGemini.mockResolvedValue([
    [{ role: 'user', parts: [{ text: 'compressed' }] }],
    { compressed: 1, savedChars: 30, originalChars: 100, byTool: [], dryRun: false, sessionCacheHits: 0 },
  ])
})

// ── Anthropic /v1/messages ───────────────────────────────────────────────────

describe('POST /v1/messages (Anthropic)', () => {
  const anthropicBody = {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 1024,
  }

  it('forwards request to Anthropic API and returns JSON response', async () => {
    const apiResp = { id: 'msg_123', content: [{ text: 'world' }], stop_reason: 'end_turn' }
    mockFetch.mockResolvedValueOnce(jsonResponse(apiResp))

    const res = await app.request(
      makeRequest('/v1/messages', anthropicBody, { 'x-api-key': 'sk-ant-test' }),
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual(apiResp)
  })

  it('calls compressAnthropicMessages with messages and apiKey', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ content: [] }))

    await app.request(
      makeRequest('/v1/messages', anthropicBody, { 'x-api-key': 'sk-ant-key123' }),
    )

    expect(mockCompressAnthropic).toHaveBeenCalledWith(
      expect.any(Array),
      'sk-ant-key123',
      expect.objectContaining({ dryRun: false }),
    )
  })

  it('extracts API key from x-api-key header', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ content: [] }))

    await app.request(
      makeRequest('/v1/messages', anthropicBody, { 'x-api-key': 'sk-ant-mykey' }),
    )

    expect(mockCompressAnthropic).toHaveBeenCalledWith(
      expect.any(Array),
      'sk-ant-mykey',
      expect.anything(),
    )
  })

  it('extracts API key from Authorization bearer header', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ content: [] }))

    await app.request(
      makeRequest('/v1/messages', anthropicBody, { authorization: 'Bearer oauth-token-123' }),
    )

    expect(mockCompressAnthropic).toHaveBeenCalledWith(
      expect.any(Array),
      'oauth-token-123',
      expect.anything(),
    )
  })

  it('injects expand tool into request', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ content: [] }))

    await app.request(
      makeRequest('/v1/messages', anthropicBody, { 'x-api-key': 'sk-ant-test' }),
    )

    expect(mockInjectExpandAnthropic).toHaveBeenCalled()
  })

  it('records stats after compression', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ content: [] }))

    await app.request(
      makeRequest('/v1/messages', anthropicBody, { 'x-api-key': 'sk-ant-test' }),
    )

    expect(mockStatsRecord).toHaveBeenCalled()
  })

  it('compresses system prompt when enabled', async () => {
    mockConfig.compressSystemPrompt = true
    mockFetch.mockResolvedValueOnce(jsonResponse({ content: [] }))

    const body = { ...anthropicBody, system: 'You are a helpful assistant with lots of context...' }
    await app.request(
      makeRequest('/v1/messages', body, { 'x-api-key': 'sk-ant-test' }),
    )

    expect(mockCompressSystemPrompt).toHaveBeenCalledWith(
      'You are a helpful assistant with lots of context...',
      'sk-ant-test',
      'haiku',
    )
  })

  it('does NOT compress system prompt when disabled', async () => {
    mockConfig.compressSystemPrompt = false
    mockFetch.mockResolvedValueOnce(jsonResponse({ content: [] }))

    const body = { ...anthropicBody, system: 'System prompt here' }
    await app.request(
      makeRequest('/v1/messages', body, { 'x-api-key': 'sk-ant-test' }),
    )

    expect(mockCompressSystemPrompt).not.toHaveBeenCalled()
  })

  it('does NOT compress system prompt when dryRun is true', async () => {
    mockConfig.compressSystemPrompt = true
    mockConfig.dryRun = true
    mockFetch.mockResolvedValueOnce(jsonResponse({ content: [] }))

    const body = { ...anthropicBody, system: 'System prompt here' }
    await app.request(
      makeRequest('/v1/messages', body, { 'x-api-key': 'sk-ant-test' }),
    )

    expect(mockCompressSystemPrompt).not.toHaveBeenCalled()
  })

  it('handles streaming responses', async () => {
    mockFetch.mockResolvedValueOnce(streamResponse(['data: chunk1\n', 'data: chunk2\n']))

    const streamBody = { ...anthropicBody, stream: true }
    const res = await app.request(
      makeRequest('/v1/messages', streamBody, { 'x-api-key': 'sk-ant-test' }),
    )

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('chunk1')
    expect(text).toContain('chunk2')
  })

  it('handles expand tool call from model response', async () => {
    mockHandleAnthropicExpandCall.mockReturnValueOnce({
      toolUseId: 'tu_123',
      original: 'full original content',
    })
    // First response: model calls expand tool
    mockFetch.mockResolvedValueOnce(jsonResponse({
      content: [{ type: 'tool_use', id: 'tu_123', name: 'squeezr_expand', input: { id: 'abc123' } }],
    }))
    // Second response: continued with expanded content
    mockFetch.mockResolvedValueOnce(jsonResponse({
      content: [{ text: 'Response after expand' }],
    }))

    const res = await app.request(
      makeRequest('/v1/messages', anthropicBody, { 'x-api-key': 'sk-ant-test' }),
    )

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const json = await res.json()
    expect(json.content[0].text).toBe('Response after expand')
  })

  it('preserves headers from upstream response', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(
      { content: [] },
      200,
      { 'x-request-id': 'req_abc', 'x-custom-header': 'value' },
    ))

    const res = await app.request(
      makeRequest('/v1/messages', anthropicBody, { 'x-api-key': 'sk-ant-test' }),
    )

    expect(res.headers.get('x-request-id')).toBe('req_abc')
  })

  it('strips connection/encoding headers from upstream response', async () => {
    const upstream = new Response(JSON.stringify({ content: [] }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'transfer-encoding': 'chunked',
        'connection': 'keep-alive',
        'content-length': '123',
      },
    })
    mockFetch.mockResolvedValueOnce(upstream)

    const res = await app.request(
      makeRequest('/v1/messages', anthropicBody, { 'x-api-key': 'sk-ant-test' }),
    )

    // These should be stripped
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('transfer-encoding')).toBeNull()
    expect(res.headers.get('connection')).toBeNull()
  })

  it('propagates upstream error status codes', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(
      { error: { type: 'rate_limit_error', message: 'Too many requests' } },
      429,
    ))

    const res = await app.request(
      makeRequest('/v1/messages', anthropicBody, { 'x-api-key': 'sk-ant-test' }),
    )

    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.error.type).toBe('rate_limit_error')
  })
})

// ── OpenAI /v1/chat/completions ──────────────────────────────────────────────

describe('POST /v1/chat/completions (OpenAI)', () => {
  const openAIBody = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
  }

  it('forwards request to OpenAI API and returns JSON response', async () => {
    const apiResp = { id: 'chatcmpl-123', choices: [{ message: { content: 'hi' } }] }
    mockFetch.mockResolvedValueOnce(jsonResponse(apiResp))

    const res = await app.request(
      makeRequest('/v1/chat/completions', openAIBody, { authorization: 'Bearer sk-openai-key' }),
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.choices[0].message.content).toBe('hi')
  })

  it('calls compressOpenAIMessages with messages and key', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [] }))

    await app.request(
      makeRequest('/v1/chat/completions', openAIBody, { authorization: 'Bearer sk-key' }),
    )

    expect(mockCompressOpenAI).toHaveBeenCalledWith(
      expect.any(Array),
      'sk-key',
      expect.anything(),
      false,
    )
  })

  it('routes to local upstream when key is local', async () => {
    mockConfig.isLocalKey.mockReturnValue(true)
    mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [] }))

    await app.request(
      makeRequest('/v1/chat/completions', openAIBody, { authorization: 'Bearer local-key' }),
    )

    const fetchCall = mockFetch.mock.calls[0]
    expect(fetchCall[0]).toContain('localhost:11434')
  })

  it('does NOT inject expand tool for local keys', async () => {
    mockConfig.isLocalKey.mockReturnValue(true)
    mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [] }))

    await app.request(
      makeRequest('/v1/chat/completions', openAIBody, { authorization: 'Bearer local-key' }),
    )

    expect(mockInjectExpandOpenAI).not.toHaveBeenCalled()
  })

  it('injects expand tool for non-local keys', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [] }))

    await app.request(
      makeRequest('/v1/chat/completions', openAIBody, { authorization: 'Bearer sk-real-key' }),
    )

    expect(mockInjectExpandOpenAI).toHaveBeenCalled()
  })

  it('handles streaming responses', async () => {
    mockFetch.mockResolvedValueOnce(streamResponse(['data: {"chunk":1}\n', 'data: [DONE]\n']))

    const streamBody = { ...openAIBody, stream: true }
    const res = await app.request(
      makeRequest('/v1/chat/completions', streamBody, { authorization: 'Bearer sk-key' }),
    )

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('chunk')
  })

  it('handles expand tool call from OpenAI response', async () => {
    mockHandleOpenAIExpandCall.mockReturnValueOnce({
      toolCallId: 'call_abc',
      original: 'expanded content here',
    })
    mockFetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { tool_calls: [{ id: 'call_abc', function: { name: 'squeezr_expand' } }] } }],
    }))
    mockFetch.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { content: 'Final response' } }],
    }))

    const res = await app.request(
      makeRequest('/v1/chat/completions', openAIBody, { authorization: 'Bearer sk-key' }),
    )

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('compresses system message for non-local when enabled', async () => {
    mockConfig.compressSystemPrompt = true
    mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [] }))

    const body = {
      ...openAIBody,
      messages: [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'hello' },
      ],
    }
    await app.request(
      makeRequest('/v1/chat/completions', body, { authorization: 'Bearer sk-key' }),
    )

    expect(mockCompressSystemPrompt).toHaveBeenCalledWith(
      'You are a helpful assistant',
      'sk-key',
      'gpt-mini',
    )
  })

  it('does NOT compress system message for local keys', async () => {
    mockConfig.compressSystemPrompt = true
    mockConfig.isLocalKey.mockReturnValue(true)
    mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [] }))

    const body = {
      ...openAIBody,
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'hello' },
      ],
    }
    await app.request(
      makeRequest('/v1/chat/completions', body, { authorization: 'Bearer local-key' }),
    )

    expect(mockCompressSystemPrompt).not.toHaveBeenCalled()
  })
})

// ── Gemini /v1beta/models/* ──────────────────────────────────────────────────

describe('POST /v1beta/models/* (Gemini)', () => {
  const geminiBody = {
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
  }

  it('forwards request to Google API and returns response', async () => {
    const apiResp = { candidates: [{ content: { parts: [{ text: 'hi' }] } }] }
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(apiResp), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const res = await app.request(
      makeRequest('/v1beta/models/gemini-pro:generateContent', geminiBody, {
        'x-goog-api-key': 'AIza-testkey',
      }),
    )

    expect(res.status).toBe(200)
  })

  it('calls compressGeminiContents with contents and key', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))

    await app.request(
      makeRequest('/v1beta/models/gemini-pro:generateContent', geminiBody, {
        'x-goog-api-key': 'AIza-key',
      }),
    )

    expect(mockCompressGemini).toHaveBeenCalledWith(
      expect.any(Array),
      'AIza-key',
      expect.anything(),
    )
  })

  it('extracts google key from query parameter', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))

    const req = new Request(
      'http://localhost:8080/v1beta/models/gemini-pro:generateContent?key=AIza-querykey',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(geminiBody),
      },
    )
    await app.request(req)

    expect(mockCompressGemini).toHaveBeenCalledWith(
      expect.any(Array),
      'AIza-querykey',
      expect.anything(),
    )
  })

  it('handles streaming Gemini responses', async () => {
    mockFetch.mockResolvedValueOnce(streamResponse(['data: chunk1\n', 'data: chunk2\n']))

    const res = await app.request(
      makeRequest('/v1beta/models/gemini-pro:streamGenerateContent', geminiBody, {
        'x-goog-api-key': 'AIza-key',
      }),
    )

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('chunk1')
  })

  it('records stats for Gemini compression', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))

    await app.request(
      makeRequest('/v1beta/models/gemini-pro:generateContent', geminiBody, {
        'x-goog-api-key': 'AIza-key',
      }),
    )

    expect(mockStatsRecord).toHaveBeenCalled()
  })
})

// ── Internal endpoints ───────────────────────────────────────────────────────

describe('GET /squeezr/stats', () => {
  it('returns stats summary with cache and expand info', async () => {
    const res = await app.request(new Request('http://localhost:8080/squeezr/stats'))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toHaveProperty('requests')
    expect(json).toHaveProperty('cache')
    expect(json).toHaveProperty('expand_store_size')
    expect(json).toHaveProperty('session_cache_size')
    expect(json).toHaveProperty('dry_run')
    expect(json).toHaveProperty('pattern_hits')
  })
})

describe('GET /squeezr/health', () => {
  it('returns ok status with version', async () => {
    const res = await app.request(new Request('http://localhost:8080/squeezr/health'))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
    expect(json.version).toBe('1.0.0-test')
  })
})

describe('GET /squeezr/expand/:id', () => {
  it('returns original content when found', async () => {
    mockRetrieveOriginal.mockReturnValueOnce('the original content')

    const res = await app.request(new Request('http://localhost:8080/squeezr/expand/abc123'))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.id).toBe('abc123')
    expect(json.content).toBe('the original content')
  })

  it('returns 404 when not found or expired', async () => {
    mockRetrieveOriginal.mockReturnValueOnce(undefined)

    const res = await app.request(new Request('http://localhost:8080/squeezr/expand/missing'))

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toContain('Not found')
  })
})

// ── Catch-all proxy ──────────────────────────────────────────────────────────

describe('catch-all proxy', () => {
  it('forwards unknown routes to detected upstream', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const res = await app.request(new Request('http://localhost:8080/v1/models', {
      method: 'GET',
      headers: { 'x-api-key': 'sk-ant-test' },
    }))

    expect(res.status).toBe(200)
    const call = mockFetch.mock.calls[0]
    expect(call[0]).toContain('api.anthropic.com/v1/models')
  })

  it('detects OpenAI upstream from authorization header', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await app.request(new Request('http://localhost:8080/v1/models', {
      headers: { authorization: 'Bearer sk-openai-key' },
    }))

    const call = mockFetch.mock.calls[0]
    expect(call[0]).toContain('api.openai.com')
  })

  it('detects Google upstream from x-goog-api-key header', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await app.request(new Request('http://localhost:8080/v1/models', {
      headers: { 'x-goog-api-key': 'AIza-key' },
    }))

    const call = mockFetch.mock.calls[0]
    expect(call[0]).toContain('generativelanguage.googleapis.com')
  })

  it('strips connection headers from upstream response', async () => {
    const upstream = new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'connection': 'keep-alive',
      },
    })
    mockFetch.mockResolvedValueOnce(upstream)

    const res = await app.request(new Request('http://localhost:8080/v1/models', {
      headers: { 'x-api-key': 'sk-ant-test' },
    }))

    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('connection')).toBeNull()
  })

  it('forwards empty body for GET requests', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))

    await app.request(new Request('http://localhost:8080/v1/models', {
      method: 'GET',
      headers: { 'x-api-key': 'sk-ant-test' },
    }))

    const call = mockFetch.mock.calls[0]
    expect(call[1].body).toBeUndefined()
  })
})

// ── Header forwarding ────────────────────────────────────────────────────────

describe('header forwarding', () => {
  it('strips hop-by-hop headers from outgoing requests', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ content: [] }))

    await app.request(new Request('http://localhost:8080/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'sk-ant-test',
        'host': 'localhost:8080',
        'connection': 'keep-alive',
        'transfer-encoding': 'chunked',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 100,
      }),
    }))

    const fetchHeaders = mockFetch.mock.calls[0][1].headers
    expect(fetchHeaders.host).toBeUndefined()
    expect(fetchHeaders.connection).toBeUndefined()
    expect(fetchHeaders['transfer-encoding']).toBeUndefined()
    // But x-api-key should be preserved
    expect(fetchHeaders['x-api-key']).toBe('sk-ant-test')
  })
})

// ── Error propagation ────────────────────────────────────────────────────────

describe('error propagation', () => {
  it('propagates 500 errors from Anthropic', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(
      { error: { type: 'api_error', message: 'Internal server error' } },
      500,
    ))

    const res = await app.request(
      makeRequest('/v1/messages', {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 100,
      }, { 'x-api-key': 'sk-ant-test' }),
    )

    expect(res.status).toBe(500)
  })

  it('propagates 401 unauthorized errors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(
      { error: { type: 'authentication_error', message: 'Invalid API key' } },
      401,
    ))

    const res = await app.request(
      makeRequest('/v1/messages', {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 100,
      }, { 'x-api-key': 'invalid-key' }),
    )

    expect(res.status).toBe(401)
  })
})
