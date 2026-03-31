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
// 1. Strip ANSI escape codes
function stripAnsi(text) {
    return text.replace(/\x1B\[[0-9;]*[mGKHF]/g, '')
        .replace(/\x1B\][^\x07]*\x07/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
// 2. Strip progress bars (lines that are mostly ===, ---, ###, or ░█)
function stripProgressBars(text) {
    return text
        .split('\n')
        .filter(line => {
        const stripped = line.replace(/[\s=\-#░█▓▒▌▐►◄|]/g, '');
        return stripped.length > line.length * 0.3 || stripped.length > 5;
    })
        .join('\n');
}
// 3. Collapse excessive whitespace (3+ blank lines → 1, trailing spaces)
function collapseWhitespace(text) {
    return text
        .replace(/[ \t]+$/gm, '') // trailing whitespace per line
        .replace(/\n{3,}/g, '\n\n') // max 2 consecutive blank lines
        .trim();
}
// 4. Deduplicate repeated lines (3+ occurrences → keep 1 + note)
function deduplicateLines(text) {
    const lines = text.split('\n');
    const counts = new Map();
    for (const line of lines) {
        const key = line.trim();
        if (key)
            counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const seen = new Map();
    const out = [];
    for (const line of lines) {
        const key = line.trim();
        const total = counts.get(key) ?? 1;
        if (total < 3) {
            out.push(line);
            continue;
        }
        const emitted = seen.get(key) ?? 0;
        if (emitted === 0) {
            out.push(line);
            out.push(`  ... [repeated ${total - 1} more times]`);
        }
        seen.set(key, emitted + 1);
    }
    return out.join('\n');
}
// 5. Minify single-line JSON blobs (prettified JSON → compact)
function minifyJson(text) {
    // Only target obvious multi-line JSON blocks
    return text.replace(/(\{[\s\S]{200,}?\})/g, (match) => {
        try {
            return JSON.stringify(JSON.parse(match));
        }
        catch {
            return match;
        }
    });
}
// 6. Strip common log timestamps (ISO, brackets, etc.)
function stripTimestamps(text) {
    return text
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?/g, '')
        .replace(/\[\d{2}:\d{2}:\d{2}(\.\d+)?\]/g, '')
        .replace(/\d{2}:\d{2}:\d{2}(\.\d+)?\s/g, '');
}
/** Run all deterministic stages on a piece of text. */
export function preprocess(text) {
    let t = text;
    t = stripAnsi(t);
    t = stripProgressBars(t);
    t = stripTimestamps(t);
    t = deduplicateLines(t);
    t = minifyJson(t);
    t = collapseWhitespace(t);
    return t;
}
/** Returns how much the deterministic pipeline reduced the text (ratio 0-1). */
export function preprocessRatio(original, processed) {
    if (!original.length)
        return 0;
    return 1 - processed.length / original.length;
}
