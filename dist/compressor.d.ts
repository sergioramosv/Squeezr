import { CompressionCache } from './cache.js';
import type { Config } from './config.js';
export interface Savings {
    compressed: number;
    savedChars: number;
    originalChars: number;
    byTool: Array<{
        tool: string;
        savedChars: number;
        originalChars: number;
    }>;
    dryRun: boolean;
    sessionCacheHits: number;
}
export declare function getCache(config: Config): CompressionCache;
interface AnthropicMessage {
    role: string;
    content: string | Array<{
        type: string;
        tool_use_id?: string;
        content?: unknown;
    }>;
}
export declare function compressAnthropicMessages(messages: AnthropicMessage[], apiKey: string, config: Config): Promise<[AnthropicMessage[], Savings]>;
interface OpenAIMessage {
    role: string;
    content?: string | null;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        function: {
            name: string;
        };
    }>;
}
export declare function compressOpenAIMessages(messages: OpenAIMessage[], apiKey: string, config: Config, isLocal?: boolean): Promise<[OpenAIMessage[], Savings]>;
interface GeminiContent {
    role: string;
    parts: Array<{
        text?: string;
        functionCall?: unknown;
        functionResponse?: {
            name: string;
            response: unknown;
        };
    }>;
}
export declare function compressGeminiContents(contents: GeminiContent[], apiKey: string, config: Config): Promise<[GeminiContent[], Savings]>;
export {};
