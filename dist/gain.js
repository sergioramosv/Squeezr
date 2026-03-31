#!/usr/bin/env node
import { Stats } from './stats.js';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
const args = process.argv.slice(2);
if (args.includes('--reset')) {
    const statsFile = join(homedir(), '.squeezr', 'stats.json');
    const cacheFile = join(homedir(), '.squeezr', 'cache.json');
    const syspromptFile = join(homedir(), '.squeezr', 'sysprompt_cache.json');
    for (const f of [statsFile, cacheFile, syspromptFile]) {
        if (existsSync(f)) {
            unlinkSync(f);
            console.log(`Deleted ${f}`);
        }
    }
    console.log('Stats reset.');
    process.exit(0);
}
const data = Stats.loadGlobal();
if (!data || !data.requests) {
    console.log('No stats yet. Start Squeezr and make some requests.');
    process.exit(0);
}
const requests = data.requests;
const savedChars = data.total_saved_chars;
const originalChars = data.total_original_chars;
const CHARS_PER_TOKEN = 3.5;
const savedTokens = Math.round(savedChars / CHARS_PER_TOKEN);
const pct = originalChars > 0 ? Math.round((savedChars / originalChars) * 1000) / 10 : 0;
const byTool = (data.by_tool ?? {});
console.log('┌─────────────────────────────────────────┐');
console.log('│          Squeezr — Token Savings         │');
console.log('├─────────────────────────────────────────┤');
console.log(`│  Requests      ${String(requests).padEnd(26)}│`);
console.log(`│  Saved chars   ${String(savedChars.toLocaleString()).padEnd(26)}│`);
console.log(`│  Saved tokens  ${String(savedTokens.toLocaleString()).padEnd(26)}│`);
console.log(`│  Savings       ${String(`${pct}%`).padEnd(26)}│`);
if (Object.keys(byTool).length > 0) {
    console.log('├─────────────────────────────────────────┤');
    console.log('│  By Tool                                 │');
    for (const [tool, d] of Object.entries(byTool)) {
        const toolPct = d.originalChars > 0 ? Math.round((d.savedChars / d.originalChars) * 1000) / 10 : 0;
        const line = `  ${tool} (${d.count}x): -${toolPct}%`;
        console.log(`│${line.padEnd(41)}│`);
    }
}
console.log('└─────────────────────────────────────────┘');
