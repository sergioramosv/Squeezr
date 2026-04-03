# Changelog

All notable changes to Squeezr will be documented here.

## [1.16.23] - 2026-04-03
### Fixed
- **Removed confusing "Run this to activate" hint** — the shell wrapper handles env var refresh automatically. The hint only showed when no wrapper existed and caused confusion with clipboard quote issues. Now the wrapper is the only mechanism — if it's new, the ONE-TIME SETUP banner shows; if it's already installed, nothing extra is printed.

## [1.16.22] - 2026-04-03
### Fixed
- **Removed confusing "Run this to activate" hint** — the shell wrapper already handles env var refresh automatically. The hint caused confusion and the clipboard copy lost quotes, leading to PowerShell errors.

## [1.16.21] - 2026-04-03
### Fixed
- **Stop setting `HTTPS_PROXY` globally on Windows** — routing all HTTPS traffic through the MITM proxy broke Claude Code (502), npm (ECONNREFUSED), and other tools. `HTTPS_PROXY` is now only needed for Codex and should be set per-session. Setup cleans up the registry entry left by older versions.

## [1.16.20] - 2026-04-03
### Fixed
- **Duplicate `installShellWrapper` declaration crash** — second function was not renamed to `installPowerShellWrapper`, and the dispatcher called itself recursively instead of the PS wrapper.

## [1.16.19] - 2026-04-03
### Fixed
- **PowerShell wrapper syntax error** — `$` signs in PowerShell code were being interpreted as JS template literal interpolation, breaking the regex and variable references. Now uses string array join instead of template literal.

## [1.16.18] - 2026-04-03
### Fixed
- **PowerShell wrapper crash** — was passing `squeezr.cmd` (a batch file) to `node`, causing `SyntaxError`. Now calls `squeezr.cmd` directly via `&`.

## [1.16.17] - 2026-04-03
### Fixed
- **Node.js v24 compatibility** — strip `Expect` header from forwarded requests. Node 24's undici rejects this header with `UND_ERR_NOT_SUPPORTED`, causing 500 errors on all proxied requests.

## [1.16.16] - 2026-04-03
### Added
- **Bash/Zsh shell wrapper for WSL, Linux, and macOS** — same auto-refresh behavior as the PowerShell wrapper. After `squeezr start/setup/update`, env vars are applied to the current session automatically. Shows one-time banner to reopen terminal on first install. `squeezr uninstall` cleans it up.

## [1.16.15] - 2026-04-03
### Improved
- **One-time setup banner** — when the PowerShell wrapper is installed for the first time, shows a clear boxed message asking the user to reopen the terminal once. Only appears on first install, not on subsequent updates.

## [1.16.14] - 2026-04-03
### Improved
- **`squeezr update` also installs the PowerShell wrapper** — no need to run `squeezr setup` first. The wrapper is installed/updated automatically on both `setup` and `update`.

## [1.16.13] - 2026-04-03
### Added
- **PowerShell wrapper auto-refreshes env vars** — `squeezr setup` installs a function in `$PROFILE` that wraps squeezr and automatically applies env vars (from the Windows registry) to the current session after `start`, `setup`, or `update`. No more closing/reopening terminals or copy-pasting commands. `squeezr uninstall` removes the wrapper.

## [1.16.12] - 2026-04-03
### Improved
- **`setup`, `start`, and `update` print a one-liner to activate env vars in the current terminal** — on Windows PowerShell it's copied to the clipboard automatically. No need to close and reopen the terminal anymore.

## [1.16.11] - 2026-04-03
### Fixed
- **`squeezr stop` clears `HTTPS_PROXY` from Windows registry** — prevents `ECONNREFUSED` errors when running `npm install` or other tools after stopping the proxy. `squeezr start` and `squeezr update` restore it automatically once the proxy is alive again.

## [1.16.10] - 2026-04-03
### Fixed
- **`squeezr update` SyntaxError** — duplicate `uPort` variable declaration in the update command caused a crash on v1.16.9. Renamed to avoid conflict.

## [1.16.9] - 2026-04-03
### Fixed
- **`squeezr update` starts the new version directly** — no longer re-execs the old binary via `which squeezr` (which in WSL resolves to the Windows npm path, not the updated Linux one). Now resolves `npm root -g` to find the freshly installed package and spawns the daemon from its `dist/index.js`. Eliminates the stale "Update available" banner after updates.

