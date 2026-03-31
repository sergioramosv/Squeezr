/**
 * Deterministic pre-compression pipeline.
 *
 * These stages run BEFORE the AI compressor as a preprocessor —
 * not as a replacement. Cleaner input → better semantic compression
 * at lower token cost from the AI stage.
 *
 * Pipeline order matters:
 *  1. Strip ANSI codes        (noise removal)
 *  2. Strip progress bars     (noise removal)
 *  3. Collapse whitespace     (size reduction)
 *  4. Deduplicate lines       (size reduction — most impactful for logs)
 *  5. Minify inline JSON      (size reduction)
 *  6. Strip timestamps        (noise removal)
 */
/** Run all deterministic stages on a piece of text. */
export declare function preprocess(text: string): string;
/** Returns how much the deterministic pipeline reduced the text (ratio 0-1). */
export declare function preprocessRatio(original: string, processed: string): number;
