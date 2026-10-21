# Değişiklik günlüğü

## [1.0.0] - 2026-10-21

- Dışa aktarma; hesaplar, rotalar, döküm ve kota geçmişini JSON olarak yazar. Sır tutamaçları ve yenileme parmak izleri dışarıda kalır.
- Hareket, uygulama veri klasöründeki `pilot.log` dosyasına eklenir. Satırlar kısadır ve istem içermez. Dosya 1 MB sonra döner.
- Açılışta ve Ayarlar'dan uygulama GitHub'da daha yeni bir sürüm arar ve bağlantısını gösterir. İmzalı olmayan derlemeler kendiliğinden kurulmaz.
- Belge sitesi ve iki README, abonelik girişini, yönlendirilen sağlayıcıları ve hâlâ gerçek olan sınırları anlatır.

## [0.5.0] - 2026-10-21

- Pencere Pano, Hesaplar, Rotalar, Günlük ve Ayarlar olarak ayrıldı. İlk açılışta, bir hesap eklenene veya geçilene kadar kısa bir sihirbaz görünür.
- Pano kota geçmişini ve modele ve güne göre belirteç ile tahmini maliyet tablolarını çizer. Günlük, sayılmış istekleri listeler. İstem metni hâlâ saklanmaz.
- Tepsi tıklaması küçük bir açılır pencere açar (kota, son satırlar, Aç). Menü ana pencereyi açmaya ve çıkmaya devam eder.

## [0.4.0] - 2026-10-21

- Rotalar bir yedek sağlayıcı ve model alabilir. Cursor hâlâ çağrılmaz. Cursor'a bakan bir rota, yedek varsa hata vermek yerine yedeği kullanır.
- Antigravity (Google girişi, `127.0.0.1:51121`) araç çağrıları dahil `daily-cloudcode-pa.googleapis.com` generateContent uçuna çevrilir. Üretim Cloud Code ucu hiç kullanılmaz.
- Codex erişim belirteci JWT'nin süresi dolunca `auth.openai.com` üzerinde yenilenir ve yeni belirteçler `~/.codex/auth.json` dosyasına yazılır. İstekler Codex originator başlıklarını taşır ve bu API'nin reddettiği `max_output_tokens` alanını çıkarır.
- OpenRouter ve Gemini, OpenAI uyumlu sağlayıcılardır. OpenRouter anahtar ucu, anahtarın kredi sınırı varsa yüzde verir.
- Sağlayıcı hatası (429, 5xx veya kopan bağlantı) sıradaki hesabı veya yedek adımı dener.
- İstek satırları (model, belirteç, tahmini maliyet; istem metni yok) pano için saklanır.
- Hâlâ yapılamayanlar `docs/LIMITATIONS.md` içindedir.

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