## [1.16.8] - 2026-04-03
### Fixed
- **`squeezr update` no longer shows stale "Update available" banner** — writes the new version to the update cache after install, resolves the updated binary from npm global path instead of reusing the old one, and skips the banner entirely for the `update` command.

## [1.16.7] - 2026-04-03
### Improved
- **WSL terminal warning after `setup` and `update`** — prints a clear `⚠️ IMPORTANT` message reminding users to close and reopen the terminal so environment variables take effect. Prevents 502 errors from stale sessions.

## [1.16.6] - 2026-04-03
### Fixed
- **`squeezr uninstall` now runs `npm uninstall -g`** automatically — full removal in one command, no manual step needed.
- **`update` and `uninstall` clear `HTTPS_PROXY` before npm commands** — prevents ECONNREFUSED when npm tries to go through the dead proxy.
- **Update banner no longer shows stale/inverted versions** — cache is cleared after `squeezr update`.

## [1.16.5] - 2026-04-03
### Fixed
- **Env vars now written to `~/.profile`** — fixes Claude Code 502 errors caused by env vars in `.bashrc` being skipped by the `case $-` interactive-shell guard. Login shells (and WSL default terminals) load `.profile` before `.bashrc`'s guard, so `ANTHROPIC_BASE_URL` is always available.
- **`squeezr uninstall` cleans `.profile`** too.

## [1.16.4] - 2026-04-03
### Added
- **`squeezr update`** — one command to kill all old processes (brute force on both ports), install latest from npm, and start the new version. Fixes 502 errors caused by stale processes surviving updates.
- Update notification banner now suggests `squeezr update` instead of `npm install -g`.

## [1.16.3] - 2026-04-03
### Added
- **Update notifications** — Squeezr checks npm for new versions every 4 hours (non-blocking, cached in `~/.squeezr/update-check.json`). Shows a banner after any command if a newer version is available.

## [1.16.2] - 2026-04-03
### Fixed
- **`squeezr ports` now applies changes immediately** — auto-stops and restarts the proxy after changing ports, updates shell profiles (Unix) and Windows registry (WSL) automatically. No more manual export/restart needed.
- **Port config reads from `squeezr.toml`** — all commands now read the HTTP port from toml as fallback when env var isn't set. Prevents port mismatch after `squeezr ports` in a fresh terminal.

## [1.16.1] - 2026-04-03
### Fixed
- **`squeezr stop` shows both ports** — output now matches `start` and `status` format, showing both HTTP and MITM proxy ports. Uses configured ports from `squeezr.toml` / env vars.

## [1.16.0] - 2026-04-03
### Added
- **`squeezr uninstall`** — completely removes Squeezr: stops proxy, removes env vars (Windows registry / shell profiles), removes CA from certificate store, removes auto-start (NSSM/Task Scheduler/launchd/systemd), deletes `~/.squeezr` and config.
### Fixed
- **Auto-restart on version mismatch** — `squeezr start` now checks if the running process version matches the installed version. If mismatched (e.g. after `npm update`), it auto-kills the old process and starts the new one. This was the root cause of 502 errors after updates.

## [1.15.0] - 2026-04-03
### Added
- **`squeezr ports` command** — interactive prompt to change HTTP proxy and MITM proxy ports. Updates `squeezr.toml` and env vars.
- **`mitmPort` config field** — MITM proxy port is now independently configurable via `mitm_port` in `squeezr.toml` or `SQUEEZR_MITM_PORT` env var. Defaults to `port + 1`.

## [1.14.14] - 2026-04-03
### Fixed
- **`start` and `already running` messages show both proxies** — output now lists HTTP proxy (:8080) and MITM proxy (:8081) with their purpose, matching `status` output.

## [1.14.13] - 2026-04-03
### Fixed
- **`squeezr stop` kills zombies** — now kills all processes on both port 8080 (HTTP proxy) and 8081 (MITM proxy) with `kill -9`. No more stale processes surviving a version update.
- **`squeezr status` shows both proxies** — output now lists both the HTTP proxy (Claude/Aider/Gemini) and MITM proxy (Codex) with their ports.

## [1.14.12] - 2026-04-03
### Fixed
- **Node 18 compatibility** — replaced `import.meta.dirname` (Node 22+) with `fileURLToPath(import.meta.url)` in config loader. Fixes crash on WSL/Linux with Node 18.

