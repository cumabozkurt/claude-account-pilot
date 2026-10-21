# Contributing

Issues and pull requests are welcome.

- Node.js 22+. `npm ci`, then `npm test`.
- Keep secrets out of fixtures. Tests use fake keys such as `key-a`.
- UI strings go in both dictionaries in `src/core/i18n.ts`. The type of the Turkish table is tied to the English one, so a missing translation does not compile.
- The proxy core in `src/core` must not import Electron.

## Katkı

Issue ve pull request açabilirsiniz.

- Node.js 22+. `npm ci`, sonra `npm test`.
- Sırları test verisine koymayın. Testler `key-a` gibi sahte anahtarlar kullanır.
- Arayüz dizeleri `src/core/i18n.ts` içinde iki sözlüğe birden eklenir. Türkçe tablonun tipi İngilizceye bağlıdır; eksik çeviri derlenmez.
- `src/core` altındaki vekil çekirdeği Electron'a import etmemelidir.
