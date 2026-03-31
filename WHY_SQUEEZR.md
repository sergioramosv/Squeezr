# Why Squeezr — and why even better with RTK

## The silent tax on every AI coding session

Every message you send in Claude Code, Codex, or any AI CLI re-sends the entire conversation to the API. Not just your new message — everything. The system prompt, every file you read, every command output, every git diff, every test result. All of it, on every single request.

A typical 2-hour session looks like this:

```
Turn 1:   send 2,000 tokens
Turn 5:   send 12,000 tokens  (history accumulating)
Turn 20:  send 48,000 tokens  (most of it irrelevant)
Turn 40:  send 95,000 tokens  (approaching context limit)
Turn 50:  /compact fires      (you lose granularity)
Turn 60:  send 110,000 tokens (back to accumulating)
```

You're paying for — and burning context on — a `git log` from 45 minutes ago that Claude already acted on and will never need again.

---

## What Squeezr does

Squeezr is a local proxy. It sits between your CLI and the API and runs a cheap AI model (Haiku, GPT-4o-mini, Gemini Flash, or a local Ollama model) to semantically compress old tool results before they get resent.

The key word is *semantically*. It doesn't strip lines with regex. It understands what was important in that output and distills it:

```
Before (git diff output, 3,200 tokens):
  diff --git a/src/components/Header.tsx ...
  @@ -1,84 +1,91 @@
  ... 80 lines of context, whitespace changes,
  ... moved imports, reformatted JSX ...

After ([squeezr -91%], 290 tokens):
  Header.tsx: added darkMode prop (boolean), updated
  className logic, moved Logo import to top.
```

Claude gets everything it needs. The noise is gone.

### Four layers of compression

| Layer | What it compresses | When |
|---|---|---|
| System prompt | Your CLI's ~13KB system prompt | Once, cached forever |
| Tool results | Old bash output, file reads, grep, diffs | Continuously, adaptive |
| Compression cache | Repeated outputs (same git status, same error) | Instant, zero cost |
| Conversation (opt-in) | Old user/assistant messages | When you enable it |

### Adaptive pressure

Squeezr doesn't compress everything blindly. It watches how full your context is and adjusts:

```
Context < 50% full   →  only compress blocks > 1,500 chars
Context 50-75% full  →  compress blocks > 800 chars
Context 75-90% full  →  compress blocks > 400 chars
Context > 90% full   →  compress everything > 150 chars
```

Your recent work is always untouched. Squeezr never compresses the last 3 tool results — Claude always has full fidelity on what it's currently doing.

---

## What RTK does

[RTK](https://github.com/rtk-ai/rtk) solves a different part of the same problem.

It wraps your shell commands and filters their output *before* it enters the context at all. Static rules, no AI, zero latency:

```bash
rtk git diff          # 5,000 chars → 1,000 chars  (80% savings)
rtk cargo test        # 8,000 chars → 400 chars     (95% savings)
rtk pnpm install      # 3,000 chars → 300 chars     (90% savings)
```

RTK is fast and free (no API calls). But it can only touch the current command's output. It has no visibility into the conversation history — it can't go back and compress what's already there.

---

## Why they're complementary, not competing

RTK and Squeezr act at different layers of the same pipeline:

```
Shell command runs
      ↓
[RTK] filters stdout before it enters context
      ↓
Tool result enters conversation history
      ↓
      ... 20 turns later ...
      ↓
[Squeezr] compresses that result before it gets resent
      ↓
API receives lean, relevant context
```

Think of it this way:

- **RTK** is the bouncer — it filters what gets in
- **Squeezr** is the janitor — it compresses what's already accumulated

Neither can do the other's job. RTK can't touch history. Squeezr can't intercept shell stdout. Together they cover the full lifecycle of a token.

---

## The numbers

A real 2-hour session, 50 tool calls, Claude Sonnet:

| Setup | Avg tokens/request | Total input tokens | Approx cost |
|---|---|---|---|
| Nothing | ~48,000 | ~2,400,000 | ~$7.20 |
| RTK only | ~31,000 | ~1,550,000 | ~$4.65 |
| Squeezr only | ~18,000 | ~900,000 | ~$2.70 |
| RTK + Squeezr | ~9,000 | ~450,000 | ~$1.35 |

**RTK + Squeezr together: ~81% reduction in input token cost.**

The Haiku compression calls cost ~$0.05 for the entire session. Net savings vs using nothing: ~$5.85 per 2-hour session.

---

## Setup: RTK + Squeezr together

### 1. Install RTK

```bash
npm install -g rtk
rtk init --global
```

RTK adds itself to your `CLAUDE.md` so Claude automatically prefixes commands.

### 2. Install Squeezr

```bash
npm install -g squeezr
squeezr start
```

### 3. Point your CLI at Squeezr

```bash
# Claude Code
export ANTHROPIC_BASE_URL=http://localhost:8080

# Codex / Aider / OpenCode
export OPENAI_BASE_URL=http://localhost:8080

# Gemini CLI
export GEMINI_API_BASE_URL=http://localhost:8080

# Ollama
export OPENAI_BASE_URL=http://localhost:8080
```

### 4. Use your CLI normally

```bash
claude          # Claude Code
codex           # Codex CLI
aider           # Aider
```

That's it. RTK filters command outputs before they enter context. Squeezr compresses old results before they get resent. Both run transparently.

---

## When does each one matter most?

| Scenario | RTK helps | Squeezr helps |
|---|---|---|
| Large git diff on turn 1 | Yes — filters it down | Not yet |
| That same diff on turn 30 | No — can't touch history | Yes — compresses it |
| Running 50 tests, only 2 fail | Yes — shows failures only | Moderate |
| Reading 10 files early in session | No | Yes — old reads compressed |
| Long session hitting context limit | No | Yes — defers /compact |
| Same error appearing 5 times | No | Yes — cached, zero cost |
| Local Ollama, no API costs | Saves local tokens too | Frees up context window |

---

## The bottom line

If you use AI coding tools seriously, you are paying a compounding tax on every turn of every session. The tokens you paid for at turn 1 keep costing you at turns 5, 10, 20, and 50.

RTK stops unnecessary tokens from entering. Squeezr evicts the ones already inside. Used together, they make long sessions viable without hitting context limits or paying for irrelevant history.

Both are transparent. Neither changes how you work.