## [1.14.11] - 2026-04-03
### Changed
- Reverted Node 18 compat — set engines to `>=22`. (Reverted in 1.14.12)

## [1.14.10] - 2026-04-03
### Fixed
- **Version desync** — `version.ts` was hardcoded and never updated by `npm version`. Now reads version from `package.json` at runtime.

## [1.14.9] - 2026-04-03
### Fixed
- Same as 1.14.10 — initial fix for version desync.

## [1.14.8] - 2026-04-03
### Fixed
- **npm/git ECONNREFUSED** — the MITM proxy was TLS-terminating ALL CONNECT requests (npm, git, curl, etc.), causing failures when Squeezr was the system `HTTPS_PROXY`. Now only `chatgpt.com` gets TLS-terminated; all other domains get a transparent TCP tunnel. Removes `NO_PROXY` from setup since it's no longer needed.

## [1.14.7] - 2026-04-03
### Fixed
- **Codex CA trust on Windows** — Codex is a Rust binary that uses the Windows Certificate Store, not `NODE_EXTRA_CA_CERTS`. Setup now imports the MITM CA via `certutil -addstore -user Root` (no admin required) with machine-level fallback.
- **Docs rewrite** — README.md and CODEX.md fully rewritten with accurate architecture, per-platform CA trust, and configuration reference.

## [1.14.6] - 2026-04-03
### Fixed
- **Claude 502** — `forwardHeaders()` was passing the `Upgrade` header to undici's `fetch`, which throws `InvalidArgumentError: invalid upgrade header`. Added `upgrade` to `SKIP_REQ_HEADERS`. Root cause confirmed from production logs.

## [1.14.5] - 2026-04-03
### Fixed
- **Codex auth.openai.com blocked** — `HTTPS_PROXY` was intercepting ALL HTTPS traffic including OpenAI auth endpoints. Added `NO_PROXY` excluding `auth.openai.com`, `api.openai.com`, `api.anthropic.com` and others so only `chatgpt.com` WebSocket traffic goes through the MITM.
- **Codex JWT routed to Ollama** — `isLocalKey()` returned `true` for JWT tokens (`eyJ...`) because they don't start with `sk-`. Added `!k.startsWith('eyj')` check so Codex OAuth tokens route to OpenAI, not local.
- **OpenAI compression loop** — `compressWithGptMini()` inherited `openai_base_url=http://localhost:8080` from the environment, causing compression calls to loop back through Squeezr. Now hardcodes `baseURL: 'https://api.openai.com/v1'`.

## [1.14.4] - 2026-04-03
### Fixed
- **Codex routing** — `/responses` was still hitting Anthropic when no auth header present because `detectUpstream` defaults to Anthropic. Now `/v1/responses` explicitly forces upstream to OpenAI regardless of headers. Verified: request reaches `api.openai.com/v1/responses` correctly.

## [1.14.3] - 2026-04-03
### Fixed
- **Claude 502** — `compressWithHaiku()` was creating `new Anthropic()` without an explicit `baseURL`, so the SDK inherited `ANTHROPIC_BASE_URL=http://localhost:8080` from the environment and sent compression requests back to Squeezr itself, causing infinite recursion. Now always uses `https://api.anthropic.com` directly.
- **Codex 404** — catch-all was forwarding `/responses` to `api.openai.com/responses` (no `/v1/`). Added `/responses` to `NEEDS_V1` so it correctly maps to `/v1/responses`.
- **Codex auth** — Codex CLI does not include its OAuth Bearer token when `openai_base_url` points to a custom proxy. Squeezr now reads it from `~/.codex/auth.json` and injects it automatically when the outbound request has no `authorization` header.

## [1.14.2] - 2026-04-03
### Fixed
- **`squeezr setup` on Windows** — set `NODE_EXTRA_CA_CERTS` pointing to the MITM CA. Node.js (Codex CLI) does not use the Windows Certificate Store, so `certutil` alone was insufficient — the Codex process would reject the MITM certificate. `NODE_EXTRA_CA_CERTS` adds the CA to Node.js's trusted roots without replacing the default bundle.

## [1.14.1] - 2026-04-03
### Fixed
- **`squeezr setup` on Windows** — now sets `HTTPS_PROXY=http://localhost:8081` via `setx` so Codex MITM interception is configured automatically.
- **MITM CA trust on Windows** — after starting the proxy, setup waits for the CA cert to be generated and runs `certutil -addstore Root` to trust it in the Windows Certificate Store. Falls back with a manual command if admin is required.

