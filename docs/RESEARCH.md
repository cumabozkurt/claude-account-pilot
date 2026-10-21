# Research: 25 similar projects

Snapshot date: **21 October 2026**. Window: repositories **created or pushed on or after 21 April 2026**, ranked by GitHub stars. Star counts are the public `stargazers_count` that day.

The search covered Claude multi-account switchers, Claude Code usage and quota monitors, claude-code-router-style proxies, CLIProxyAPI-style auth reuse, Codex / Antigravity / Cursor bridges, and menu-bar usage widgets. Projects below the cut that still shaped a detail are listed under honorable mentions.

## Executive summary

The popular tools split into four jobs, and almost none of them do all four on one screen:

1. **Switch the Claude credential** (claude-swap, clauth, ccm, ccswitch). Fast, local, often a TUI. Quota is a dashboard, and the switch is a command or a daemon.
2. **Show the quota** (CodexBar, Claude Code Usage Monitor, claude-pace, openusage, usage, quotabar, headroom). The best of these read the server's own 5-hour and 7-day meters, and they put the number in a menu bar. They do not route traffic.
3. **Proxy and translate** (Claude Code Router, CC Switch, ccrelay, relay, CC-Router, teamclaude, maxpool). One local base URL, many upstreams, Anthropic ↔ OpenAI ↔ Responses. CC Switch (about 147k stars) and Claude Code Router (about 38k) show that a desktop or long-running local process is what people actually keep open.
4. **Reuse a subscription that is already logged in** (CLIProxyAPI, CodexBar, agent-vibes, aio-proxy, headroom). The credential stays on the machine. Several authors warn that Anthropic has blocked replay of subscription OAuth from third-party clients, so an API key path has to keep working when OAuth does not.

What this app takes from that:

