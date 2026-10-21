# Changelog

## [0.3.0] - 2026-10-21

- Claude Pro/Max subscription login uses the public Claude Code OAuth client: PKCE in the browser, paste the code, store the rotated refresh token in the OS keychain.
- Import `~/.claude/.credentials.json`. The same refresh lineage updates the existing account instead of creating a duplicate.
- Background polling reads `GET /api/oauth/usage` (5-hour, 7-day, per-model weekly windows, and extra usage). A window that has reached its reset time is dropped so the account can be used again before the next probe.
- Expired access tokens are refreshed with a JSON grant. The login Claude Code currently has on disk is polled and never refreshed, so the official client keeps its session.
- "Use in Claude Code" writes `~/.claude/.credentials.json` (with a backup) and, on macOS, the `Claude Code-credentials` keychain item. Restore puts the backup back.
- Claude Desktop's chat app keeps its own encrypted session. That switch is documented in the app; it is not pretended to work.
- Quota history (no prompts) is saved for the charts. Notifications fire once when an account crosses the threshold, when a reset is inside 15 minutes, and when every enabled account is full.

## [0.2.0] - 2026-10-21

- Quota windows, the active account, and the activity list are saved on disk and restored after a restart. The file still has no secrets.
- The app icon is 1024×1024 so the macOS installer build accepts it. v0.1.0's macOS job failed on a 256×256 icon.

## [0.1.0] - 2026-10-21

First public build.

- Desktop app for macOS, Windows, and Linux (Electron).
- Local proxy on `127.0.0.1` for Claude Code and the VS Code extension.
- Account list with on/off switches. Automatic move to the next available account at 98%.
- Sticky account until that threshold. A short 429 sets a one-minute cooldown instead of marking the quota full.
- Model routes. Haiku can be translated to DeepSeek on OpenCode Go, or to DeepSeek directly. Both routes start off.
- Codex login reuse from `~/.codex/auth.json` via the Responses API.
- Cursor and Antigravity are detected only. Routing them returns an explicit error.
- Quota as a percent when the provider publishes one, plus token counts and estimated cost.
- English and Turkish. The OS language is used the first time, and the switch is remembered.
- Secrets in the OS keychain (`safeStorage`). Tray, macOS menu-bar percent, optional floating widget.
- Research notes for 25 similar repositories in `docs/RESEARCH.md`.
