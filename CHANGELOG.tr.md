# Değişiklik günlüğü

## [0.1.0] - 2026-10-21

İlk herkese açık derleme.

- macOS, Windows ve Linux için masaüstü uygulaması (Electron).
- Claude Code ve VS Code eklentisi için `127.0.0.1` üzerinde yerel vekil.
- Aç/kapa anahtarlı hesap listesi. %98'de sıradaki uygun hesaba otomatik geçiş.
- Eşiğe kadar aynı hesap. Kısa bir 429 kotayı dolu saymaz; bir dakikalık bekleme koyar.
- Model rotaları. Haiku, OpenCode Go üzerindeki DeepSeek'e veya doğrudan DeepSeek'e çevrilebilir. İki rota da kapalı başlar.
- `~/.codex/auth.json` üzerinden Codex oturumunun Responses API ile kullanılması.
- Cursor ve Antigravity yalnız tespit edilir. Onlara yönlendirmek açık bir hata döndürür.
- Sağlayıcı yüzde yayınlıyorsa yüzde; ayrıca belirteç sayıları ve tahmini maliyet.
- Türkçe ve İngilizce. İlk açılışta işletim sistemi dili, sonra seçim hatırlanır.
- Sırlar işletim sistemi anahtarlığında (`safeStorage`). Tepsi, macOS menü çubuğunda yüzde, isteğe bağlı yüzen pencere.
- 25 benzer depo için araştırma notları: `docs/RESEARCH.md`.
