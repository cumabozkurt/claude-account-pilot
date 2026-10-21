# Security

Claude Account Pilot runs on your machine and talks only to the providers you configure.

- The proxy listens on `127.0.0.1`. Do not put it on a public interface.
- Secrets are stored with Electron `safeStorage` when the OS provides it. They are not written to `config.json` and they must not be committed.
- Discovered Codex and Claude tokens are read from the official CLI files at request time.
- The activity list does not store prompts or keys.
- Only add accounts that belong to you. Sharing a login is outside this project's use.

## Reporting

Open a GitHub issue for a bug that does not include a secret. If the report would have to contain a key, token, or request body, email the repository owner instead of posting it.

## Güvenlik

Claude Account Pilot sizin makinenizde çalışır ve yalnız yapılandırdığınız sağlayıcılarla konuşur.

- Vekil `127.0.0.1` üzerinde dinler. Onu herkese açık bir arayüze koymayın.
- Sırlar, işletim sistemi sağlıyorsa Electron `safeStorage` ile saklanır. `config.json` içine yazılmaz ve depoya konmamalıdır.
- Bulunan Codex ve Claude belirteçleri istek anında resmi CLI dosyalarından okunur.
- Hareket listesi istem veya anahtar saklamaz.
- Yalnız size ait hesapları ekleyin. Bir oturumu paylaşmak bu projenin kullanımının dışındadır.

## Bildirme

Sır içermeyen bir hata için GitHub issue açın. Bildirim bir anahtar, belirteç veya istek gövdesi taşımak zorundaysa depoya yazmak yerine depo sahibiyle doğrudan iletişime geçin.