- A **98%** switch (teamclaude's default, and the behavior asked for here), **sticky** until that line so prompt caches stay warm, and **no rotation on a short 429** (teamclaude, maxpool).
- **5-hour and 7-day** windows when a provider publishes them, plus **tokens and an estimated cost** even when it does not (openusage, clauth, usage).
- A **local Anthropic-compatible proxy** Claude Code and the VS Code extension already know how to use (`ANTHROPIC_BASE_URL`).
- **OpenAI Chat Completions and Responses translation**, including tools and streaming, aimed first at OpenCode Go's DeepSeek models.
- **Discovery of Codex / Claude Code / Cursor / Antigravity** on disk. Codex can be forwarded. Cursor and Antigravity are shown and not pretended to be a messages API.
- **One screen** of toggles, not CC Switch's ten tools. A tray, a macOS menu-bar percent, and a small always-on-top widget.
- **Electron**, because the closest app in this user's own repos (Agent Switchboard) already ships Electron installers for three operating systems, with the same tray and local router shape. Tauri is the other serious choice (CC Switch, quotabar, headroom, cc-pane) and wins on binary size. It is discussed below.

## Özet (Türkçe)

Son altı ayda güncellenmiş, bu işe benzeyen en yıldızlı 25 depo dört kümeye ayrılıyor: hesap değiştirenler, kota gösterenler, çeviren yerel vekiller, ve bilgisayarda açık olan aboneliği yeniden kullananlar. Hiçbiri dördünü tek ekranda, sürekli izleyerek ve %98'de kendiliğinden geçerek yapmıyor.

Buradan alınan kararlar:

- Etkin hesap **%98** dolana kadar aynı kalır (önbellek soğumasın). Kısa **429** hız sınırı hesabı "dolu" saymaz; kota dolunca sıradaki açık hesaba geçilir.
- Yüzde varsa **5 saat / 7 gün** pencereleri gösterilir. Yüzde yayınlamayan sağlayıcıda bile **belirteç sayısı ve tahmini maliyet** tutulur.
- Claude Code ve VS Code eklentisi tek bir `ANTHROPIC_BASE_URL` adresine bakar. Haiku gibi bir model, kural açıksa OpenCode Go üzerindeki DeepSeek'e çevrilir.
- Codex oturumu dosyadan okunur. Cursor ve Antigravity tespit edilir; herkese açık kararlı bir mesaj API'leri olmadığı için istek onlar üzerinden sessizce yazılmaz.
- Arayüz tek ekrandır. Tepsi, macOS menü çubuğunda yüzde, ve küçük bir yüzen pencere vardır.
- Yığın **Electron**'dur. Aynı kullanıcının Agent Switchboard deposu üç işletim sistemi için bu yığınla kurulum dosyası üretiyor. Tauri daha küçük ikili verir (CC Switch, quotabar) ama bu deponun yayın çizgisine Electron uyar.

## The 25

| # | Repository | Stars | Pushed | Language / stack | Job |
|---|---|---:|---|---|---|
| 1 | [farion1231/cc-switch](https://github.com/farion1231/cc-switch) | 147098 | 2026-10-21 | Rust, Tauri 2 | Desktop provider switch, router, tray quotas |
| 2 | [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | 55869 | 2026-10-21 | Go | Subscription auth reused as an API |
| 3 | [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router) | 37781 | 2026-10-10 | TypeScript | Local model gateway for many agents |
| 4 | [steipete/CodexBar](https://github.com/steipete/CodexBar) | 22710 | 2026-10-21 | Swift, macOS menu bar | Codex and Claude usage without a second login |
| 5 | [Maciek-roboblog/Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | 8754 | 2026-07-05 | Python, Rich | Terminal usage monitor, forecasts, official limits |
| 6 | [realiti4/claude-swap](https://github.com/realiti4/claude-swap) | 3733 | 2026-10-21 | Python | Multi-account switcher and auto rotation |
| 7 | [coollabsio/jean](https://github.com/coollabsio/jean) | 1351 | 2026-10-21 | Tauri 2, React 19 | Agent workspace, not a quota router |
| 8 | [wuxiran/cc-pane](https://github.com/wuxiran/cc-pane) | 568 | 2026-10-21 | Tauri 2 | Parallel Claude Code panes |
| 9 | [KarpelesLab/teamclaude](https://github.com/KarpelesLab/teamclaude) | 430 | 2026-10-20 | Node.js, no dependencies | Quota-aware multi-account proxy |
| 10 | [funny-vibes/agent-vibes](https://github.com/funny-vibes/agent-vibes) | 359 | 2026-10-05 | TypeScript | Antigravity, Codex, Kiro gateway |
| 11 | [aqua5230/usage](https://github.com/aqua5230/usage) | 341 | 2026-10-21 | Python, tray | Menu bar / tray quotas and cost |
| 12 | [uwuclxdy/clauth](https://github.com/uwuclxdy/clauth) | 252 | 2026-10-21 | Rust | TUI switcher, live bars, MCP delegation |
| 13 | [Astro-Han/claude-pace](https://github.com/Astro-Han/claude-pace) | 240 | 2026-09-24 | Bash, jq | Statusline with burn-rate pace |
| 14 | [janekbaraniewski/openusage](https://github.com/janekbaraniewski/openusage) | 230 | 2026-10-19 | Go | Cross-tool local usage dashboard |
| 15 | [aiedwardyi/claude-usage-monitor](https://github.com/aiedwardyi/claude-usage-monitor) | 58 | 2026-10-13 | Python | Statusline: 5h, 7d, tokens, countdown |
| 16 | [majiayu000/quotabar](https://github.com/majiayu000/quotabar) | 54 | 2026-10-21 | Tauri 2 | Menubar for Claude, Codex, Cursor, Antigravity |
| 17 | [VictorMinemu/CC-Router](https://github.com/VictorMinemu/CC-Router) | 39 | 2026-08-31 | TypeScript, Node 20 | Round-robin Claude and Codex proxy |
| 18 | [inflaborg/ccrelay](https://github.com/inflaborg/ccrelay) | 22 | 2026-10-09 | Electron, desktop | Third-party models inside Claude and ChatGPT apps |
| 19 | [aio-proxy/aio-proxy](https://github.com/aio-proxy/aio-proxy) | 19 | 2026-10-12 | TypeScript | One port, many subscription logins |
| 20 | [MadSkittles/Router-Maestro](https://github.com/MadSkittles/Router-Maestro) | 18 | 2026-10-14 | Python | Copilot catalog for Claude, Codex, Gemini clients |
| 21 | [allandecastro/headroom](https://github.com/allandecastro/headroom) | 11 | 2026-06-09 | Tauri 2, React | Menu bar, keychain, server-side percents |
| 22 | [ImBIOS/relay](https://github.com/ImBIOS/relay) | 10 | 2026-06-29 | TypeScript, Bun | Hot-switch providers, protocol translation |
| 23 | [Remeic/ccm](https://github.com/Remeic/ccm) | 9 | 2026-08-21 | TypeScript | Profile isolation, strict terms-of-service note |
| 24 | [claude-code-tools/claude-code-account-switcher](https://github.com/claude-code-tools/claude-code-account-switcher) | 9 | 2026-06-29 | Go | One binary, OS credential store, per-account command |
| 25 | [asyncdargen/claude-proxy](https://github.com/asyncdargen/claude-proxy) | 7 | 2026-10-15 | Kotlin | Priority rotation, live limits, OpenAI and Anthropic gateways |

## Per project

### 1. CC Switch — farion1231/cc-switch

Desktop All-in-One for Claude Code, Codex, OpenCode and several other CLIs. Tauri 2. One click writes the endpoint, key and model, and leaves the user's own MCP and hooks alone. A routing mode converts API formats so GPT can be used from Claude Code. Tray shows remaining subscription quota. About 90 provider presets. This is the strongest proof that a native-feeling desktop app, not only a TUI, is what a large audience installs. It is broader than this project: it manages skills, prompts and session readers. We keep the tray, the one-click Claude settings write, and the translating router, and we drop everything that is not quota, accounts, or a model route.

### 2. CLIProxyAPI — router-for-me/CLIProxyAPI

Go service that wraps Antigravity, ChatGPT Codex, Claude Code, Grok, Muse and Devin as OpenAI, Gemini, Claude or Codex compatible endpoints. This is the reference for "reuse the login you already have". It is a server, not a quota screen, and it is willing to speak private client protocols. We reuse the idea for Codex (`~/.codex/auth.json` → Responses API) and we stop where the protocol is not a documented HTTP API. Cursor and Antigravity stay visible and are not given a fake success path.

### 3. Claude Code Router — musistudio/claude-code-router

TypeScript local control plane. One stable endpoint for Claude Code and many other agents. Credential pools, fallbacks, request logs, token and cost estimates. Providers include OpenAI Chat and Responses, Anthropic Messages, Gemini, OpenRouter, DeepSeek and others. We copy the shape of the local endpoint and the rule that the log stores metadata, never the prompt. We do not try to cover every agent CLI.

### 4. CodexBar — steipete/CodexBar

Swift menu-bar app. Reads Codex and Claude usage from credentials already on the Mac, so the user does not log in again. Very high star count for a single-platform widget, which is why this app keeps a tray presence and a percent in the macOS menu bar. CodexBar does not switch accounts or translate models. It is also macOS-only; the widget here is a small always-on-top window so Linux and Windows have somewhere to look when a tray icon is easy to lose.

### 5. Claude Code Usage Monitor — Maciek-roboblog/Claude-Code-Usage-Monitor

Python Rich terminal. Official `rate_limits` when Claude Code provides them, labeled local estimates otherwise, forecasting, and a local warehouse. The useful lesson is provenance: a number on screen should say whether it came from the provider, from rate-limit headers, or from a local ledger. This app's account cards do that. We do not ship a forecasting warehouse in 0.1.

### 6. claude-swap — realiti4/claude-swap

Python CLI. The closest pure account switcher. `cswap add` snapshots the current Claude login, `cswap switch` rotates, `cswap list` shows 5-hour and 7-day usage, and `cswap auto` polls (default every 60s) and switches at a threshold (default 90%, weekly can be set near 97%). Strategies include most-quota-left and consume-first. It warns that `/logout` can revoke the refresh token of the account you are leaving. We poll on a similar period, we default the threshold to 98% as requested, and we switch inside the proxy so a running Claude Code process does not have to be restarted to change account. Restart is still required after the base URL is written the first time.

### 7. Jean — coollabsio/jean

Tauri 2, React 19, Rust. A workspace that runs Claude, Codex, Cursor, OpenCode and others in git worktrees. Included because it is a popular 2026 desktop shell around the same CLIs, and because its stack (Tauri, React, Tailwind) is the fashionable one. It is not a quota router. It confirms Tauri is production-ready for this audience, which is why the stack section below takes that option seriously.

### 8. CC-Panes — wuxiran/cc-pane

Tauri 2 desktop for parallel Claude Code sessions, with MCP and git. Relevant as a multi-session UI, not as a quota system. Parallel use of one Claude account is exactly what ccm tells people not to do. This app does not spawn extra Claude processes. It only chooses which credential the existing process's HTTP calls use.

### 9. TeamClaude — KarpelesLab/teamclaude

Node.js built-ins only. The closest match to the proxy behavior we want. It rotates when the 5-hour or 7-day bucket hits a threshold (**98% by default**), prefers the account whose week resets sooner, tracks a per-model weekly cap, and **refuses to rotate on a per-minute rate limit** because that would stampede the next account and drop a warm cache. It paces a freshly chosen account, refreshes OAuth, can fall back to an Anthropic-compatible API such as DeepSeek, and can pool Codex. The TUI edits accounts while the server runs. We take the 98% default, the sticky-until-threshold rule, the short-429 cooldown, and the DeepSeek fallback. We do not hold a request open until reset, and we do not turn on paid extra usage.

### 10. Agent Vibes — funny-vibes/agent-vibes

TypeScript gateway. Claude Code and Cursor as clients; Antigravity, Codex, Claude-compatible APIs and Kiro as backends, including a ConnectRPC path for Cursor. The README warns that proxying Antigravity can put the account at risk of a ban. That warning is why Antigravity here is detect-only.

### 11. usage — aqua5230/usage

Python menu-bar (macOS) and tray (Windows) app. Pins Claude Code, Codex, Antigravity and Grok quota, burn rate and cost. Local-first, no telemetry, HTML reports. It is the best picture of "quotas for several coding apps in a tray". Antigravity's quota is the weak spot there too. We show the same honesty in the provider note instead of a fake percent.

### 12. clauth — uwuclxdy/clauth

Rust TUI and daemon. Switch, live 5h/7d bars, a token dashboard with API-equivalent cost, auto-switch along a fallback chain, parallel config dirs, MCP delegation, and a `status.json` a menu-bar app can read. Also adopts a Codex profile. Cost shown next to the percent is the pattern for our account cards. We are the menu-bar app rather than a daemon that feeds one.

### 13. claude-pace — Astro-Han/claude-pace

Single Bash file. Statusline that compares burn rate to time left in the window, not only the percent. Requires Claude Code rate-limit data on stdin and refuses to show a cached percent that might belong to another account. We also refuse to invent a percent: unknown stays "no public quota %", with the token ledger beside it. Pace forecasting is not in 0.1.

### 14. OpenUsage — janekbaraniewski/openusage

Go terminal dashboard for Claude, Cursor, Codex, Copilot, Gemini, OpenRouter and many others. Auto-detects tools, background daemon, SQLite the user owns, cost by model. Detection-without-configuration is what our "found on this computer" section copies, in a much smaller form. We do not scan 35 providers.

### 15. claude-usage-monitor — aiedwardyi/claude-usage-monitor

Python statusline. 5h, 7d, context, token counts, reset countdown, using the existing OAuth session and no extra API key. Confirms that both windows and raw token counts belong on the same row.

### 16. QuotaBar — majiayu000/quotabar

Tauri 2 menubar. Claude 5h/7d/Opus/Sonnet windows, Codex windows, Cursor when a session exists, Antigravity as a placeholder, local cost for today/week/month. Background poll every 60 seconds, back off on 429 and on auth failure. Read-only toward Claude OAuth: it does not refresh or write tokens. Our probe interval matches. We also do not refresh Claude OAuth in 0.1, because a wrong refresh request can revoke a session (see claude-swap's logout warning).

### 17. CC-Router — VictorMinemu/CC-Router

TypeScript. Round-robin across Claude Max accounts, Codex through a Responses-compatible route, OAuth refresh, 429 cooldown, a terminal dashboard, optional mitmproxy for Claude Desktop. Cross-platform Node 20. The Codex Responses route is the same family of translation we implement. Round-robin is intentionally not our default: teamclaude's evidence says spreading every request thrashes caches. We stay sticky until 98%.

### 18. CCRelay — inflaborg/ccrelay

Electron desktop for macOS and Windows. One local address for Claude Code, Claude Desktop, Codex CLI and the ChatGPT app. Converts Anthropic Messages, Chat Completions and Responses. One-click client configuration and restore. This is the nearest Electron cousin and a reason Electron is a known-good shell for this exact UI. We add Linux, account quotas, and the 98% switch, which CCRelay is not built around.

### 19. AIO Proxy — aio-proxy/aio-proxy

TypeScript local gateway. OpenAI, Anthropic and Gemini clients, OAuth logins for ChatGPT, Claude, Copilot, Cursor and others, failover, traces. Plugin SDK. Ambitious and young (19 stars). Cursor login reuse is claimed here; the protocol moves often. We do not route through Cursor until there is a stable local HTTP API that preserves tools.

### 20. Router-Maestro — MadSkittles/Router-Maestro

Python. GitHub Copilot's catalog exposed to Claude Code, Codex and Gemini CLI, with protocol conversion only when the client and the model differ. Priority fallback. Not multi-account Claude. The "translate only when the protocols differ, otherwise pass bytes through" rule is how our Claude accounts are handled: same protocol means a pipe, not a rewrite.

### 21. Headroom — allandecastro/headroom

Tauri 2 menu bar for Claude and Copilot. Server-enforced percents, not log parsing. Codex read from `~/.codex` with the token already stored there. Credentials in the OS keychain (Keychain, Credential Manager, Secret Service). Multiple Copilot accounts. Threshold notifications. This is the cleanest statement of the storage rule we follow: secrets in the OS store, config JSON without secrets.

### 22. Relay — ImBIOS/relay

TypeScript (Bun) proxy that hot-switches providers under a client that cached the base URL at startup. Copilot, OpenAI, Anthropic, DeepSeek, Ollama and others. Auto-rotation when quotas exhaust, Anthropic↔OpenAI translation, usage percent and reset timers. Hot-switch without restarting Claude Code is the reason our proxy, not a settings rewrite, performs the account change.

### 23. ccm — Remeic/ccm

TypeScript profile manager, "nvm for Claude Code". The README's terms section is the one we echo: one account is one person; the tool does not grant extra rights; do not share credentials. Profiles are isolated directories. We are a proxy, not a profile switcher, and we say the same thing about whose accounts may be added.

### 24. claude-code-account-switcher — claude-code-tools/claude-code-account-switcher

Go single binary. One long-lived OAuth token per account in the OS credential store, a command per account (`claude-gmail`), shared `~/.claude` settings. Switching without a proxy means the process environment changes. Our proxy avoids that after the first base-URL write. The credential-store lesson still holds.

### 25. claude-proxy — asyncdargen/claude-proxy

Kotlin. Self-hosted multi-account rotation for Claude Code, priority order, live rate-limit tracking, per-user limits, OpenAI and Anthropic gateways. Smaller and newer. Same architecture as teamclaude and this app: the client speaks Anthropic, the proxy picks an account. Priority order is an extra we do not need; the user asked for "the next available".

## Honorable mentions (outside the top 25)

- [2solarmax/maxpool](https://github.com/2solarmax/maxpool) (5 stars, pushed 2026-10-21). Ranks accounts by remaining quota divided by time-to-reset, so a window about to reset is drained. Session affinity until the account is actually unavailable. We keep affinity (sticky) and not the use-it-or-lose-it score, because the request here is a simple next-account switch at 98%.
- [27b-io/anthropic-lb](https://github.com/27b-io/anthropic-lb) (4 stars). Rust weighted load balancer using rate-limit headers, 429 cooldown, token accounting. Header parsing here follows the same idea at a smaller scale.
- [mahui/llm-bridge](https://github.com/mahui/llm-bridge). Says outright that providers ban OAuth extraction and that its gateway calls official CLI harnesses instead of replaying tokens. Chat-only, no tools. That limitation is why a CLI subprocess is not how we serve Claude Code: Claude Code always sends tools.
- [mmmeff/codex-cursor-bridge](https://github.com/mmmeff/codex-cursor-bridge). Codex subscription as an OpenAI-compatible local port. Cursor's own BYOK calls come from Cursor's cloud, so a localhost bridge is not enough for Cursor. Another reason not to claim Cursor routing.
- [gitduk/ccs](https://github.com/gitduk/ccs) and [Ike-li/ccs](https://github.com/Ike-li/ccs). Small provider switchers. ccs (gitduk) does Anthropic ↔ OpenAI ↔ Gemini and can attach a shell command as a quota probe. A quota command hook is a reasonable later extension; 0.1 probes known HTTP endpoints only.
- [nhtera/ccswitch](https://github.com/nhtera/ccswitch). Go, sub-150ms credential swap, quota via `list --usage`, no telemetry except the optional Anthropic quota call. The "do not phone home" rule matches this app: the only network calls are the user's own providers.

## Stack choice

| | Electron (chosen) | Tauri 2 |
|---|---|---|
| Who already ships it for this job | CCRelay; this user's Agent Switchboard (same three OS installers, tray, local translating router, English and Turkish) | CC Switch, Jean, CC-Panes, QuotaBar, Headroom, Mochi |
| Binary size | Large, because Chromium is bundled | Small, system webview |
| Language | TypeScript for the UI and the proxy, one test run | Rust proxy plus a JS UI |
| OS keychain | `safeStorage` (Keychain, DPAPI, Secret Service) | `keyring` crate |
| Tray and a small always-on-top window | Supported on macOS, Windows and Linux | Supported, with more platform code |
| Release pipeline in this user's repos | Already proven in Agent Switchboard | Proven in Super Orkestra, not in the router app |

Electron is the choice so the proxy, the tests and the window share one language, and so the GitHub Actions files can follow a pipeline this user already publishes. Tauri would be the right pick if binary size were the main constraint. The proxy core does not import Electron, so a Tauri shell could call it later without rewriting rotation or translation.

## Design consequences

- Threshold default **98**, editable from 50 to 99. Sticky until then. Next enabled account under the line. If every account is hot, the least-used one is chosen and the UI can show that reason.
- A **429** with utilization still under the threshold sets a **60 second cooldown** on that account and retries the next one once. It does not set the quota to 100%.
- Claude traffic in the same protocol is **piped**. Haiku (or any glob) can be translated to OpenCode Go (`https://opencode.ai/zen/go/v1`, model `deepseek-v4-flash` by default) or to DeepSeek's own API. Both routes ship **off**.
- Codex uses the Responses API with the local CLI token. API-key Codex files are sent to `api.openai.com` instead of the ChatGPT backend.
- Percent comes from 5h/7d utilization headers, from an OAuth usage document, or stays unknown. Tokens and estimated USD always come from the response usage object. Prices are labeled estimates.
- Config JSON holds labels, toggles and secret *handles*. Secret values go through Electron `safeStorage`. A discovered Codex or Claude token is read from the official file at request time and is not copied.
- No telemetry. The proxy binds to `127.0.0.1` only.

## Tasarım sonuçları (Türkçe)

- Eşik varsayılan **%98**. Hesap bu değere gelene kadar değişmez. Sonra sıradaki eşiğin altındaki hesap gelir.
- Kota dolmadan gelen kısa **429**, hesabı bir dakika dışarıda bırakır; kotayı %100 yapmaz.
- Claude istekleri aynı protokolde olduğu gibi iletilir. Haiku, kullanıcı açarsa OpenCode Go üzerinden DeepSeek'e veya doğrudan DeepSeek'e çevrilir. Bu rotalar kurulumda **kapalıdır**.
- Codex, makinedeki CLI belirtecini Responses API ile kullanır.
- Yüzde yoksa uydurulmaz. Belirteç ve tahmini dolar her yanıtta birikir.
- Ayar dosyasında sır yoktur. Sırlar işletim sistemi anahtarlığındadır. Codex veya Claude belirteci resmi dosyadan okunur, kopyalanmaz.
- Telemetri yoktur. Vekil yalnız `127.0.0.1` üzerinde dinler.