## [1.14.0] - 2026-04-03
### Fixed
- **`squeezr setup` on Windows** — auto-start now uses NSSM when available, registering Squeezr as a proper Windows service with automatic restart on crash. Falls back to Task Scheduler if NSSM is not installed or admin privileges are missing. Eliminates `ConnectionRefused` errors caused by the proxy crashing mid-session without recovery.
- **NSSM service config** — stdout/stderr logs to `~/.squeezr/service-stdout.log` / `service-stderr.log` with 24h rotation and 3s restart delay.

### Added
- `NSSM_WINDOWS_SERVICE.md` — full guide covering installation, service creation, log inspection, troubleshooting, and uninstall.
- README — NSSM documented as recommended Windows auto-start method with quick-install commands.

## [1.13.1] - 2026-04-03

### Fixed
- **`squeezr stop` on WSL2** — `lsof -ti :PORT` returns multiple PIDs (listening process + connected clients); now uses `-sTCP:LISTEN` flag to get only the listening process, with fallback to `fuser`. Stops reliably on first try.
- **`squeezr setup` on Unix** — detects existing shell profiles missing `HTTPS_PROXY`/`SSL_CERT_FILE` (MITM proxy vars from older installs) and rewrites the block to include them.
- **`squeezr setup` on WSL2** — same fix as Unix: old profiles without MITM vars now get updated automatically.

## [1.13.0] - 2026-04-02

### Added
- **Codex MITM compression** — Squeezr can now compress OpenAI Codex CLI context in real-time. A TLS-terminating MITM proxy on port 8081 intercepts Codex's WebSocket traffic to `chatgpt.com`, finds `function_call_output` tool results exceeding the threshold, and compresses them via a separate WebSocket call to `gpt-5.4-mini` using the same ChatGPT OAuth token — no API keys needed, no extra costs beyond your existing Codex subscription.
- **WebSocket frame parser/builder** — full implementation of RFC 6455 frame encoding/decoding with masking support, used for both intercepting Codex frames and making compression requests.
- **Automatic `permessage-deflate` stripping** — the MITM strips `Sec-WebSocket-Extensions` from upgrade requests so frames arrive as plain text, avoiding deflate context desync when modifying payloads.
- **`chatgpt-account-id` capture** — intercepted from HTTP requests and forwarded to compression calls for proper account scoping.

### Changed
- **MITM proxy rewritten** — replaced the broken HTTP POST compression approach (Cloudflare 403) with direct WebSocket-to-WebSocket compression. The proxy now opens a dedicated WS connection to `chatgpt.com/backend-api/codex/responses` for each compression call.
- Removed unused dependencies: `ws`, `fzstd`, `@types/ws`.
- Removed unused `oauthRefresh.ts`.

## [1.12.0] - 2026-04-02

### Added
- **Codex MITM proxy (experimental)** — HTTPS proxy on port 8081 with auto-generated CA for TLS termination. Intercepts `CONNECT` tunnels, generates per-host certificates, and supports WebSocket upgrade detection. `squeezr setup` now configures `HTTPS_PROXY` and `SSL_CERT_FILE` environment variables for Codex integration.
- **`node-forge` dependency** — for CA/certificate generation.

## [1.11.3] - 2026-04-02

### Fixed
- **Codex WebSocket proxy** — Codex v0.118 uses WebSocket (`ws://`) for the Responses API. Squeezr now upgrades HTTP connections on `/responses` and `/v1/responses` to a bidirectional WebSocket proxy that forwards to `wss://api.openai.com`. Includes automatic ChatGPT OAuth token refresh on `401` mid-stream.
- **WebSocket routing for OAuth tokens** — ChatGPT OAuth bearer tokens (JWTs starting with `eyJ`) were incorrectly detected as local Ollama keys, routing WebSocket traffic to `ws://localhost:11434` instead of `wss://api.openai.com`. Fixed by excluding JWT-format tokens from the local-key check.
- **OAuth token proxy** — added `/oauth/token` pass-through so Codex can use `CODEX_REFRESH_TOKEN_URL_OVERRIDE=http://localhost:PORT/oauth/token` when needed.
- **`/models` path rewrite** — catch-all now rewrites bare `/models` (and other OpenAI root paths) to `/v1/models` so Codex model enumeration works correctly.

## [1.11.2] - 2026-04-02

