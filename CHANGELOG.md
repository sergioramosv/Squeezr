# Changelog

All notable changes to Squeezr will be documented here.

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
