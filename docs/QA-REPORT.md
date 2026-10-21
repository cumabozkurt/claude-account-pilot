# QA report — v1.2.0

Independent pass over Claude Account Pilot 1.1.0, with the fixes shipped as 1.2.0. Turkish text is below the English sections.

Local unit and integration tests: **89 passed, 0 failed** (`npm test` on Linux, Node 22, no network). The packaged matrix is green on commit `5d0f6dd`: [CI run 39649209165](https://github.com/cumabozkurt/claude-account-pilot/actions/runs/39649209165). `npm test` passed on all three runners (89/89 on Linux and macOS; 87 passed and 2 skipped on Windows, where the symlink and hard-link cases are skipped). Screenshots and JSON reports are the `smoke-ubuntu-latest`, `smoke-macos-latest`, and `smoke-windows-latest` artifacts of that run. An earlier run, [39648500735](https://github.com/cumabozkurt/claude-account-pilot/actions/runs/39648500735), failed only in the harness: Linux executed the documentation directory, and the Windows uninstaller had not finished deleting files. The app checks in that run had already passed.

## What was tested

| Area | How |
|---|---|
| Proxy | In-process server with a mocked upstream. Streaming Anthropic bodies, tool calls in both directions, 429 then 503 then a dropped socket across five accounts, a missing secret, bind address `127.0.0.1`, header injection. |
| Rotation | Sticky under 98%, switch at 98% across three accounts, wrap, disabled accounts, unknown percent, short cooldown, least-used when every account is at the threshold. |
| Quota | Fraction and whole percents, 5h/7d headers, usage JSON, reset windows whose `resetsAt` has passed. |
| OAuth / refresh | Existing Claude, Codex, and Google refresh tests, plus a single-flight test that two overlapping callers share one refresh. |
| Discovery | Missing files, corrupt JSON, empty files, `pilot-local`, and `${...}` templates import nothing and do not throw. Descriptions do not contain secret values. |
| Settings | Backup, drift repair, restore, symlink refusal, directory symlink refusal, hard-link refusal, corrupt `config.json` quarantined to `config.json.broken`. |
| Language | `tr` / `tr_TR.UTF-8` → Turkish, anything else → English. Saving `lang` and loading it back keeps `tr` then `en`. |
| Updates | Asset URL must be this repo's release URL. Redirects to `evil.example` and to plain `http` are rejected. A redirect to `release-assets.githubusercontent.com` is accepted. `macAppBundle` uses the last `.app`. The Windows swap script rejects `&`. |
| Export / logs | Export drops `secretRef` and refresh lineage. Log lines are owner-only and rotated. |
| Packaged app | `PILOT_SELFTEST=1` with `PILOT_HOME` and `PILOT_USER_DATA` pointed at a temp directory. The process must answer `GET /health`, create the tray, write Claude `settings.json`, restore the seeded file, and select the fake 9.9.9 asset for that OS. The temp home is deleted afterwards. Linux also installs the `.deb` and removes it. Windows also runs the NSIS setup into `C:\pilot-qa` and its uninstaller. macOS unzips the zip for the runner architecture and deletes the bundle. |

## Bugs found and fixed

1. **Proxy start race.** `startListening` had no lock. A failed bind in a second caller set `proxy = null` and leaked the server that had succeeded. Starts now share one in-flight promise, and a failure does not clear a different server.
2. **Failover stopped after one hop.** A missing secret returned 409 without trying the next account. A 429 followed by a 5xx stopped even when more hops existed. One request now gets up to six attempts (missing secret, 429, 5xx, or a thrown disconnect). The upstream stream is destroyed before the retry. A client that already went away is not given another hop.
3. **Header injection.** `anthropic-beta` was copied onto the upstream request unchanged. Values with CR, LF, or NUL are dropped. A Codex account id is filtered the same way. A secret that contains a newline is treated as missing.
4. **Settings followed symlinks.** `applyClaudeBaseUrl` used `copyFileSync` / `writeFileSync`, which follow links. A symlink or a hard link is now refused, including a `~/.claude` directory that is itself a symlink. A path that resolves outside the home directory is refused.
5. **Corrupt config was overwritten.** `loadConfig` turned broken JSON into defaults and the next save replaced the file. The broken file is renamed to `config.json.broken` first.
6. **Refresh races.** Codex, Claude subscription, and Google refreshes could run twice if two requests overlapped, which rotates a refresh token and can invalidate the first result. Those refreshes are single-flight per secret.
7. **macOS self-replace.** `indexOf(".app/")` could select an earlier `.app` in the path and `rm -rf` the wrong tree. The bundle is now the last `.app` whose remainder is `/Contents/...`.
8. **Update redirects.** `fetch` followed any redirect. Downloads now stop unless every hop is `https` and the host is `github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`, or `github-releases.githubusercontent.com`. The v1.1.0 AppImage URL on GitHub does redirect to `release-assets.githubusercontent.com` (checked 2026-10-21, HTTP 302).
9. **Windows swap script.** Paths were interpolated into `swap.cmd` without rejecting `&`, quotes, or newlines. Those paths are rejected.
10. **Tray crash.** `new Tray` threw on a session with no status icon and took the process down. The failure is caught. The packaged smoke still requires a tray, so a headless miss fails the job instead of passing quietly.

Reviewed and left as they were:

- Unknown quota stays usable. The least-used sort only runs when every enabled account is already at the threshold.
- The proxy binds `127.0.0.1` only. Health returns account count, threshold, and `ok`, not secrets.
- Export and `pilot.log` do not store prompts or secret handles. Activity lines are truncated to 500 characters.
- A login whose refresh-token lineage matches `~/.claude/.credentials.json` is still not refreshed.
- Antigravity still uses only `daily-cloudcode-pa.googleapis.com`.
- Cursor is still detected and not routed.

## Results per OS

[Run 39649209165](https://github.com/cumabozkurt/claude-account-pilot/actions/runs/39649209165) on `5d0f6dd`, 2026-10-21. Every smoke line below was `ok`. The temp home was deleted after each launch, and the seeded `settings.json` matched the original bytes. Screenshots: `linux-appimage-en.png`, `linux-appimage-tr.png`, `linux-deb-en.png`, `mac-arm64-en.png`, `mac-arm64-tr.png`, `win-portable-en.png`, `win-portable-tr.png`, `win-setup-en.png`.

| OS | Launch | Proxy `/health` | Tray | settings.json | Fake release asset | Uninstall |
|---|---|---|---|---|---|---|
| Linux | AppImage under Xvfb, then the installed `.deb` at `/usr/bin/claude-account-pilot` | pass, ports 42191 (en), 43389 (tr), 46091 (deb) | pass | restored | AppImage selected `Claude.Account.Pilot-9.9.9-linux-x86_64.AppImage`. The deb has no self-replace (`kind=none`) | `apt-get remove` deleted the binary and `/opt/Claude Account Pilot` |
| macOS | Unzipped arm64 `.app` on `macos-latest`, quarantine attribute cleared | pass, ports 49223 (en), 49225 (tr) | pass | restored | `Claude.Account.Pilot-9.9.9-mac-arm64.zip` | the unzipped bundle was deleted |
| Windows | Portable exe, then NSIS `/S` into `C:\pilot-qa` | pass, ports 64116 (en), 64124 (tr), 64132 (setup) | pass | restored | portable selected `Claude.Account.Pilot-Portable-9.9.9-win-x64.exe`; setup selected `Claude.Account.Pilot-Setup-9.9.9-win-x64.exe` | the uninstaller removed `Claude Account Pilot.exe` |

## Pages and README

Checked live before this commit (HTTP 200):

- https://cumabozkurt.github.io/claude-account-pilot/ serves both languages from one page. `localStorage` key `pilot-lang` wins; otherwise `navigator.language` starting with `tr` selects Turkish. Buttons call `render`.
- Download points at https://github.com/cumabozkurt/claude-account-pilot/releases/latest (HTTP 302 to a real `release-assets.githubusercontent.com` object for the v1.1.0 AppImage).
- Source points at the repository. Screenshot paths are `images/overview-en.png` and `images/overview-tr.png`, copied from `docs/images` by the Pages workflow.
- README statements that match the code: listen address `127.0.0.1`, switch at 98%, Cursor not routed, `.deb` and `npm start` do not self-install, unsigned builds, Antigravity daily host only, Claude Desktop token not decrypted. The site copy in this commit adds the multi-hop failover and the lack of a signed checksum, which matches `docs/LIMITATIONS.md`.

## Remaining risks

- Builds are unsigned. macOS Gatekeeper can refuse a replaced `.app`.
- Release assets have no checksum in the GitHub release. A file of the right type from the hosts above is accepted.
- A new Claude account still needs the code Anthropic shows. The redirect URL cannot be changed.
- Claude Desktop `oauth:tokenCache` is not decrypted.
- Cursor has no stable tool-capable messages API and is not called.
- Antigravity refresh works only when a client id and secret are in a nearby JSON file.
- `.deb` and a dev checkout show the update link and do not replace themselves.
- The failover cap is six attempts. A longer chain stops there and returns the last error.
- Headless Linux needs a tray library (`libayatana-appindicator3-1`) and Xvfb. A session without them fails the smoke on purpose.
- The Windows NSIS silent install path is `C:\pilot-qa` on the CI runner. A failure there is a failed job, not a silent skip.

---

# Kalite raporu — v1.2.0

Claude Account Pilot 1.1.0 üzerinde bağımsız bir geçiş. Düzeltmeler 1.2.0 olarak çıktı.

Yerel birim ve tümleştirme sınamaları: **89 geçti, 0 kaldı** (Linux, Node 22, ağ yok). Paketli matris `5d0f6dd` işleminde yeşil: [CI koşusu 39649209165](https://github.com/cumabozkurt/claude-account-pilot/actions/runs/39649209165). `npm test` üç koşucuda da geçti (Linux ve macOS 89/89; Windows 87 geçti, 2 atlandı — sembolik bağ ve sabit bağ sınamaları Windows'ta atlanır). Ekran görüntüleri ve JSON raporlar o koşunun `smoke-ubuntu-latest`, `smoke-macos-latest` ve `smoke-windows-latest` artifaktlarıdır. Önceki koşu [39648500735](https://github.com/cumabozkurt/claude-account-pilot/actions/runs/39648500735) yalnız koşumda kaldı: Linux belge dizinini çalıştırdı, Windows kaldırıcısı dosyaları silmeyi bitirmemişti. O koşudaki uygulama kontrolleri geçmişti.

## Ne sınandı

| Alan | Nasıl |
|---|---|
| Vekil | Süreç içi sunucu, taklit yukarı akış. Anthropic akışı, iki yönde araç çağrısı, beş hesapta 429 sonra 503 sonra kopan soket, eksik sır, `127.0.0.1`, başlık enjeksiyonu. |
| Dönüşüm | %98 altında yapışkan, üç hesapta %98 eşiği, sarmalama, kapalı hesap, bilinmeyen yüzde, kısa bekleme, hepsi eşikteyken en az kullanılan. |
| Kota | Kesir ve tam yüzde, 5s/7g başlıkları, kullanım JSON'u, `resetsAt` zamanı geçmiş pencereler. |
| OAuth / yenileme | Var olan Claude, Codex ve Google sınamaları, artı iki çağıranın bir yenilemeyi paylaştığı tek uçuş sınaması. |
| Keşif | Eksik dosya, bozuk JSON, boş dosya, `pilot-local` ve `${...}` şablonu hiçbir şey almaz ve fırlatmaz. Açıklamalarda sır yoktur. |
| Ayarlar | Yedek, sapma onarımı, geri yükleme, sembolik bağ reddi, dizin bağının reddi, sabit bağ reddi, bozuk `config.json` dosyasının `config.json.broken` olarak kenara alınması. |
| Dil | `tr` / `tr_TR.UTF-8` → Türkçe, diğerleri → İngilizce. Kaydedilen `lang` geri yüklenince `tr` sonra `en` durur. |
| Güncelleme | Varlık adresi bu deponun yayın adresi olmalı. `evil.example` ve düz `http` reddedilir. `release-assets.githubusercontent.com` kabul edilir. `macAppBundle` son `.app` paketini kullanır. Windows betiği `&` karakterini reddeder. |
| Dışa aktarma / günlük | Dışa aktarma `secretRef` ve yenileme soyunu düşürür. Günlük satırları sahibine özeldir ve döner. |
| Paketlenmiş uygulama | `PILOT_SELFTEST=1`, `PILOT_HOME` ve `PILOT_USER_DATA` geçici dizindedir. Süreç `GET /health` yanıtlamalı, tepsiyi kurmalı, Claude `settings.json` yazmalı, tohum dosyayı geri yüklemeli ve o işletim sistemi için sahte 9.9.9 varlığını seçmelidir. Geçici ev sonra silinir. Linux `.deb` kurar ve kaldırır. Windows NSIS kurulumunu `C:\pilot-qa` içine alır ve kaldırıcıyı çalıştırır. macOS, koşucu mimarisinin zip dosyasını açar ve paketi siler. |

## Bulunan ve düzeltilen hatalar

1. **Vekil başlatma yarışı.** `startListening` kilitli değildi. İkinci çağıranın başarısız bağlaması `proxy` değerini silip başarılı sunucuyu sızdırıyordu. Başlatmalar tek bir sözü paylaşır.
2. **Yedekleme bir atlamada duruyordu.** Eksik sır 409 dönüp sonraki hesabı denemiyordu. 429 ardından 5xx, başka atlama varken duruyordu. Bir istek artık altı denemeye kadar gider. Akış yeniden denemeden önce kapatılır. Gitmiş bir istemciye yeni atlama verilmez.
3. **Başlık enjeksiyonu.** `anthropic-beta` olduğu gibi kopyalanıyordu. CR, LF veya NUL içeren değerler düşer. Codex hesap kimliği de süzülür. Satır sonu içeren bir sır eksik sayılır.
4. **Ayarlar sembolik bağı izliyordu.** Yazma artık sembolik bağı ve sabit bağı reddeder. `~/.claude` kendisi bağsa da reddedilir. Ev dışına çözülen yol reddedilir.
5. **Bozuk yapılandırma eziliyordu.** Kırık JSON önce `config.json.broken` olur.
6. **Yenileme yarışı.** Üst üste iki istek aynı Codex, Claude veya Google yenilemesini iki kez çalıştırabilirdi. Yenileme sır başına tek uçuştur.
7. **macOS kendi kendini değiştirme.** `indexOf(".app/")` yoldaki daha erken bir `.app` paketini seçip yanlış ağacı silebilirdi. Artık `/Contents/` ile devam eden son `.app` kullanılır.
8. **Güncelleme yönlendirmesi.** `fetch` her yönlendirmeyi izliyordu. Artık her atlama `https` olmalı ve konak GitHub yayın konaklarından biri olmalıdır. v1.1.0 AppImage adresi 2026-10-21'de `release-assets.githubusercontent.com` adresine 302 verdi.
9. **Windows değiştirme betiği.** Yollar `&`, tırnak veya satır sonu içeremez.
10. **Tepsi çökmesi.** Tepsi simgesi olmayan oturumda `new Tray` süreci düşürüyordu. Hata yakalanır. Paketli duman yine tepsi ister; başsız bir eksik işi sessizce geçirmez.

Olduğu gibi bırakılanlar: bilinmeyen kota kullanılabilir; vekil yalnız `127.0.0.1`; sağlık ucu sır dökmez; dışa aktarma ve `pilot.log` istem ve sır tutmaz; diskteki Claude Code yenileme belirteci yenilenmez; Antigravity yalnız günlük Cloud Code konağını kullanır; Cursor çağrılmaz.

## İşletim sistemi sonuçları

[Koşu 39649209165](https://github.com/cumabozkurt/claude-account-pilot/actions/runs/39649209165), işlem `5d0f6dd`, 2026-10-21. Aşağıdaki her duman satırı `ok` idi. Her başlatmadan sonra geçici ev silindi ve tohum `settings.json` özgün baytlarla aynı kaldı. Ekran görüntüleri: `linux-appimage-en.png`, `linux-appimage-tr.png`, `linux-deb-en.png`, `mac-arm64-en.png`, `mac-arm64-tr.png`, `win-portable-en.png`, `win-portable-tr.png`, `win-setup-en.png`.

| OS | Başlatma | Vekil `/health` | Tepsi | settings.json | Sahte yayın | Kaldırma |
|---|---|---|---|---|---|---|
| Linux | Xvfb altında AppImage, sonra `/usr/bin/claude-account-pilot` | geçti; kapılar 42191 (en), 43389 (tr), 46091 (deb) | geçti | geri yüklendi | AppImage `Claude.Account.Pilot-9.9.9-linux-x86_64.AppImage` seçti. Deb kendini değiştirmez (`kind=none`) | `apt-get remove` ikiliyi ve `/opt/Claude Account Pilot` dizinini sildi |
| macOS | `macos-latest` üzerinde açılmış arm64 `.app`, karantina özniteliği temizlendi | geçti; kapılar 49223 (en), 49225 (tr) | geçti | geri yüklendi | `Claude.Account.Pilot-9.9.9-mac-arm64.zip` | açılan paket silindi |
| Windows | Taşınabilir exe, sonra `C:\pilot-qa` içine NSIS `/S` | geçti; kapılar 64116 (en), 64124 (tr), 64132 (kurulum) | geçti | geri yüklendi | taşınabilir `Claude.Account.Pilot-Portable-9.9.9-win-x64.exe`; kurulum `Claude.Account.Pilot-Setup-9.9.9-win-x64.exe` | kaldırıcı `Claude Account Pilot.exe` dosyasını sildi |

## Sayfalar ve README

Bu işlemden önce canlı kontrol (HTTP 200):

- https://cumabozkurt.github.io/claude-account-pilot/ iki dili tek sayfada sunar. `pilot-lang` anahtarı varsa o kazanır; yoksa `navigator.language` `tr` ile başlıyorsa Türkçe seçilir.
- İndirme https://github.com/cumabozkurt/claude-account-pilot/releases/latest adresine gider (v1.1.0 AppImage için gerçek bir `release-assets.githubusercontent.com` nesnesine 302).
- Kaynak depodur. Ekran görüntüleri `images/overview-en.png` ve `images/overview-tr.png`.
- README'nin kodla uyuşan cümleleri: `127.0.0.1`, %98, Cursor yönlendirilmez, `.deb` ve `npm start` kendini kurmaz, imzasız derleme, Antigravity yalnız günlük konak, Claude Desktop belirteci çözülmez. Bu işlemdeki site metni, çok atlamalı yedeklemeyi ve imzalı sağlama olmadığını ekler; bu `docs/LIMITATIONS.md` ile aynıdır.

## Kalan riskler

- Derlemeler imzasızdır. macOS Gatekeeper değiştirilen `.app` paketini reddedebilir.
- Yayında sağlama yoktur. Doğru türde ve yukarıdaki konaklardan gelen dosya kabul edilir.
- Yeni Claude hesabı Anthropic'in gösterdiği kodu ister.
- Claude Desktop `oauth:tokenCache` çözülmez.
- Cursor'ın kararlı, araç kullanabilen bir mesaj API'si yoktur.
- Antigravity yenilemesi yalnız istemci kimliği bir JSON dosyasındaysa çalışır.
- `.deb` ve geliştirme kopyası yalnız bağlantıyı gösterir.
- Yedekleme tavanı altı denemedir.
- Başsız Linux tepsi kitaplığı ve Xvfb ister. Yoksa duman bilerek kalır.
- Windows sessiz kurulum yolu CI koşucusunda `C:\pilot-qa` dizinidir.