### Fixed
- **Codex / OpenAI Responses API support** — Codex CLI uses the Responses API (`POST /responses`) instead of Chat Completions. Squeezr now has dedicated routes for both `/responses` and `/v1/responses` with full streaming (SSE pipe-through), compression of `function_call_output` tool results, and correct header forwarding. Previously these requests fell through to the catch-all, which blocked indefinitely on streaming responses and caused 401 errors.
- **Catch-all streaming** — the catch-all handler now detects `text/event-stream` responses and pipes them through correctly instead of buffering the full response with `arrayBuffer()`.

## [1.11.1] - 2026-04-01

### Fixed
- **Daemon resilience** — `squeezr start` now survives Ctrl+C and terminal close. The daemon ignores `SIGINT` and `SIGHUP`; only `squeezr stop` (which sends `SIGTERM`) can stop it. Dev mode (`npm run dev`) still responds to Ctrl+C as before.

## [1.11.0] - 2026-04-01

### Added
- **WSL2 support** — `squeezr setup` now detects WSL2 automatically. Configures both the WSL shell profile (`.bashrc`/`.zshrc`) and Windows environment (`setx`). Auto-start cascades: systemd → Windows Task Scheduler → shell auto-heal.
- **Auto-heal guard** — on all Unix platforms (macOS, Linux, WSL2), `squeezr setup` adds a shell profile snippet that checks if the proxy is alive on every terminal open and starts it in the background if not. Zero manual intervention after setup, ever.

## [1.10.1] - 2026-04-01

### Added
- **`squeezr setup`** — one-command setup on any OS. Sets `ANTHROPIC_BASE_URL`, `openai_base_url`, `GEMINI_API_BASE_URL` permanently and registers Squeezr as a login service (Task Scheduler on Windows, launchd on macOS, systemd on Linux). After running `squeezr setup` once and restarting the terminal, everything works automatically.

## [1.10.0] - 2026-04-01

### Added
- **OAuth / subscription support** — Claude Code via claude.ai subscription (no API key) now works fully. Squeezr extracts the `Authorization: Bearer` token and reuses it for Haiku compression calls, so no extra credentials are needed regardless of how you authenticate.
- **`skip_tools` / `only_tools` config** — explicit control over which tools Squeezr compresses. `skip_tools = ["Read"]` blacklists specific tools; `only_tools = ["Bash"]` whitelists (takes priority over skip_tools).
- **`# squeezr:skip` inline marker** — add anywhere in a Bash command to prevent that specific result from being compressed (e.g. `git diff HEAD~3  # squeezr:skip`). Supported in Anthropic and OpenAI formats.
- **10 new tests** — `shouldSkipTool` logic in config (7 cases), skip/only/inline-skip in compressor (3 cases) (190 total)

### Changed
- `Config.shouldSkipTool(name)` method: checks `onlyTools` whitelist first, then `skipTools` blacklist
- `squeezr.toml`: added commented-out examples for `skip_tools`, `only_tools`, and inline `# squeezr:skip`
- Published as `squeezr-ai` on npm (name `squeezr` was taken by an unrelated image tool)

## [1.9.0] - 2026-04-01

### Fixed
- **Health endpoint returned `v1.0.0`** — `GET /squeezr/health` now returns the real version. Introduced `src/version.ts` as single source of truth; `index.ts` and `server.ts` both import from it. No more manual version drift across files.
- **`squeezr discover` showed `readDedup: 0`** — cross-turn Read dedup runs in `compressor.ts`, not `deterministic.ts`. Added exported `hitPattern()` to `deterministic.ts` and call it from the dedup step.

### Added
- **Cross-turn Read dedup for OpenAI/Gemini** — parity with Anthropic format. `compressOpenAIMessages` and `compressGeminiContents` now detect and collapse duplicate file reads.
- **Adaptive deterministic patterns at high context pressure** — patterns now receive the request's `pressure` value and tighten thresholds automatically:
  - `git diff` at >90%: 0 context lines per hunk (was always 1)
  - `git log` at >75%: cap 20 commits; at >90%: cap 10 (was always 30)
  - `grep` at >75%: 6 matches/file; at >90%: 4 (was always 8)
  - generic truncation at >90%: keep last 30 lines from 50-line threshold (was 80/50)
- `pressure` param threaded through `preprocessForTool` → `applyBashPatterns` (backward-compatible default = 0)

