/**
 * Deterministic pre-compression pipeline.
 *
 * Two layers:
 *
 * 1. Base pipeline — runs on all tool results regardless of tool type.
 *    Pipeline order matters:
 *     1. Strip ANSI codes        (noise removal)
 *     2. Strip progress bars     (noise removal)
 *     3. Collapse whitespace     (size reduction)
 *     4. Deduplicate lines       (size reduction — most impactful for logs)
 *     5. Minify inline JSON      (size reduction)
 *     6. Strip timestamps        (noise removal)
 *
 * 2. Tool-specific patterns — applied after base pipeline, keyed by tool name
 *    and content fingerprint. Replicates RTK-style filters at the proxy level
 *    so the user never needs to prefix commands with `rtk`.
 *
 *    Bash patterns:
 *      git diff/show/log, cargo build/test/clippy, vitest/jest, tsc,
 *      eslint/biome, pnpm/npm install, prettier, next build,
 *      docker ps/images/logs, kubectl get/logs, gh pr/run/issue, curl/wget
 *
 *    Tool patterns:
 *      Grep — group matches by file, cap per-file lines
 *      Read — truncate huge files (logs, lockfiles), keep head + tail
 *      Glob — compact large file listings into directory summary
 */
export declare const detPatternHits: Record<string, number>;
export declare function hitPattern(pattern: string, count?: number): void;
export declare function preprocess(text: string): string;
export declare function preprocessRatio(original: string, processed: string): number;
/**
 * Run all deterministic stages for a given tool result.
 * Applies base pipeline first, then tool-specific patterns.
 * Called on ALL tool results including recent ones — covers turn-1 compression
 * without the user needing to prefix commands with `rtk`.
 */
export declare function preprocessForTool(text: string, toolName: string, pressure?: number): string;
