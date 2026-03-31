# Squeezr

Local proxy between Claude Code and Anthropic's API. Uses Claude Haiku to semantically compress old tool results before they consume your context window — saving thousands of tokens per session.

## How it works

```
Claude Code → localhost:8080 (Squeezr) → api.anthropic.com
                     │
           Old tool result > 800 chars?
                     │
           Haiku compresses to ~150 tokens
                     │
           Sonnet gets lean context
```

Recent tool results are always kept intact. Only older ones (beyond the last 3 by default) get compressed.

## Quick start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run Squeezr
python main.py

# 3. Point Claude Code to the proxy (run once, in a new terminal)
# macOS / Linux:
export ANTHROPIC_BASE_URL=http://localhost:8080

# Windows PowerShell:
$env:ANTHROPIC_BASE_URL="http://localhost:8080"

# 4. Use Claude Code normally — savings happen automatically
```

Or use the installer:
```bash
bash install.sh        # macOS / Linux
.\install.ps1          # Windows (PowerShell)
```

## Configuration

| Env var | Default | Description |
|---|---|---|
| `SQUEEZR_PORT` | `8080` | Local port |
| `SQUEEZR_THRESHOLD` | `800` | Min chars to trigger compression |
| `SQUEEZR_KEEP_RECENT` | `3` | Recent tool results to keep uncompressed |
| `SQUEEZR_DISABLED` | `` | Set to `1` to disable compression (passthrough only) |

## Stats

While Squeezr is running, every compressed request prints to console:
```
[squeezr] 2 block(s) compressed | -4,821 chars (87% saved this request)
```

Full session summary at: `http://localhost:8080/squeezr/stats`

## Why Haiku?

Haiku costs ~25x less than Sonnet. Compressing a 3,000-token tool result down to 150 tokens costs ~$0.0001 in Haiku but saves ~$0.009 in Sonnet input tokens. Net savings: ~98%.

## Compatible with

- Claude Code (CLI, desktop app, IDE extensions)
- Any tool using the Anthropic SDK that respects `ANTHROPIC_BASE_URL`
- Windows, macOS, Linux

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
