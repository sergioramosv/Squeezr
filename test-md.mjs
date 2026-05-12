import { preprocess } from './dist/deterministic.js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// Test with synthetic Markdown (same structure as SKILL.md files)
const syntheticMd = `# Frontend Cursor Skills

## Overview

This document describes frontend skills.

## Skills

- React
- TypeScript

- Next.js

- Tailwind

## Code Examples

\`\`\`typescript

const x = 1;
const y = 2;

\`\`\`

## More Info

1. First item

2. Second item

3. Third item

`;

const compressed = preprocess(syntheticMd);
const savings = syntheticMd.length - compressed.length;
const pct = ((savings / syntheticMd.length) * 100).toFixed(1);

console.log(`Synthetic MD: ${syntheticMd.length}b → ${compressed.length}b (saved ${savings}b = ${pct}%)`);
if (savings > 0) {
  console.log('\n--- Compressed output ---');
  console.log(compressed);
}

// Test with real SKILL.md files from cache if they exist
const cacheFile = `${process.env.USERPROFILE || process.env.HOME}/.squeezr/cursor_file_cache.json`;
if (existsSync(cacheFile)) {
  const cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  const entries = Object.entries(cache);
  console.log(`\nCache has ${entries.length} entries`);
  let totalOrig = 0, totalComp = 0;
  for (const [hash, entry] of entries.slice(0, 5)) {
    if (entry.original) {
      const orig = entry.original;
      const recompressed = preprocess(orig);
      const s = orig.length - recompressed.length;
      const p = ((s / orig.length) * 100).toFixed(1);
      totalOrig += orig.length;
      totalComp += recompressed.length;
      console.log(`  ${hash.slice(0,8)}: ${orig.length}b → ${recompressed.length}b (${p}%)`);
    }
  }
} else {
  console.log(`\nNo cache file at ${cacheFile}`);
}
