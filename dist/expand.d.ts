export declare function storeOriginal(original: string): string;
export declare function retrieveOriginal(id: string): string | undefined;
export declare function expandStoreSize(): number;
export declare function clearExpandStore(): void;
export declare const EXPAND_TOOL_ANTHROPIC: {
    name: string;
    description: string;
    input_schema: {
        type: string;
        properties: {
            id: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare const EXPAND_TOOL_OPENAI: {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: {
                id: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
};
export declare function injectExpandToolAnthropic(body: Record<string, unknown>): void;
export declare function injectExpandToolOpenAI(body: Record<string, unknown>): void;
/** Returns the original content if the Anthropic response contains a squeezr_expand call. */
export declare function handleAnthropicExpandCall(responseBody: Record<string, unknown>): {
    toolUseId: string;
    original: string;
} | null;
/** Returns the original content if the OpenAI response contains a squeezr_expand call. */
export declare function handleOpenAIExpandCall(responseBody: Record<string, unknown>): {
    toolCallId: string;
    original: string;
} | null;
