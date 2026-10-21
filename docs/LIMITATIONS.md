# Limitations

Honest limits of Claude Account Pilot. The Turkish summary is at the bottom.

## Claude subscription

- Login uses the public Claude Code OAuth client (`9d1c250a-e61b-44d9-88ed-5944d1962f5e`) and `POST https://platform.claude.com/v1/oauth/token` as JSON. Anthropic can reject a token that does not look like the official client.
- The browser shows a code because the official redirect is `https://platform.claude.com/oauth/code/callback`, not this app. Paste that code.
- Refresh tokens rotate. This app refreshes only logins it stores itself. The refresh token currently sitting in `~/.claude/.credentials.json` is left alone, because refreshing it would sign Claude Code out.
- "Use in Claude Code" writes that file (backup first) and, on macOS, the keychain item `Claude Code-credentials`.
- **Claude Desktop's chat app cannot be switched this way.** Its saved OAuth token is encrypted with the operating system (`oauth:tokenCache` in `config.json`). This app does not decrypt that store. A short-lived `host-creds-*.json` file is used when Desktop has written one. The proxy covers Claude Code and the VS Code extension, which honor `ANTHROPIC_BASE_URL`.

## Other providers

| Provider | What works | What does not |
|---|---|---|
| OpenCode Go | OpenAI chat translation to `https://opencode.ai/zen/go/v1` | No percent quota |
| DeepSeek | Chat translation, balance when `/user/balance` returns one | No percent quota |
| Codex | ChatGPT login from `~/.codex/auth.json`, Responses API, refresh against `auth.openai.com` when the access JWT is expired. The rotated token is written back so Codex CLI stays valid. | A percent only when Codex sends the 5h/7d headers |
| OpenRouter | Chat translation, percent from `GET /api/v1/key` when the key has a credit limit | Unlimited keys have no percent |
| Gemini | OpenAI-compatible `generativelanguage.googleapis.com` with an API key | No percent quota |
| Antigravity | Google OAuth on `127.0.0.1:51121`, then `daily-cloudcode-pa.googleapis.com` `v1internal:generateContent` / `streamGenerateContent`. The prod host is never called. A token file at `~/.gemini/antigravity-cli/antigravity-oauth-token` is read at request time. If a Google client id and secret sit in a JSON file next to that install, they are copied into the OS keychain and used to refresh the token. They are not stored in this git repository. | No published percent. If the client id is compiled into the Antigravity binary and is not in a config file, this app cannot refresh the token. The current access token is used until it expires; running the Antigravity CLI refreshes the file, and the next request reads it. A project id is optional (`externalId`). |
| Cursor | Install detection | **No routing.** Cursor's subscription chat is a private ConnectRPC on `api2.cursor.sh` whose checksums change with the app. Sending traffic there would break on the next Cursor release and would not preserve Claude Code tool use. A route aimed at Cursor returns an error unless the route has a fallback. |

## Everything else

- Costs are list-price estimates for display, not invoices. Subscription plans are not billed per token.
- First launch is automatic when a login is already on disk. A brand-new Claude account still needs one paste: the public Claude client redirects to Anthropic's page and shows a code. That redirect cannot be changed from here.
- Automatic install works for a packaged AppImage (the `APPIMAGE` path), a macOS `.app` started from the zip build, and the Windows setup (`/S`) or portable exe. A `.deb` is not installed, because that needs root. A `npm start` checkout is not replaced. The download has to be this repo's release asset and has to look like a zip, an ELF AppImage, or a Windows executable.
- Builds are unsigned. macOS Gatekeeper can still refuse a replaced `.app` until it is opened once by hand.
- The menu-bar percent is macOS. Linux and Windows use the tray tooltip, the tray popover, and the optional floating widget.
- The docs site is published from `site/` by `.github/workflows/pages.yml`: https://cumabozkurt.github.io/claude-account-pilot/

## Türkçe özet

Kurulumdan sonra diskte oturum varsa elle bir şey girilmez. Yeni bir Claude hesabı için tarayıcıdaki kod bir kez yapıştırılır; yönlendirme Anthropic'e aittir. Claude Desktop'un kayıtlı belirteci şifrelidir, çözülmez. Antigravity istemci kimliği kurulumun JSON dosyasında yoksa ve ikili dosyanın içindeyse bu uygulama belirteci yenileyemez. Cursor yönlendirilmez. Otomatik kurulum AppImage, macOS zip ve Windows kurucusunda çalışır; `.deb` kök ister. Derlemeler imzasızdır. Menü çubuğundaki yüzde yalnız macOS'tadır.
