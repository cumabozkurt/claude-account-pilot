# Değişiklik günlüğü

## [0.3.0] - 2026-10-21

- Claude Pro/Max abonelik girişi, Claude Code'un herkese açık OAuth istemcisini kullanır: tarayıcıda PKCE, kodu yapıştırma, dönen yenileme belirtecinin işletim sistemi anahtarlığında saklanması.
- `~/.claude/.credentials.json` içe aktarılır. Aynı yenileme soyu yeni bir hesap açmaz, var olanı günceller.
- Arka plan yoklaması `GET /api/oauth/usage` okur (5 saat, 7 gün, modele özel haftalık pencereler ve ek kullanım). Sıfırlanma zamanı geçmiş bir pencere düşülür; hesap sonraki yoklamadan önce yeniden kullanılabilir.
- Süresi dolan erişim belirteçleri JSON grant ile yenilenir. Claude Code'un diskteki oturumu sorgulanır ama yenilenmez; resmi istemci kendi oturumunu korur.
- "Claude Code'da kullan" `~/.claude/.credentials.json` dosyasını yedekleyerek yazar ve macOS'ta `Claude Code-credentials` anahtarlık kaydını günceller. Geri al, yedeği yerine koyar.
- Claude Desktop sohbeti kendi şifreli oturumunu tutar. Bu sınır uygulama içinde yazılır; çalışıyormuş gibi gösterilmez.
- Kota geçmişi (istemler olmadan) grafik için saklanır. Bildirimler, bir hesap eşiği geçince, sıfırlanmaya 15 dakika kalınca ve açık hesapların hepsi dolunca bir kez gelir.

## [0.2.0] - 2026-10-21

- Kota pencereleri, etkin hesap ve hareket listesi diske yazılır ve yeniden açılınca geri gelir. Dosyada sır yoktur.
- Uygulama simgesi 1024×1024. macOS kurulum derlemesi 256×256 simgeyi reddetmişti; v0.1.0'ın macOS işi bu yüzden düştü.

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