## [1.8.0] - 2026-04-01

### Added
- **Per-project `.squeezr.toml`** — Squeezr now looks for `.squeezr.toml` in the working directory and deep-merges it over the global config. Enables per-repo overrides (thresholds, compression model, etc.)
- **Cross-turn Read deduplication** — when the model reads the same file multiple times in a session, earlier occurrences are replaced with `[same file content as a later read — squeezr_expand(id) to retrieve]`. Keeps the most recent copy at full fidelity; collapses all earlier identical reads.
- **`squeezr discover`** — pattern coverage CLI that queries the running proxy and prints which deterministic patterns fired, how many outputs hit the generic fallback, and Read/Grep/Glob breakdown. Run after a session to spot coverage gaps.
- **Pattern hit tracking** — `detPatternHits` counter in `deterministic.ts` tracks every pattern match; exposed via `/squeezr/stats` as `pattern_hits`
- **README badges** — npm version, license, Node.js version, test count
- `src/discover.ts` new CLI command

### Changed
- `bin/squeezr.js`: added `discover` subcommand, bumped version string to 1.8.0

## [1.7.0] - 2026-04-01

### Added
- **Stack trace deduplication** — repeated Node.js/Python stack frames collapsed to `[same N-frame stack trace repeated]`; runs in base pipeline before per-tool patterns
- **Git diff function summary** — large diffs (>100 output lines) get a `Changed: fn1, fn2, ...` prefix extracted from `@@` headers
- **Semantic Read for large code files** — `.ts/.js/.py/.go/.rs` files >500 lines show imports + top-level signatures only, bodies omitted; smaller files keep head+tail
- 6 new tests (180 total)

### Changed
- `deduplicateStackTraces` runs before `deduplicateLines` in base pipeline (block-level dedup must precede line-level dedup)

## [1.6.0] - 2026-03-31

### Added
- **Playwright test compaction** — strips passing `✓` lines, keeps `✘`/FAILED blocks with context
- **Python/pytest compaction** — keeps `FAILED`/`ERROR` lines + tracebacks, strips passing dots
- **Go test compaction** — keeps `--- FAIL` blocks + `FAIL` summary, strips `--- PASS`
- **Terraform compaction** — keeps resource change blocks + Plan summary, strips attribute noise
- **`git branch` compaction** — caps at 20 branches with omission note
- **wget compaction** — strips progress/connection noise, keeps final URL + save path
- **Generic error extractor** — auto-extracts error lines ± context from any unrecognised output > 30 lines with > 50% noise (replaces manual `rtk err <cmd>` prefix)
- 15 new tests (174 total)

### Fixed
- `looksLikeGitBranch` false positive on Playwright output (now requires pure `[* ] identifier` branch name pattern, no colons/parens/brackets)

## [1.5.0] - 2026-03-31

### Added
- **`git status` compaction** — detects and compacts to `* branch [tracking] + Staged/Modified/Untracked` format (RTK parity)
- **`git log --oneline` detection** — caps at 30 commits with `... [N more commits]` (full verbose format was already supported)
- **`pnpm list` / `npm list` compaction** — keeps direct deps, strips nested tree with omission count
- **`pnpm outdated` compaction** — caps at 30 packages
- **Prisma CLI compaction** — strips ASCII box-drawing tip blocks, keeps meaningful output
- **`gh pr checks` compaction** — caps large check tables at 25 rows
- **Generic long-output truncation** — any unrecognised bash output > 80 lines gets last 50 lines + omission note (replaces the overly-broad docker logs detector)
- 20 new tests covering all new patterns (159 total)

### Fixed
- `looksLikePkgList` false-positive on Prisma box-drawing output (now requires `├──` not just `└──`)
- `looksLikeKubectl` false-positive on `gh pr checks` header (now requires specific kubectl column patterns)
- `compactGitStatus` on clean working tree now shows "nothing to commit" message

## [1.4.0] - 2026-03-31

### Added
- **Full unit test suite** — 139 tests across 6 test files covering all modules: `deterministic.ts`, `cache.ts`, `sessionCache.ts`, `expand.ts`, `config.ts`, `compressor.ts`

### Fixed
- `extractInstallSummary` regex `/\d+ packages? in/` → `/\d+ packages? in \d/` to prevent false matches on `packages installed`

## [1.3.0] - 2026-03-31

