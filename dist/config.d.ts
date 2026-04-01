export declare class Config {
    readonly port: number;
    readonly threshold: number;
    readonly keepRecent: number;
    readonly disabled: boolean;
    readonly compressSystemPrompt: boolean;
    readonly compressConversation: boolean;
    readonly dryRun: boolean;
    readonly skipTools: Set<string>;
    readonly onlyTools: Set<string>;
    readonly cacheEnabled: boolean;
    readonly cacheMaxEntries: number;
    readonly adaptiveEnabled: boolean;
    readonly adaptiveLow: number;
    readonly adaptiveMid: number;
    readonly adaptiveHigh: number;
    readonly adaptiveCritical: number;
    readonly localEnabled: boolean;
    readonly localUpstreamUrl: string;
    readonly localCompressionModel: string;
    readonly localDummyKeys: Set<string>;
    constructor();
    thresholdForPressure(pressure: number): number;
    shouldSkipTool(toolName: string): boolean;
    isLocalKey(key: string): boolean;
}
export declare const config: Config;
