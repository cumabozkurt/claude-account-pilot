# Changelog

## [1.2.0] - 2026-10-21

- A review of the proxy, rotation, settings writer, token refresh, and updater. The proxy now tries the whole fallback chain (missing secret, 429, 5xx, or a dropped connection) instead of a single retry. A second proxy start cannot clear a server that already bound.
- `anthropic-beta` and account ids are rejected when they contain a newline, so a client cannot add headers to the upstream request. The proxy still binds to `127.0.0.1` only.
- Claude settings are not written through a symlink or a hard link, and not when the path resolves outside the home directory. A config file that is not JSON is moved to `config.json.broken` before defaults are saved.
- Refresh of a Codex, Claude, or Google token is single-flight, so two overlapping requests cannot rotate one refresh token twice.
- Update downloads follow redirects only across GitHub release hosts, and the macOS replace targets the `.app` that contains the running binary. The Windows swap script rejects paths that contain quotes or shell characters.
- Packaged builds are started in CI on Linux, macOS, and Windows. The smoke checks the proxy, the tray, `settings.json` restore, and a fake release document, then removes what it installed.

## [1.1.0] - 2026-10-21

- First launch reads the logins already on the computer: Claude Code's credentials file and macOS keychain item, Codex, OpenCode, Gemini, Antigravity, a live Claude Desktop session file, and API keys from the environment or `~/.claude/settings.json`. A removed login is not imported again.
- Claude Code and the VS Code extension are pointed at the proxy, with the existing backup. If that address is overwritten, it is put back. The app starts at login and stays in the tray. The proxy is started again if it stops.
- Haiku is routed through the providers that were actually found, cheapest first, with the rest as fallbacks. Other models stay on Claude. With no Claude account, every model follows that chain.
- A packaged AppImage, macOS zip, or Windows installer downloads and replaces itself. A deb package and a development checkout only show the link.
- Antigravity's Google client is read from the install's JSON when it is there. It is still not shipped in this repository.

## [1.0.0] - 2026-10-21

- Export writes a JSON snapshot of accounts, routes, the ledger, and quota history. Secret handles and refresh fingerprints are left out.
- Activity is appended to `pilot.log` in the app data directory. Lines are short and contain no prompts. The file rotates after 1 MB.
- On launch, and from Settings, the app checks GitHub for a newer release and links to it. Unsigned builds are not installed by themselves.
- The docs site and both READMEs describe the subscription login, the routed providers, and the limits that are still real.

## [0.5.0] - 2026-10-21

- The window is split into Dashboard, Accounts, Routes, Log, and Settings. The first launch shows a short wizard until an account exists or it is skipped.
- The dashboard draws quota history and tables of tokens and estimated cost by model and by day. The log lists counted requests. Prompt text is still not stored.
- The tray click opens a small popover (quota, recent lines, Open). The menu still opens the main window and quits.

## [0.4.0] - 2026-10-21

- Routes can name a fallback provider and model. Cursor is still not called. A route aimed at Cursor uses the fallback instead of failing when one is set.
- Antigravity (Google login on `127.0.0.1:51121`) is translated to `daily-cloudcode-pa.googleapis.com` generateContent, including tools. The prod Cloud Code host is never used.
- Codex access tokens are refreshed at `auth.openai.com` when the JWT is expired, and the new tokens are written back to `~/.codex/auth.json`. Requests send the Codex originator headers and omit `max_output_tokens`, which that API rejects.
- OpenRouter and Gemini are OpenAI-compatible providers. OpenRouter's key endpoint supplies a percent when the key has a credit limit.
- A provider error (429, 5xx, or a dropped connection) tries the next account or the fallback hop.
- Request rows (model, tokens, estimated cost, no prompt text) are kept for the dashboard.
- What still cannot be done is written in `docs/LIMITATIONS.md`.

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
