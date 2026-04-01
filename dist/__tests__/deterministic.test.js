import { describe, it, expect } from 'vitest';
import { preprocess, preprocessForTool, preprocessRatio } from '../deterministic.js';
// ── Base pipeline ─────────────────────────────────────────────────────────────
describe('preprocess - base pipeline', () => {
    it('strips ANSI escape codes', () => {
        expect(preprocess('\x1B[32mhello\x1B[0m world')).toBe('hello world');
    });
    it('strips ANSI OSC sequences', () => {
        expect(preprocess('\x1B]0;title\x07text')).toBe('text');
    });
    it('strips progress bars (mostly ===)', () => {
        const input = 'result\n=================\nresult2';
        const out = preprocess(input);
        expect(out).not.toContain('=====');
        expect(out).toContain('result');
    });
    it('collapses blank lines (progress bar filter removes empty lines)', () => {
        // stripProgressBars removes blank lines, so consecutive blanks collapse to nothing
        const input = 'a\n\n\n\n\nb';
        expect(preprocess(input)).toBe('a\nb');
    });
    it('removes trailing whitespace per line', () => {
        expect(preprocess('hello   \nworld  ')).toBe('hello\nworld');
    });
    it('deduplicates lines appearing 3+ times', () => {
        const input = Array(5).fill('same line').join('\n');
        const out = preprocess(input);
        const lines = out.split('\n');
        expect(lines.filter(l => l === 'same line')).toHaveLength(1);
        expect(out).toContain('repeated 4 more times');
    });
    it('does not deduplicate lines appearing < 3 times', () => {
        const input = 'a\nb\na';
        expect(preprocess(input)).toBe('a\nb\na');
    });
    it('minifies inline JSON blobs > 200 chars', () => {
        const obj = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`key_${i}`, `value_number_${i}`]));
        const pretty = JSON.stringify(obj, null, 2);
        expect(pretty.length).toBeGreaterThan(200);
        const out = preprocess(pretty);
        expect(out).not.toContain('\n  ');
        expect(JSON.parse(out)).toEqual(obj);
    });
    it('strips ISO timestamps', () => {
        const out = preprocess('log: 2024-01-15T10:30:00Z event happened');
        expect(out).not.toContain('2024-01-15T');
        expect(out).toContain('event happened');
    });
    it('strips bracketed timestamps', () => {
        const out = preprocess('[10:30:00] something happened');
        expect(out).not.toContain('[10:30:00]');
        expect(out).toContain('something happened');
    });
    it('returns empty string for empty input', () => {
        expect(preprocess('')).toBe('');
    });
    it('is idempotent', () => {
        const input = 'hello\x1B[32m world\x1B[0m\n\n\n\n';
        expect(preprocess(preprocess(input))).toBe(preprocess(input));
    });
});
describe('preprocessRatio', () => {
    it('returns 0 for empty original', () => {
        expect(preprocessRatio('', '')).toBe(0);
    });
    it('returns ratio between 0 and 1', () => {
        const r = preprocessRatio('hello world', 'hi');
        expect(r).toBeGreaterThan(0);
        expect(r).toBeLessThanOrEqual(1);
    });
    it('returns 0 when no reduction', () => {
        expect(preprocessRatio('abc', 'abc')).toBe(0);
    });
});
// ── Git diff ──────────────────────────────────────────────────────────────────
describe('preprocessForTool - git diff', () => {
    const sampleDiff = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,7 +1,7 @@
 import { foo } from './bar'

-const x = 1
+const x = 2

 function hello() {
   return x
 }
@@ -10,5 +10,5 @@
 context before
-old line
+new line
 context after
 more context
 even more context`;
    it('keeps diff headers', () => {
        const out = preprocessForTool(sampleDiff, 'Bash');
        expect(out).toContain('diff --git');
        expect(out).toContain('--- a/src/foo.ts');
        expect(out).toContain('+++ b/src/foo.ts');
        expect(out).toContain('@@ -1,7');
    });
    it('keeps changed lines (+ and -)', () => {
        const out = preprocessForTool(sampleDiff, 'Bash');
        expect(out).toContain('-const x = 1');
        expect(out).toContain('+const x = 2');
        expect(out).toContain('-old line');
        expect(out).toContain('+new line');
    });
    it('reduces context lines to max 1 per hunk', () => {
        const out = preprocessForTool(sampleDiff, 'Bash');
        // "more context" and "even more context" should be stripped
        expect(out).not.toContain('even more context');
        expect(out).not.toContain('more context');
    });
    it('produces shorter output than input', () => {
        const out = preprocessForTool(sampleDiff, 'Bash');
        expect(out.length).toBeLessThan(sampleDiff.length);
    });
});
// ── Cargo test ────────────────────────────────────────────────────────────────
describe('preprocessForTool - cargo test', () => {
    const allPassing = `running 5 tests
test foo::test_a ... ok
test foo::test_b ... ok
test foo::test_c ... ok
test foo::test_d ... ok
test foo::test_e ... ok

test result: ok. 5 passed; 0 failed; 0 ignored`;
    const withFailures = `running 3 tests
test foo::test_a ... ok
test foo::test_b ... FAILED
test foo::test_c ... ok

failures:

---- foo::test_b stdout ----
thread 'foo::test_b' panicked at 'assertion failed', src/lib.rs:10

test result: FAILED. 2 passed; 1 failed`;
    it('returns only summary when all tests pass', () => {
        const out = preprocessForTool(allPassing, 'Bash');
        expect(out).toContain('test result: ok');
        expect(out).not.toContain('test foo::test_a ... ok');
    });
    it('keeps failure blocks', () => {
        const out = preprocessForTool(withFailures, 'Bash');
        expect(out).toContain('FAILED');
        expect(out).toContain('panicked at');
    });
    it('strips passing test lines', () => {
        const out = preprocessForTool(withFailures, 'Bash');
        expect(out).not.toContain('test foo::test_a ... ok');
    });
    it('keeps test result summary', () => {
        const out = preprocessForTool(withFailures, 'Bash');
        expect(out).toContain('test result: FAILED');
    });
});
// ── Cargo build / clippy ──────────────────────────────────────────────────────
describe('preprocessForTool - cargo build errors', () => {
    const buildOutput = `   Compiling foo v0.1.0
   Compiling bar v1.2.3
error[E0308]: mismatched types
  --> src/main.rs:5:10
   |
 5 |     let x: i32 = "hello";
   |            ---   ^^^^^^^ expected i32, found &str
   |
error: aborting due to 1 previous error`;
    it('removes Compiling lines', () => {
        const out = preprocessForTool(buildOutput, 'Bash');
        expect(out).not.toContain('Compiling foo');
        expect(out).not.toContain('Compiling bar');
    });
    it('keeps error diagnostics', () => {
        const out = preprocessForTool(buildOutput, 'Bash');
        expect(out).toContain('error[E0308]');
        expect(out).toContain('mismatched types');
        expect(out).toContain('src/main.rs:5');
    });
    it('keeps aborting summary', () => {
        const out = preprocessForTool(buildOutput, 'Bash');
        expect(out).toContain('aborting due to 1 previous error');
    });
});
// ── Vitest ────────────────────────────────────────────────────────────────────
describe('preprocessForTool - vitest', () => {
    const allPass = `✓ src/foo.test.ts (3)
  ✓ test one 5ms
  ✓ test two 3ms
  ✓ test three 2ms

Test Files  1 passed (1)
Tests       3 passed (3)
Duration    120ms`;
    const withFail = `✓ src/foo.test.ts (2)
× src/bar.test.ts (1)
  × failing test 10ms
    AssertionError: expected 1 to equal 2
      - Expected: 2
      + Received: 1

Test Files  1 failed | 1 passed (2)
Tests       1 failed | 2 passed (3)
Duration    150ms`;
    it('returns only summary when all tests pass', () => {
        const out = preprocessForTool(allPass, 'Bash');
        expect(out).toContain('Test Files');
        expect(out).toContain('Tests');
        expect(out).not.toContain('test one');
    });
    it('keeps failure details', () => {
        const out = preprocessForTool(withFail, 'Bash');
        expect(out).toContain('failing test');
        expect(out).toContain('AssertionError');
        expect(out).toContain('Expected: 2');
    });
    it('keeps summary lines', () => {
        const out = preprocessForTool(withFail, 'Bash');
        expect(out).toContain('Test Files');
        expect(out).toContain('Duration');
    });
    it('strips passing test lines', () => {
        const out = preprocessForTool(withFail, 'Bash');
        expect(out).not.toContain('test one');
    });
});
// ── TypeScript ────────────────────────────────────────────────────────────────
describe('preprocessForTool - tsc errors', () => {
    const tscOutput = `src/foo.ts(10,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
src/foo.ts(20,3): error TS2551: Property 'bar' does not exist on type 'Foo'.
src/bar.ts(5,10): error TS2304: Cannot find name 'baz'.`;
    it('groups errors by file', () => {
        const out = preprocessForTool(tscOutput, 'Bash');
        expect(out).toContain('src/foo.ts: 2 error(s)');
        expect(out).toContain('src/bar.ts: 1 error(s)');
    });
    it('strips file:line prefix from error messages', () => {
        const out = preprocessForTool(tscOutput, 'Bash');
        expect(out).toContain('error TS2345');
    });
    it('returns input unchanged if no TS errors', () => {
        const out = preprocessForTool('some normal output', 'Bash');
        expect(out).toBe('some normal output');
    });
});
// ── ESLint ────────────────────────────────────────────────────────────────────
describe('preprocessForTool - eslint', () => {
    const eslintOutput = `/src/foo.ts
  10:5  error  'x' is defined but never used  no-unused-vars
  20:1  warning  Unexpected console statement  no-console

/src/bar.ts
  5:10  error  Missing semicolon  semi

✖ 3 problems (2 errors, 1 warning)`;
    it('keeps error/warning lines', () => {
        const out = preprocessForTool(eslintOutput, 'Bash');
        expect(out).toContain("'x' is defined but never used");
        expect(out).toContain('Missing semicolon');
    });
    it('keeps summary line', () => {
        const out = preprocessForTool(eslintOutput, 'Bash');
        expect(out).toContain('3 problems');
    });
    it('strips rule explanation URLs', () => {
        const withUrl = `/src/foo.ts\n  1:1  error  some error  rule-name https://eslint.org/docs/rules/rule-name`;
        const out = preprocessForTool(withUrl, 'Bash');
        expect(out).not.toContain('https://');
    });
});
// ── pnpm / npm install ────────────────────────────────────────────────────────
describe('preprocessForTool - pnpm install', () => {
    const pnpmOutput = Array.from({ length: 50 }, (_, i) => ` ${i} packages installed`).join('\n') +
        '\nadded 127 packages in 3.2s\n9 packages are looking for funding';
    it('keeps summary line', () => {
        const out = preprocessForTool(pnpmOutput, 'Bash');
        expect(out).toContain('added 127 packages');
    });
    it('strips individual package install lines', () => {
        const out = preprocessForTool(pnpmOutput, 'Bash');
        // Should be much shorter than input
        expect(out.split('\n').length).toBeLessThan(10);
    });
});
// ── Docker ────────────────────────────────────────────────────────────────────
describe('preprocessForTool - docker ps', () => {
    const dockerPs = `CONTAINER ID   IMAGE         COMMAND       CREATED       STATUS        PORTS     NAMES
abc123def456   nginx:latest  "/docker-e…"  2 hours ago   Up 2 hours    80/tcp    web`;
    it('keeps header and container rows', () => {
        const out = preprocessForTool(dockerPs, 'Bash');
        expect(out).toContain('CONTAINER ID');
        expect(out).toContain('nginx:latest');
    });
});
describe('preprocessForTool - long bash output (generic truncation)', () => {
    it('truncates output > 80 lines, keeps last lines', () => {
        const logs = Array.from({ length: 100 }, (_, i) => `log line ${i}`).join('\n');
        const out = preprocessForTool(logs, 'Bash');
        expect(out).toContain('omitted');
        expect(out).toContain('log line 99');
    });
    it('does not truncate output <= 80 lines', () => {
        const logs = Array.from({ length: 50 }, (_, i) => `log line ${i}`).join('\n');
        const out = preprocessForTool(logs, 'Bash');
        expect(out).toContain('log line 0');
        expect(out).not.toContain('omitted');
    });
});
// ── gh CLI ────────────────────────────────────────────────────────────────────
describe('preprocessForTool - gh pr', () => {
    const ghPr = `title:  Fix the bug
state:  OPEN
author: sergioramosv
url:    https://github.com/sergioramosv/squeezr/pull/5
number: 5
labels: bug, help wanted

This is a long PR body with lots of text explaining the changes
in great detail that we don't really need in a summary.
More text here. Even more text. Lots and lots of text.`;
    it('keeps key metadata fields', () => {
        const out = preprocessForTool(ghPr, 'Bash');
        expect(out).toContain('title:');
        expect(out).toContain('state:');
        expect(out).toContain('github.com');
    });
});
// ── Grep tool ─────────────────────────────────────────────────────────────────
describe('preprocessForTool - Grep tool', () => {
    it('groups matches by file', () => {
        const grepOut = Array.from({ length: 30 }, (_, i) => `src/file${i % 3}.ts:${i + 1}: some match content here`).join('\n');
        const out = preprocessForTool(grepOut, 'Grep');
        expect(out).toContain('src/file0.ts');
        expect(out).toContain('matches');
    });
    it('caps matches per file at 8', () => {
        const grepOut = Array.from({ length: 20 }, (_, i) => `src/foo.ts:${i + 1}: match ${i}`).join('\n');
        const out = preprocessForTool(grepOut, 'Grep');
        expect(out).toContain('(+more)');
    });
    it('passes through small grep output unchanged', () => {
        const small = 'src/foo.ts:1: match\nsrc/bar.ts:2: match';
        const out = preprocessForTool(small, 'Grep');
        // Short outputs are not restructured
        expect(out).toContain('match');
    });
    it('caps total files at 30', () => {
        const grepOut = Array.from({ length: 40 }, (_, i) => `src/file${i}.ts:1: match`).join('\n');
        const out = preprocessForTool(grepOut, 'Grep');
        expect(out).toContain('more files');
    });
});
// ── Read tool ─────────────────────────────────────────────────────────────────
describe('preprocessForTool - Read tool', () => {
    it('passes through small files unchanged', () => {
        const small = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
        const out = preprocessForTool(small, 'Read');
        expect(out).toContain('line 0');
        expect(out).toContain('line 49');
        expect(out).not.toContain('omitted');
    });
    it('truncates large files with head + tail', () => {
        const large = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
        const out = preprocessForTool(large, 'Read');
        expect(out).toContain('line 0'); // head
        expect(out).toContain('line 499'); // tail
        expect(out).toContain('omitted'); // omission note
        expect(out).not.toContain('line 150'); // middle omitted
    });
    it('replaces lockfiles with a summary', () => {
        // Use yarn.lock format which matches `integrity sha512-` pattern
        const lockfile = Array.from({ length: 300 }, (_, i) => `pkg-${i}@^1.0.0:\n  version "1.0.${i}"\n  resolved "https://registry.yarnpkg.com/pkg-${i}"\n  integrity sha512-abc${i}xyz`).join('\n');
        const out = preprocessForTool(lockfile, 'Read');
        expect(out).toContain('lockfile');
        expect(out).toContain('omitted');
        expect(out.length).toBeLessThan(lockfile.length / 10);
    });
});
// ── Glob tool ─────────────────────────────────────────────────────────────────
describe('preprocessForTool - Glob tool', () => {
    it('compacts large file listings into directory summary', () => {
        const listing = Array.from({ length: 50 }, (_, i) => `src/components/comp${i}.tsx`).join('\n');
        const out = preprocessForTool(listing, 'Glob');
        expect(out).toContain('files total');
        expect(out).toContain('src/components/');
    });
    it('passes through small listings unchanged', () => {
        const small = 'src/index.ts\nsrc/config.ts';
        const out = preprocessForTool(small, 'Glob');
        expect(out).toContain('src/index.ts');
        expect(out).not.toContain('files total');
    });
});
// ── git status ────────────────────────────────────────────────────────────────
describe('preprocessForTool - git status', () => {
    const status = `On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
	modified:   src/foo.ts
	modified:   src/bar.ts

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	new-file.ts

no changes added to commit`;
    it('shows branch name', () => {
        const out = preprocessForTool(status, 'Bash');
        expect(out).toContain('* main');
    });
    it('shows modified file count and names', () => {
        const out = preprocessForTool(status, 'Bash');
        expect(out).toContain('~ Modified: 2 files');
        expect(out).toContain('src/foo.ts');
        expect(out).toContain('src/bar.ts');
    });
    it('shows untracked file count and names', () => {
        const out = preprocessForTool(status, 'Bash');
        expect(out).toContain('? Untracked: 1 file');
        expect(out).toContain('new-file.ts');
    });
    it('strips "(use git add...)" hint lines', () => {
        const out = preprocessForTool(status, 'Bash');
        expect(out).not.toContain('use "git add');
    });
    it('shows "nothing to commit" for clean working tree', () => {
        const clean = `On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean`;
        const out = preprocessForTool(clean, 'Bash');
        expect(out).toContain('nothing to commit');
    });
    it('is shorter than original', () => {
        const out = preprocessForTool(status, 'Bash');
        expect(out.length).toBeLessThan(status.length);
    });
});
// ── git log --oneline ─────────────────────────────────────────────────────────
describe('preprocessForTool - git log --oneline', () => {
    const oneline = Array.from({ length: 40 }, (_, i) => `a1b2c3${i.toString().padStart(1, '0')} feat: commit number ${i}`).join('\n');
    it('caps --oneline output at 30 commits', () => {
        const out = preprocessForTool(oneline, 'Bash');
        expect(out).toContain('more commits');
    });
    it('keeps first 30 commits', () => {
        const out = preprocessForTool(oneline, 'Bash');
        expect(out).toContain('commit number 0');
    });
    it('does not modify short oneline log', () => {
        const short = `a1b2c3d feat: first\nb4c5d6e fix: second\nc7d8e9f chore: third`;
        const out = preprocessForTool(short, 'Bash');
        expect(out).toContain('feat: first');
        expect(out).not.toContain('more commits');
    });
});
// ── pnpm list ─────────────────────────────────────────────────────────────────
describe('preprocessForTool - pnpm/npm list', () => {
    const npmList = `my-app@1.0.0
├── express@4.18.2
│   ├── accepts@1.3.8
│   │   └── mime-types@2.1.35
│   └── body-parser@1.20.2
├── react@18.2.0
│   └── scheduler@0.23.0
└── typescript@5.8.3
    └── typescript@5.8.3 deduped`;
    it('keeps direct dependencies', () => {
        const out = preprocessForTool(npmList, 'Bash');
        expect(out).toContain('express@4.18.2');
        expect(out).toContain('react@18.2.0');
        expect(out).toContain('typescript@5.8.3');
    });
    it('removes nested dependencies', () => {
        const out = preprocessForTool(npmList, 'Bash');
        expect(out).toContain('nested packages omitted');
        expect(out).not.toContain('accepts@1.3.8');
        expect(out).not.toContain('scheduler@0.23.0');
    });
    it('keeps root package name', () => {
        const out = preprocessForTool(npmList, 'Bash');
        expect(out).toContain('my-app@1.0.0');
    });
    it('does not compact short lists', () => {
        const short = `app@1.0.0\n└── lodash@4.17.21`;
        const out = preprocessForTool(short, 'Bash');
        expect(out).toContain('lodash');
        expect(out).not.toContain('omitted');
    });
});
// ── pnpm outdated ─────────────────────────────────────────────────────────────
describe('preprocessForTool - pnpm outdated', () => {
    it('keeps output when short', () => {
        const outdated = `Package    Current  Wanted  Latest\nreact      18.0.0   18.2.0  18.2.0\ntypescript 4.9.0    5.0.0   5.8.3`;
        const out = preprocessForTool(outdated, 'Bash');
        expect(out).toContain('react');
        expect(out).toContain('typescript');
    });
    it('caps long outdated list at 30 packages', () => {
        const header = 'Package     Current  Wanted  Latest';
        const rows = Array.from({ length: 50 }, (_, i) => `pkg-${i}  1.0.0  1.0.1  2.0.0`);
        const out = preprocessForTool([header, ...rows].join('\n'), 'Bash');
        expect(out).toContain('more outdated packages');
    });
});
// ── prisma ────────────────────────────────────────────────────────────────────
describe('preprocessForTool - prisma', () => {
    const prismaOutput = `Prisma schema loaded from prisma/schema.prisma
Environment variables loaded from .env

✔ Generated Prisma Client (v5.10.2) to ./node_modules/@prisma/client in 127ms

┌─────────────────────────────────────────────────────────┐
│  Starter Prisma Tip:                                    │
│  Understand your Prisma schema better with the          │
│  Prisma VS Code Extension, for free!                    │
└─────────────────────────────────────────────────────────┘`;
    it('keeps important output lines', () => {
        const out = preprocessForTool(prismaOutput, 'Bash');
        expect(out).toContain('Prisma schema loaded');
        expect(out).toContain('Generated Prisma Client');
    });
    it('strips ASCII box decoration', () => {
        const out = preprocessForTool(prismaOutput, 'Bash');
        expect(out).not.toContain('┌─');
        expect(out).not.toContain('└─');
    });
    it('strips box content', () => {
        const out = preprocessForTool(prismaOutput, 'Bash');
        expect(out).not.toContain('Starter Prisma Tip');
    });
});
// ── gh pr checks ──────────────────────────────────────────────────────────────
describe('preprocessForTool - gh pr checks', () => {
    it('keeps short check tables unchanged', () => {
        const checks = `NAME      STATUS     CONCLUSION\nbuild     completed  success\ntest      completed  failure`;
        const out = preprocessForTool(checks, 'Bash');
        expect(out).toContain('build');
        expect(out).toContain('success');
        expect(out).toContain('failure');
    });
    it('caps large check tables at 25 rows', () => {
        const header = 'NAME  STATUS  CONCLUSION';
        const rows = Array.from({ length: 40 }, (_, i) => `check-${i}  completed  success`);
        const out = preprocessForTool([header, ...rows].join('\n'), 'Bash');
        expect(out).toContain('more checks');
    });
});
// ── Playwright ────────────────────────────────────────────────────────────────
describe('preprocessForTool - playwright', () => {
    const withFail = `Running 5 tests using 2 workers

  ✘ tests/login.spec.ts:12:5 › Login › should log in [chromium] (5.2s)

  Error: Timed out 5000ms waiting for expect(locator).toBeVisible()
  Locator: getByRole('button', { name: 'Submit' })
  Expected: visible
  Received: hidden
    at tests/login.spec.ts:15:22

  ✓ tests/home.spec.ts:5:5 › Home › loads [chromium] (1.1s)

  1 failed, 4 passed (12s)`;
    it('keeps failure blocks', () => {
        const out = preprocessForTool(withFail, 'Bash');
        expect(out).toContain('Timed out');
        expect(out).toContain('toBeVisible');
    });
    it('strips passing test lines', () => {
        const out = preprocessForTool(withFail, 'Bash');
        expect(out).not.toContain('loads [chromium]');
    });
    it('keeps summary line', () => {
        const out = preprocessForTool(withFail, 'Bash');
        expect(out).toContain('1 failed, 4 passed');
    });
});
// ── Python / pytest ───────────────────────────────────────────────────────────
describe('preprocessForTool - python traceback', () => {
    const traceback = `Traceback (most recent call last):
  File "app.py", line 42, in process
    result = calculate(x)
  File "app.py", line 17, in calculate
    return x / 0
ZeroDivisionError: division by zero`;
    it('keeps traceback lines', () => {
        const out = preprocessForTool(traceback, 'Bash');
        expect(out).toContain('Traceback (most recent call last)');
        expect(out).toContain('ZeroDivisionError');
    });
    it('detects pytest failure format', () => {
        const pytest = `FAILED tests/test_calc.py::test_divide - ZeroDivisionError: division by zero\n1 failed in 0.12s`;
        const out = preprocessForTool(pytest, 'Bash');
        expect(out).toContain('FAILED');
        expect(out).toContain('ZeroDivisionError');
    });
});
// ── Go test ───────────────────────────────────────────────────────────────────
describe('preprocessForTool - go test', () => {
    const goOutput = `--- PASS: TestAdd (0.00s)
--- FAIL: TestDivide (0.00s)
    calc_test.go:15: expected 5, got 0
--- PASS: TestMultiply (0.00s)
FAIL
FAIL\tgithub.com/user/calc\t0.003s`;
    it('keeps failure lines', () => {
        const out = preprocessForTool(goOutput, 'Bash');
        expect(out).toContain('FAIL: TestDivide');
        expect(out).toContain('expected 5, got 0');
    });
    it('strips passing test lines', () => {
        const out = preprocessForTool(goOutput, 'Bash');
        expect(out).not.toContain('PASS: TestAdd');
        expect(out).not.toContain('PASS: TestMultiply');
    });
    it('keeps package result summary', () => {
        const out = preprocessForTool(goOutput, 'Bash');
        expect(out).toContain('FAIL\tgithub.com/user/calc');
    });
});
// ── Terraform ─────────────────────────────────────────────────────────────────
describe('preprocessForTool - terraform', () => {
    const planOutput = `Terraform will perform the following actions:

  # aws_instance.web will be created
  + resource "aws_instance" "web" {
      + ami           = "ami-0c55b159cbfafe1f0"
      + instance_type = "t2.micro"
      ... (many attributes)
    }

  # aws_s3_bucket.data must be replaced
  -/+ resource "aws_s3_bucket" "data" {

Plan: 1 to add, 0 to change, 1 to destroy.`;
    it('keeps resource change summary lines', () => {
        const out = preprocessForTool(planOutput, 'Bash');
        expect(out).toContain('will be created');
        expect(out).toContain('must be replaced');
    });
    it('keeps Plan summary', () => {
        const out = preprocessForTool(planOutput, 'Bash');
        expect(out).toContain('Plan: 1 to add');
    });
    it('strips resource attribute details', () => {
        const out = preprocessForTool(planOutput, 'Bash');
        expect(out).not.toContain('ami-0c55b159cbfafe1f0');
    });
});
// ── git branch ────────────────────────────────────────────────────────────────
describe('preprocessForTool - git branch', () => {
    it('caps long branch list at 20', () => {
        const branches = ['* main', ...Array.from({ length: 30 }, (_, i) => `  feature/branch-${i}`)].join('\n');
        const out = preprocessForTool(branches, 'Bash');
        expect(out).toContain('more branches');
        expect(out).toContain('* main');
    });
    it('keeps short branch lists unchanged', () => {
        const branches = `* main\n  develop\n  feature/x`;
        const out = preprocessForTool(branches, 'Bash');
        expect(out).toContain('develop');
        expect(out).not.toContain('more branches');
    });
});
// ── Generic error extractor ───────────────────────────────────────────────────
describe('preprocessForTool - generic error extractor', () => {
    it('extracts error lines from long unrecognized output', () => {
        const noise = Array.from({ length: 50 }, (_, i) => `processing item ${i}`);
        const withErrors = [
            ...noise.slice(0, 20),
            'Error: connection refused at host:5432',
            'caused by: timeout after 30s',
            ...noise.slice(20),
        ].join('\n');
        const out = preprocessForTool(withErrors, 'Bash');
        expect(out).toContain('connection refused');
        expect(out).toContain('non-error lines omitted');
    });
    it('does not modify output when no errors present', () => {
        // All passing, no errors — should just truncate if long, not extract errors
        const clean = Array.from({ length: 30 }, (_, i) => `step ${i} ok`).join('\n');
        const out = preprocessForTool(clean, 'Bash');
        expect(out).not.toContain('non-error lines omitted');
    });
});
// ── Stack trace deduplication (base pipeline) ────────────────────────────────
describe('preprocess - stack trace deduplication', () => {
    const FRAME = `    at connect (net.js:1001:12)\n    at Socket._handle.open (net.js:573:18)\n    at defaultTriggerAsyncIdScope (async_hooks.js:197:19)`;
    it('collapses repeated Node.js stack traces', () => {
        const input = `Error: ECONNREFUSED\n${FRAME}\nError: ECONNREFUSED\n${FRAME}\nError: ECONNREFUSED\n${FRAME}`;
        const out = preprocess(input);
        // Should only have one copy of the frames
        expect((out.match(/at connect/g) ?? []).length).toBe(1);
        expect(out).toContain('same 3-frame stack trace repeated');
    });
    it('leaves unique stack traces unchanged', () => {
        const input = `Error: foo\n    at funcA (a.js:1:1)\n    at funcB (b.js:2:2)\nError: bar\n    at funcC (c.js:3:3)\n    at funcD (d.js:4:4)`;
        const out = preprocess(input);
        expect(out).toContain('funcA');
        expect(out).toContain('funcC');
        expect(out).not.toContain('repeated');
    });
});
// ── Diff function name summary ────────────────────────────────────────────────
describe('preprocessForTool - git diff function summary', () => {
    // Build a diff large enough to trigger the >100-line summary (101+ output lines)
    const hunk = (fn, n) => `@@ -${n},5 +${n},5 @@ function ${fn}() {\n-  old${n}\n+  new${n}\n context${n}`;
    const largeDiff = [
        'diff --git a/src/mod.ts b/src/mod.ts',
        'index abc..def 100644',
        '--- a/src/mod.ts',
        '+++ b/src/mod.ts',
        ...Array.from({ length: 35 }, (_, i) => hunk(`doWork${i}`, i * 10 + 1)),
    ].join('\n');
    it('prepends changed function names for large diffs', () => {
        const out = preprocessForTool(largeDiff, 'Bash');
        expect(out).toMatch(/^Changed: /);
        expect(out).toContain('doWork0');
        expect(out).toContain('doWork34');
    });
    it('does not prepend summary for small diffs', () => {
        const smallDiff = `diff --git a/x.ts b/x.ts\nindex a..b 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@ function foo() {\n-old\n+new`;
        const out = preprocessForTool(smallDiff, 'Bash');
        expect(out).not.toMatch(/^Changed:/);
    });
});
// ── Semantic Read (code structure extraction) ─────────────────────────────────
describe('preprocessForTool - semantic read', () => {
    it('extracts TypeScript structure from large files', () => {
        // Use unique lines so deduplicateLines doesn't collapse them
        const impl = Array.from({ length: 520 }, (_, i) => `  const x${i} = computeExpensiveThing(${i})`).join('\n');
        const tsFile = [
            "import { foo } from './foo'",
            "import { bar } from './bar'",
            impl,
            'export function processData(input: string): string {',
            '  return input.trim()',
            '}',
            'export class Parser {',
            '  parse() { return null }',
            '}',
        ].join('\n');
        const out = preprocessForTool(tsFile, 'Read');
        expect(out).toContain("import { foo }");
        expect(out).toContain('export function processData');
        expect(out).toContain('export class Parser');
        expect(out).not.toContain('computeExpensiveThing');
        expect(out).toContain('implementation lines omitted');
    });
    it('falls back to head+tail for non-code large files', () => {
        // Use unique lines so deduplicateLines doesn't collapse them
        const logFile = Array.from({ length: 600 }, (_, i) => `server log entry number ${i} processed`).join('\n');
        const out = preprocessForTool(logFile, 'Read');
        expect(out).toContain('lines omitted');
        expect(out).not.toContain('implementation lines omitted');
    });
});
// ── Unknown tool falls through to base pipeline ───────────────────────────────
describe('preprocessForTool - unknown tool', () => {
    it('applies base pipeline for unknown tool names', () => {
        const input = '\x1B[32mhello\x1B[0m\n\n\n\nworld';
        const out = preprocessForTool(input, 'UnknownTool');
        // stripProgressBars removes blank lines, stripAnsi removes escape codes
        expect(out).toBe('hello\nworld');
    });
});