### Added
- **Full RTK pattern parity** — Squeezr now covers all major RTK tool patterns at the proxy level. No manual `rtk` prefix needed for any of these:
  - **git**: `diff` (context reduction to 1 line/hunk), `log` (one line per commit)
  - **cargo**: `test` (failures only), `build/check/clippy` (errors/warnings only, no "Compiling X" spam)
  - **JS/TS**: `vitest/jest` (failures only + summary), `tsc` (errors grouped by file), `eslint/biome` (grouped, no rule URLs), `prettier --check` (files needing format only), `next build` (route table + errors only)
  - **package managers**: `pnpm/npm install` (summary line only)
  - **Docker**: `ps` (compact), `images` (no dangling, short IDs), `logs` (last 50 lines)
  - **kubectl**: `get` (compact column alignment)
  - **gh CLI**: `pr view` (metadata only), `run list` (capped), `issue list` (capped)
  - **curl**: strip verbose `-v` headers, keep response body
- **Grep tool compaction** — matches grouped by file, capped at 8 per file, max 30 files
- **Read tool compaction** — files >200 lines show head + tail with omission note; lockfiles replaced with summary count

## [1.2.0] - 2026-03-31

### Added
- **RTK-style turn-1 compression** — `preprocessForTool()` applies tool-specific deterministic patterns to ALL tool results including recent ones. No need to prefix commands with `rtk`. Covers: `git diff` (context line reduction), `cargo test/build/clippy` (errors/failures only), `vitest/jest` (failures only), `tsc` (errors grouped by file), `eslint/biome` (grouped, no rule URLs), `pnpm/npm install` (summary only), `Glob` (compact file listings).
- **Deterministic compression is now always on, even for recent blocks** — previously only AI compression was skipped for recent blocks. Now all blocks get at minimum the RTK-style pass.

## [1.1.0] - 2026-03-31

### Added
- **Differential compression** — session-level cache tracks compressed blocks across requests. Blocks identical to a previous request skip the entire pipeline (preprocessing + AI call). In a 100-request session with 40 tool results: ~4,000 Haiku calls → ~200.
- **KV cache warming** — `storeOriginal` now uses a deterministic MD5-based ID instead of random bytes. Identical content always produces the same `[squeezr:id -ratio%]` string, preserving Anthropic's prefix cache across requests (90% cost reduction on unchanged history).
- `sessionCache.ts` — in-memory Map persisting for the lifetime of the proxy session
- `session_cache_hits` counter in stats summary and `/squeezr/stats` endpoint
- `session_cache_size` exposed in `/squeezr/stats`

## [1.0.0] - 2026-03-31

### Changed
- **Full TypeScript rewrite** — entire codebase migrated from Python to TypeScript/Node.js
- **Hono** replaces FastAPI as the HTTP framework — faster startup, no Python runtime needed
- No more `pip install` — pure npm package, install with `npm install -g squeezr`
- Requires Node.js 18+ (was Python 3.9+)

### Added
- **Deterministic preprocessing pipeline** (6 stages before AI compression): strip ANSI codes, strip progress bars, strip timestamps, deduplicate repeated lines, minify inline JSON, collapse whitespace
- **`expand()` feature** — model can call `squeezr_expand(id)` to retrieve original content when needed; Squeezr intercepts the tool call and makes a continuation request transparently
- **Gemini CLI support** (`POST /v1beta/models/*`) — compresses `functionResponse` blocks using Gemini Flash 8B
- **Per-format compression**: Anthropic `tool_result`, OpenAI `role:tool`, Gemini `functionResponse`
- **`GET /squeezr/expand/:id`** endpoint to retrieve stored originals via HTTP
- LRU compression cache with configurable max entries
- System prompt compression with separate cache (`~/.squeezr/sysprompt_cache.json`)
- `src/gain.ts` — TypeScript gain stats CLI replacing `gain.py`

## [0.6.0] - 2026-03-31

### Added
- **Ollama / local LLM support** — requests with dummy keys (`ollama`, `lm-studio`, etc.) are detected as local and routed to Ollama
- **Configurable compression model** — set any model you have installed via `squeezr.toml [local] compression_model` or `SQUEEZR_LOCAL_MODEL` env var
- **`[local]` config section** in `squeezr.toml` with `upstream_url`, `compression_model`, and `dummy_keys`
- `config.is_local_key()` detects local requests from auth key
- `compress_local_messages()` uses Ollama's OpenAI-compatible `/v1` endpoint for compression
- `SQUEEZR_LOCAL_UPSTREAM` and `SQUEEZR_LOCAL_MODEL` env var overrides

