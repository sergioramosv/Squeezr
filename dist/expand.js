import { createHash } from 'crypto';
/**
 * Expand store — keeps original tool results so the model can retrieve
 * them if it needs more detail than the compressed summary provides.
 *
 * How it works:
 *  1. When Squeezr compresses a tool result, it stores the original here
 *     and embeds the ID in the compressed text: [squeezr:abc123 -85%] summary
 *
 *  2. A `squeezr_expand` tool is injected into every request's tool list.
 *
 *  3. If the model calls squeezr_expand(id), Squeezr intercepts the
 *     tool_use in the response and returns the original without ever
 *     hitting the provider API.
 *
 *  4. The conversation continues transparently.
 */
const store = new Map();
export function storeOriginal(original) {
    // Deterministic ID: same content always gets the same ID.
    // This is required for KV cache warming — random IDs would produce different
    // bytes on each request even for identical content, breaking Anthropic's prefix cache.
    const id = createHash('md5').update(original).digest('hex').slice(0, 6);
    store.set(id, original);
    return id;
}
export function retrieveOriginal(id) {
    return store.get(id);
}
export function expandStoreSize() {
    return store.size;
}
// ── Tool definitions ──────────────────────────────────────────────────────────
export const EXPAND_TOOL_ANTHROPIC = {
    name: 'squeezr_expand',
    description: 'Retrieve the full original content of a Squeezr-compressed tool result. ' +
        'Use this when you need more detail than the compressed summary provides.',
    input_schema: {
        type: 'object',
        properties: {
            id: {
                type: 'string',
                description: 'The 6-char ID from [squeezr:ID] in the compressed content',
            },
        },
        required: ['id'],
    },
};
export const EXPAND_TOOL_OPENAI = {
    type: 'function',
    function: {
        name: 'squeezr_expand',
        description: EXPAND_TOOL_ANTHROPIC.description,
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'The 6-char ID from [squeezr:ID] in the compressed content' },
            },
            required: ['id'],
        },
    },
};
// ── Inject helpers ────────────────────────────────────────────────────────────
export function injectExpandToolAnthropic(body) {
    if (!body.tools)
        body.tools = [];
    const tools = body.tools;
    const already = tools.some((t) => t.name === 'squeezr_expand');
    if (!already)
        tools.push(EXPAND_TOOL_ANTHROPIC);
}
export function injectExpandToolOpenAI(body) {
    if (!body.tools)
        body.tools = [];
    const tools = body.tools;
    const already = tools.some((t) => t.function?.name === 'squeezr_expand');
    if (!already)
        tools.push(EXPAND_TOOL_OPENAI);
}
/** Returns the original content if the Anthropic response contains a squeezr_expand call. */
export function handleAnthropicExpandCall(responseBody) {
    const content = responseBody.content;
    if (!content)
        return null;
    for (const block of content) {
        if (block.type === 'tool_use' && block.name === 'squeezr_expand') {
            const id = block.input?.id ?? '';
            const original = retrieveOriginal(id);
            if (original && block.id) {
                return { toolUseId: block.id, original };
            }
        }
    }
    return null;
}
/** Returns the original content if the OpenAI response contains a squeezr_expand call. */
export function handleOpenAIExpandCall(responseBody) {
    const choices = responseBody.choices;
    if (!choices?.[0])
        return null;
    const toolCalls = choices[0].message?.tool_calls;
    if (!toolCalls)
        return null;
    for (const call of toolCalls) {
        if (call.function.name === 'squeezr_expand') {
            try {
                const args = JSON.parse(call.function.arguments);
                const original = retrieveOriginal(args.id ?? '');
                if (original)
                    return { toolCallId: call.id, original };
            }
            catch { /* ignore */ }
        }
    }
    return null;
}
