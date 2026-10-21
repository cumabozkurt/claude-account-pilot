# Limitations

Honest limits of Claude Account Pilot. The Turkish summary is at the bottom.

## Claude subscription

- Login uses the public Claude Code OAuth client (`9d1c250a-e61b-44d9-88ed-5944d1962f5e`) and `POST https://platform.claude.com/v1/oauth/token` as JSON. Anthropic can reject a token that does not look like the official client.
- The browser shows a code because the official redirect is `https://platform.claude.com/oauth/code/callback`, not this app. Paste that code.
- Refresh tokens rotate. This app refreshes only logins it stores itself. The refresh token currently sitting in `~/.claude/.credentials.json` is left alone, because refreshing it would sign Claude Code out.
- "Use in Claude Code" writes that file (backup first) and, on macOS, the keychain item `Claude Code-credentials`.
- **Claude Desktop's chat app cannot be switched this way.** It keeps a separate encrypted session. There is no published file or keychain item that signs that chat into another account. The proxy covers Claude Code and the VS Code extension, which honor `ANTHROPIC_BASE_URL`.

## Other providers

| Provider | What works | What does not |
|---|---|---|
| OpenCode Go | OpenAI chat translation to `https://opencode.ai/zen/go/v1` | No percent quota |
| DeepSeek | Chat translation, balance when `/user/balance` returns one | No percent quota |
| Codex | ChatGPT login from `~/.codex/auth.json`, Responses API, refresh against `auth.openai.com` when the access JWT is expired. The rotated token is written back so Codex CLI stays valid. | A percent only when Codex sends the 5h/7d headers |
| OpenRouter | Chat translation, percent from `GET /api/v1/key` when the key has a credit limit | Unlimited keys have no percent |
| Gemini | OpenAI-compatible `generativelanguage.googleapis.com` with an API key | No percent quota |
| Antigravity | Google OAuth on `127.0.0.1:51121`, then `daily-cloudcode-pa.googleapis.com` `v1internal:generateContent` / `streamGenerateContent`. The prod host is never called. The OAuth client id and secret are entered in the app. They are the public desktop-client values used by tools such as CLIProxyAPI, and they are not stored in this git repository because GitHub secret scanning rejects them. | No published percent. A project id is optional (`externalId`). Tool calls are translated; image models are marked `image_gen` but not specialized. |
| Cursor | Install detection | **No routing.** Cursor's subscription chat is a private ConnectRPC on `api2.cursor.sh` whose checksums change with the app. Sending traffic there would break on the next Cursor release and would not preserve Claude Code tool use. A route aimed at Cursor returns an error unless the route has a fallback. |

## Everything else

- Costs are list-price estimates for display, not invoices. Subscription plans are not billed per token.
- Builds are unsigned.
- The menu-bar percent is macOS. Linux and Windows use the tray tooltip and the floating widget.
- GitHub Pages and the repo description/topics cannot be set from this environment when the token returns 403. The workflow is in `.github/workflows/pages.yml`.

## Türkçe özet

Claude Pro/Max girişi Claude Code ile aynı OAuth istemcisini kullanır. Claude Code'un açık oturumu yenilenmez. "Claude Code'da kullan" kimlik dosyasını ve macOS anahtarlığını yazar. Claude Desktop sohbeti ayrı bir şifreli oturum tuttuğu için bu yolla değiştirilemez. Codex, OpenRouter, Gemini, DeepSeek, OpenCode Go ve Antigravity (yalnız `daily-cloudcode-pa`) gerçekten yönlendirilir. Cursor'ın kararlı bir herkese açık mesaj API'si yoktur; trafik gönderilmez. Maliyetler tahmindir. Derlemeler imzasızdır.