### Changed
- `/v1/chat/completions` now checks for local key before routing to OpenAI
- Version bumped to 0.6.0

## [0.5.0] - 2026-03-31

### Added
- **Gemini CLI support** — `/v1beta/models/{model}:generateContent` endpoint intercepts and compresses Gemini requests
- **Gemini Flash 8B compression** — cheapest Google model compresses `functionResponse` parts, reuses `x-goog-api-key` from request
- **Gemini system instruction compression** — `systemInstruction` field compressed via Flash 8B and cached
- **Gemini streaming** — `streamGenerateContent` SSE forwarded transparently
- `system_prompt.py` now supports `use_google=True` for Gemini system prompts
- `extract_google_key()` reads `x-goog-api-key` header or `?key=` query param
- `detect_upstream()` now identifies Google API from headers

### Changed
- `_stream()` helper accepts optional `params` dict for query string forwarding
- Version bumped to 0.5.0

## [0.4.0] - 2026-03-31

### Added
- **OpenAI / Codex CLI support** — `POST /v1/chat/completions` endpoint proxies and compresses Codex requests
- **GPT-4o-mini compression for Codex** — reuses the OpenAI key already in the request, no extra keys needed
- **Smart upstream detection** — catch-all route detects Anthropic vs OpenAI from headers and forwards to the right API
- **OpenAI system message compression** — first `role: "system"` message compressed via GPT-4o-mini
- `openai>=1.0.0` added to requirements

### Changed
- `system_prompt.py` now accepts `use_openai=True` to compress via GPT-4o-mini
- `main.py` refactored: shared `_stream()` helper, dedicated OpenAI endpoint
- Version bumped to 0.4.0

## [0.3.0] - 2026-03-31

### Added
- **System prompt compression** — Haiku compresses Claude Code's ~13KB system prompt on first request and caches it. Estimated -40% per request.
- **Adaptive thresholds** — compression aggressiveness scales with context pressure: low/mid/high/critical tiers based on % of context used
- **Compression cache** — repeated tool results are served from `~/.squeezr/cache.json` at zero Haiku cost. Hit rate shown in `/squeezr/stats`
- **Conversation compression** — opt-in (`compress_conversation = true` in `squeezr.toml`) to also compress old user/assistant messages
- **Auto-start on login** — `install.sh` configures launchd (macOS) or systemd (Linux); `install.ps1` registers a Windows Task Scheduler task
- **`squeezr.toml` config file** — all settings editable in TOML, env vars still override
- **Dry-run mode** — set `SQUEEZR_DRY_RUN=1` to see what would be compressed without modifying requests
- Cache stats (`size`, `hits`, `misses`, `hit_rate_pct`) exposed in `/squeezr/stats`
- Context pressure logged when above 50%

### Changed
- `config.py` reads from `squeezr.toml` first, env vars override
- `requirements.txt` adds `tomli` for Python < 3.11
- Version bumped to 0.3.0

## [0.2.0] - 2026-03-31

### Added
- `gain.py` CLI command — shows token savings with breakdown by tool (Bash, Read, Grep, etc.)
- Per-tool savings tracking in stats (count, chars saved, avg compression %)
- Efficiency bar visualization (24-char block meter)
- Stats persistence to `~/.squeezr/stats.json` across proxy restarts
- `--reset` flag for `gain.py` to clear saved stats
- Tool name extraction from `tool_use` blocks to enrich compression reporting

### Changed
- `stats.py` now tracks `by_tool` breakdown per request
- `compressor.py` now returns tool names alongside savings data
- Version bumped to 0.2.0

## [0.1.0] - 2026-03-31

### Added
- Local API proxy that intercepts Claude Code requests to Anthropic API
- Semantic compression of old tool results using Claude Haiku
- Configurable compression threshold (`SQUEEZR_THRESHOLD`, default 800 chars)
- Configurable recent context preservation (`SQUEEZR_KEEP_RECENT`, default 3 tool results)
- Real-time per-request savings logging to console
- `/squeezr/stats` endpoint for session summary
- `/squeezr/health` endpoint
- Catch-all route to forward any Anthropic endpoint without modification
- Full streaming support (SSE passthrough)
- `install.sh` for macOS/Linux
- `install.ps1` for Windows
