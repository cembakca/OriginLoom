# Framework araştırması — OriginLoom'a ne alınmalı (2026-08)

Bu belge Next.js, Nuxt/Nitro, Astro, SvelteKit ve komşularının **motor tarafını** inceleyip
OriginLoom'a alınmaya değer olanları biriktirir. Amaç özellik listesi kopyalamak değil: her madde
"bu framework hangi problemi çözmüş, biz o problemi yaşıyor muyuz, Hono + Vite üzerinde karşılığı ne
olur" sorusuna cevap verecek şekilde yazıldı.

Kod yok, karar yok — bu bir **araştırma çıktısı**. Hangisinin yapılacağı ayrı bir tartışma.

---

## 0. Metodoloji ve okuma notu

Her madde şu formatta:

- **Ne**: kaynak framework'te ne var.
- **Bizde**: OriginLoom'un bugünkü durumu (bu repoda doğrulandı, tahmin değil).
- **Değer**: alırsak ne kazanırız.
- **Maliyet/risk**: neyi kırar, ne kadar iş.

Öncelik etiketleri: **[P1]** v1 sonrası ilk dalga · **[P2]** orta vade · **[P3]** fikir olarak dursun ·
**[HAYIR]** araştırdım, bize uymuyor (gerekçesiyle).

---

## 1. OriginLoom bugün nerede

Öneri listesinin gereksiz yere şişmemesi için mevcut envanter — bunlar **zaten var**, tekrar
önerilmiyor:

| Alan               | Var olan                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cache              | L1 bellek + L2 Redis katmanlı HTML cache, SWR, cold-fill single-flight, tag tabanlı purge, `defineCachedResource` ile veri cache'i, cache key codec, per-device fragmentasyon                      |
| Render             | SSR + fragment stitching (header/footer/hellobar), island runtime (`hydrate`/`defer`), shell dependency plan, streaming                                                                            |
| Routing            | `defineRoute` + route tablosu, CMS redirect map (allowlist'li), rewrite/proxy kuralları, route manifest                                                                                            |
| Güvenlik           | CSP + nonce (cache HIT'te yeniden damgalama), HSTS, frame-ancestors, BFF auth (HttpOnly), public API guard, rate limit (dağıtık + yerel), request deadline, trusted proxy zinciri, secret'lı purge |
| Gözlemlenebilirlik | OpenTelemetry tracing, ayrı port'ta metrics, yapısal log, client error/telemetry toplama, SSR diagnostics                                                                                          |
| Kapasite           | SSR admission control (503 shedding), capacity/performance gate'leri, cache acceptance testleri                                                                                                    |
| Tedarik zinciri    | SBOM, dependency-track, audit gate, `minimumReleaseAge`                                                                                                                                            |
| DX / araç          | `origin-create-app` (plugin'li), doctor + migrate, mock gateway, gateway contract fixture'ları, Claude skill'leri, bundle bütçeleri, Lighthouse + axe gate'leri                                    |

Bu tablo öneri listesindeki "bizde" satırlarının dayanağı.

---

## 2. Render ve kişiselleştirme

### 2.1 Server Islands — sunucuda ertelenmiş, cache'lenebilir kişiselleştirme **[P1]** **[YAPILDI — 0.7.29]**

- **Ne**: Astro 5'in `server:defer` direktifi. Sayfanın tamamı statik/cache'li HTML olarak CDN'den
  anında gider; kişisel parça bir placeholder olarak render edilir ve ayrı bir sunucu isteğiyle
  doldurulup yerine dikilir. Astro'nun kendi demosunda kabuk 21ms'de geliyor, kişisel parça
  arkasından geliyor.
- **Bizde**: `defer` island'ımız var ama o **istemci tarafında** çalışıyor — tarayıcı JS'i indirip
  island'ı mount edip fetch atıyor. Yani JS kapalıyken kişisel içerik hiç gelmiyor, ve LCP'den sonra
  bir dalga daha var.
- **Değer**: Bu bizim mimarimizin tam ortasındaki gerilimin cevabı. "Cache'li HTML herkese aynıdır,
  kişisel şey `defer` island'a gider" kuralımız doğru ama bedeli var: kişisel içerik JS'e bağımlı.
  Server island bu bedeli kaldırıyor — kabuk paylaşılan cache'ten, delik sunucudan, ikisi de HTML.
  `e2e/ssr.no-js.spec.ts` gate'imiz olduğu için bu bizde ölçülebilir bir kazanç.
- **Maliyet/risk**: Placeholder'ın props'unu ikinci isteğe taşımak gerekiyor ve **bu props imzalanmalı
  ya da şifrelenmeli** — aksi halde "sunucuda render et" ucu, saldırganın props uydurabildiği bir
  endpoint'e dönüşür. Astro props'u şifreliyor; biz zaten `serializeEmbeddedJson` ve nonce
  altyapısına sahibiz, imzalama için `secretMatches`/HMAC tarafımız hazır. Fragment stitching
  altyapımız (`stitch-fragments`) bunun yarısını zaten yapıyor — server island, "istek başına
  çözülen fragment" olarak modellenebilir.

### 2.2 Partial Prerendering (PPR) — tek yanıtta statik kabuk + akan delikler **[P2]**

- **Ne**: Next.js 16'da `cacheComponents` ile varsayılan hale geldi. Sayfa statik kabuk olarak
  hemen akmaya başlar, dinamik bölümler aynı yanıt içinde Suspense sınırlarından sonradan gelir.
  Next 16 bunu deneysel bayraktan çıkarıp varsayılan model yaptı ve `experimental_ppr` route-level
  ayarını kaldırdı.
- **Bizde**: Streaming var, fragment'lar var, ama "aynı yanıtta önce cache'li kabuk sonra dinamik
  delik" birleşik modeli yok — cache'li sayfa ya tam cache'li ya dinamik.
- **Değer**: 2.1 ile aynı problemi farklı çözüyor: server island **ikinci istek**, PPR **tek istek
  içinde akış**. PPR'ın avantajı ek RTT olmaması; dezavantajı yanıtın CDN'de tam cache'lenememesi.
  Bizim CDN/Redis merkezli modelimizde **2.1 daha uygun**, PPR ikinci sırada.
- **Maliyet/risk**: React streaming + Suspense sınırlarını cache katmanıyla evlendirmek zor; cache'e
  yazılan şeyin "kabuk kısmı" olduğunu bilmek gerekiyor. Yüksek karmaşıklık.

### 2.3 Resumability (Qwik) **[HAYIR]**

Qwik'in hydration'ı tamamen kaldıran modeli teknik olarak etkileyici ama React ekosistemine
taşınamaz ve bizim island modelimiz (sayfanın %90'ı hiç JS almıyor) pratikte aynı sonucun büyük
kısmını zaten veriyor. Maliyet/fayda tutmuyor.

---

## 3. Cache

### 3.1 İsimli cache profilleri (`cacheLife`) **[P1]** **[YAPILDI — 0.7.31]**

- **Ne**: Next 16'da `cacheLife("hours")` gibi isimli profiller — her profil `stale` / `revalidate` /
  `expire` üçlüsünü taşır. Ham sayı yerine niyet yazılıyor.
- **Bizde**: TTL/SWR her yerde ham saniye. `productConfig`'te `MENU_CACHE_TTL: 14400`,
  `HELLO_BAR_CACHE_TTL: 180`... Sigorta'da bu ondan fazla env değişkenine dağılmış durumda ve
  hangi sayının neden o olduğu ancak yorumdan anlaşılıyor.
- **Değer**: Saf DX + tutarlılık kazancı. "menü `catalog` profilinde" demek, "menü 14400 saniye"
  demekten hem okunur hem denetlenebilir. Profiller tek yerde tanımlanınca politika değişikliği tek
  satır olur; bugün on env değişkeni dolaşmak gerekiyor.
- **Maliyet/risk**: Çok düşük. Mevcut sayıları profillere eşleyen bir tablo + geriye dönük ham sayı
  desteği. Migration'la taşınabilir.

### 3.2 `routeRules` — bildirimsel, tek yerde route politikası **[P2]**

- **Ne**: Nitro'nun `routeRules`'ı glob başına cache, header, redirect, proxy, prerender, ISR/SWR
  kurallarını tek konfigürasyonda topluyor: `"/blog/**": { cache: { maxAge: 3600 } }`,
  `"/api/**": { swr: 3600 }`.
- **Bizde**: Parçalar var ama dağınık — cache politikası `defineRoute` içinde, redirect/rewrite
  `src/routing/rules.ts`'te, header'lar middleware'de. Route manifest'imiz bunları raporluyor ama
  tek kaynak değil.
- **Değer**: Operasyonel netlik. "Bu path'e ne oluyor?" sorusunun tek cevabı olur. Bizim route
  manifest çıktımız zaten bu tabloyu üretmeye çalışıyor — kaynağı da tekleştirmek doğal devam.
- **Maliyet/risk**: Orta. Mevcut iki kaynağı tek modele indirirken geriye uyumluluk gerekiyor.

### 3.3 Storage abstraction (unstorage) **[P2]**

- **Ne**: Nitro'nun `useStorage()` katmanı — dosya sistemi, bellek, Redis, S3, Cloudflare KV/R2,
  Vercel Blob dahil ~20 driver'ın arkasında tek KV arayüzü. Cache de bu katmanın üstünde duruyor.
- **Bizde**: Cache doğrudan Redis + bellek. Uygulamanın "cache olmayan" veri saklama ihtiyacı için
  (rate limit sayaçları, idempotency kayıtları, oturum yan verileri, feature flag snapshot'ı) ortak
  bir soyutlama yok.
- **Değer**: İki ayrı kazanç. (a) Cache dışı KV ihtiyaçları için tek, test edilebilir arayüz.
  (b) Redis'e bağımlılığı bir driver seçimine indirmek — bugün Redis yoksa L1'e düşüyoruz, ama S3
  ya da Postgres backend'i istemek mimari değişiklik gerektiriyor.
- **Maliyet/risk**: `unstorage`'ı doğrudan almak yeni bir bağımlılık ve bizim cache semantiğimiz
  (tag, cold-fill lock, negative cache) onun modelinden zengin. Muhtemelen **kendi ince arayüzümüz**
  daha doğru; unstorage'dan alınacak olan fikir ve driver sınırı, kodu değil.

### 3.4 Draft / preview mode **[P1]** **[YAPILDI — 0.7.29]**

- **Ne**: Next.js Draft Mode, Nuxt/Astro'da preview adapter'ları. İmzalı bir çerezle o oturum için
  cache tamamen bypass edilir ve CMS'in yayınlanmamış içeriği render edilir.
- **Bizde**: **Yok.** (`grep -rIl draft` boş döndü.) Sigorta CMS güdümlü bir site; içerik ekibi
  yayınlamadan önce sayfayı göremiyor demektir.
- **Değer**: CMS'li bir üründe bu neredeyse zorunlu bir özellik. Ve bizde **güvenlik açısından
  hassas**: preview çerezi olan istek paylaşılan cache'e **yazmamalı** ve preview yanıtı
  `private, no-store` olmalı. Bu kuralları framework'ün garanti etmesi lazım, uygulamanın değil —
  yanlış yapılırsa yayınlanmamış içerik herkese servis edilir.
- **Maliyet/risk**: Düşük-orta. `applyCookies`'in "çerez varsa no-store" kuralı ve cache bypass
  altyapımız zaten yarısı. İmzalı token için `secretMatches` hazır.

### 3.5 Build-time prerender (SSG) **[P3]**

- **Ne**: Nitro `prerender`, Astro'nun varsayılan statik çıktısı. Değişmeyen route'lar build'de
  HTML'e dökülür, runtime hiç görmez.
- **Bizde**: Yok — her şey SSR + cache. Pratikte cache ilk isteği ısıttıktan sonra fark küçük.
- **Değer**: Gerçekten statik sayfalar (hakkımızda, KVKK, 404) için runtime bağımlılığını sıfırlar.
- **Maliyet/risk**: Bizim gateway bağımlı içerik modelimizde build-time veri çekmek yeni bir dünya.
  Kazanç, cache zaten çözdüğü için mütevazı. Düşük öncelik.

---

## 4. Tip güvenli sunucu–istemci sözleşmesi

Bu bölüm bence **en yüksek DX getirisi olan blok**, ve Hono seçimimiz sayesinde en ucuz olanı.

### 4.1 Hono RPC — el yazması BFF sözleşmesinin sonu **[P1]** **[YAPILDI — 0.7.28]**

- **Ne**: Hono'nun `hc<AppType>` istemcisi. Sunucudaki route zincirinin tipini export ediyorsun,
  istemci girdileri ve çıktıları tip güvenli görüyor. `zValidator` ile birleşince doğrulama ve tip
  aynı kaynaktan geliyor. `InferRequestType` / `InferResponseType` ile React Query'ye takılıyor.
- **Bizde**: BFF route'ları elle yazılıyor, istemci tarafındaki fetch sarmalayıcıları (sigorta'da
  `mtv-calculation-client.ts`, `newsletter-subscription-client.ts`, `bff-client.ts`) sözleşmeyi
  **elle** tekrarlıyor. Sunucu değişince istemci sessizce bozuluyor.
- **Değer**: Zaten Hono kullanıyoruz — bu bedava duran bir özellik. Sigorta'da BFF endpoint sayısı
  altıyı geçti ve her biri kendi istemci tipini elle taşıyor. Tek doğruluk kaynağı, derleme zamanı
  kırılma.
- **Maliyet/risk**: Düşük. Route'ları zincirleme tanımlamak (`.post().get()`) ve `AppType` export
  etmek gerekiyor; bizim `mountApi` yapımız buna uygun hale getirilebilir. `tsconfig`'de `strict`
  şart, bizde zaten var.

### 4.2 Form actions + progressive enhancement **[P1]** **[YAPILDI — 0.7.41]**

- **Ne**: SvelteKit'in `form` remote fonksiyonu ve Astro Actions. Sunucu fonksiyonu **gerçek bir
  HTML form**'a bağlanıyor: JS yokken normal form POST'u olarak çalışıyor, JS varken araya girip
  sayfayı yenilemeden gönderiyor ve ilgili sorguları otomatik invalidate ediyor.
- **Bizde**: Form gönderimleri island + fetch üzerinden. `e2e/ssr.no-js.spec.ts` gate'imiz var ama
  formlar o gate'in kapsadığı şey değil — JS kapalıyken form çalışmıyor.
- **Değer**: Erişilebilirlik ve dayanıklılık. Sigorta'da MTV hesaplama, bülten aboneliği, teklif
  yönlendirme hep form. Bunların JS'siz çalışması hem a11y hem de "JS yüklenmeden tıklayan kullanıcı"
  senaryosu için gerçek kazanç. Ayrıca bizim `enquiries`/`contact` template route'larımız zaten
  `/contact?status=sent` redirect'i ile POST-redirect-GET yapıyor — yani **desen yarı yarıya
  mevcut**, eksik olan onu birinci sınıf bir primitif haline getirmek.
- **Maliyet/risk**: Düşük-orta. CSRF (same-origin guard'ımız var), idempotency ve hata durumunda
  form state'ini geri taşımak tasarlanmalı.

**Ne yapıldı (0.7.41).** `Route.action`: formun `action`'ı üstünde durduğu sayfa, yani takip edilecek
ikinci bir URL yok. İki çıkış — `redirect(location, 303)` başarı için (PRG), `{ data, status }` red
için. Red sonucu loader'a `ctx.action` olarak ulaşıyor, **boş formu çizen aynı component** formu
hatalarıyla ve ziyaretçinin kendi değerleriyle yeniden çiziyor; 4xx status ile, çünkü sayfa geri
gelse de gönderim başarısız oldu.

Rotanın ayarlamak zorunda olmadığı üç şey: güvenli olmayan metot için cache policy key oluşmadan
düşüyor (yanıtı `private, no-store` yapan da bu — cache'li bir sayfa forma kavuştuğunda unutamaz),
`action` tanımlamayan sayfa 405 dönüyor, cross-origin gönderim 403.

`@originloom/shared/lib/form` gönderimi güvenmeden okuyor: alan sayısı ve uzunluk sınırlı, dosya
parçaları atılıyor, **kırpmıyor reddediyor** — kırpılmış bir değer ziyaretçinin yazmadığı değerdir.

Bu iş sırasında iki gizli bug çıktı: shell'i başlatmak isteği klonluyor ve form gövdesini
tüketiyordu (action artık shell'den önce çalışıyor, ki redirect eden bir gönderim için shell zaten
boşunaydı), ve kullanılmış bir isteği yeniden kurmak error boundary'yi düşürüyordu.

Sigorta'da bülten formu artık JS'siz çalışıyor — önce `disabled` input'lardı, yani JavaScript
kapalıyken blok dekorasyondu. Detay: `docs/migrations/0.7.41.md`.

### 4.3 Astro Actions tarzı şema-önce sunucu fonksiyonu **[P2]**

- **Ne**: Zod ile doğrulanmış girdi + tip güvenli istemci, tek tanımdan.
- **Bizde**: `defineGatewayContract` ile gateway payload'ları için benzer bir şey var (şema + boyut
  sınırı + doğrulama). Aynı disiplin **kendi** BFF girdilerimizde yok.
- **Değer**: 4.1 ile birlikte alınırsa doğal olarak gelir. Ayrı bir iş değil.

### 4.4 Route'lardan OpenAPI üretimi **[P2]**

- **Ne**: `@hono/zod-openapi` route tanımlarından OpenAPI şeması üretiyor.
- **Bizde**: `contracts/openapi.json` **elle yazılmış bir fixture** — gerçek route'lardan
  türetilmiyor, dolayısıyla sessizce eskiyebilir.
- **Değer**: Sözleşmenin koddan türemesi. Gateway kontrat testlerimizin (`contracts:fixtures`)
  değerini artırır.

---

## 5. Güvenlik

### 5.1 Trusted Types **[P1]** **[YAPILDI — 0.7.31]**

- **Ne**: `Content-Security-Policy: require-trusted-types-for 'script'` + `trusted-types` direktifi.
  `innerHTML` gibi DOM XSS sink'leri ham string kabul etmiyor, sadece politika üretimi tiplenmiş
  değer alıyor. **Şubat 2026 itibarıyla Firefox'un da katılmasıyla cross-browser.**
- **Bizde**: CSP güçlü (nonce, `unsafe-inline` yok, cache HIT'te yeniden damgalama) ama Trusted
  Types yok. Ve bizde `dangerouslySetInnerHTML` gerçekten kullanılıyor — GTM bootstrap'ta, JSON-LD
  enjeksiyonunda (bu turda `gtm-bootstrap.tsx`'e eslint-disable koymuştuk).
- **Değer**: CSP script-src'nin kapatamadığı sınıfı kapatıyor: DOM tabanlı XSS. Bizim gibi CMS'ten
  gelen HTML/metin render eden bir üründe bu, artık tarayıcı desteği tamamlandığı için ertelenecek
  bir şey değil. Report-only ile başlanabilir — CSP'de zaten bu modu kullanıyoruz.
- **Maliyet/risk**: Orta. Her sink'in bir politikadan geçmesi gerekiyor; React'in kendi
  `dangerouslySetInnerHTML`'i politika ister. Aşamalı: önce report-only, ihlalleri topla, sonra
  enforce.

### 5.2 Kirletme (taint) — kişisel verinin paylaşılan HTML'e sızmasını runtime'da engelle **[P1]** **[YAPILDI — 0.7.28]**

- **Ne**: React'in `experimental_taintObjectReference` / `taintUniqueValue`'su. Bir nesneyi ya da
  değeri işaretliyorsun; istemciye geçmeye çalışırsa React hata veriyor.
- **Bizde**: "Cache'li HTML paylaşılıdır, kişisel veri island'a gider" kuralımız **konvansiyon ve
  test** ile korunuyor (`tests/tracking-id-leak.test.ts`, `shell-data-cache-safety.test.ts`,
  `ShellData` tipindeki "request-private alanlar RequestOverlay'de olmalı" yorumu). Runtime garantisi
  yok.
- **Değer**: Bu bizim mimarimizin **en yüksek etkili hata sınıfı** — bir kullanıcının verisinin
  başkasına servis edilmesi. Bugün bunu tip sistemi ve testler tutuyor; ikisi de yeni kod yazan
  birinin atlayabileceği şeyler. React'in kendi uyarısı da net: taint tek başına güvenlik değil,
  ek katman. Ama bizde tam olarak o ek katman eksik.
- **Maliyet/risk**: Düşük. Gateway'den gelen profil nesnesini ve token'ları shell/props sınırında
  işaretlemek yeterli. React'in API'si deneysel — kendi eşdeğerimizi yazmak da mümkün, zaten
  `isShellUsableForFragments` gibi sınır kontrollerimiz var.

### 5.3 Subresource Integrity (SRI) **[P2]**

- **Ne**: Üçüncü taraf script'lere `integrity` hash'i.
- **Bizde**: Yok (`grep Subresource` boş). GTM/consent script'lerini CSP ile origin bazında
  yetkilendiriyoruz ama içeriklerini doğrulamıyoruz.
- **Değer**: Tedarik zinciri savunması. GTM gibi sürekli değişen script'lerde SRI pratik değil, ama
  sabit sürümlü vendor script'lerinde uygulanabilir. Kısmi fayda — dürüst olmak gerekirse GTM
  senaryosunda uygulanamaz.

### 5.4 COOP / COEP / Origin-Agent-Cluster **[P2]** **[YAPILDI — 0.7.43]**

- **Ne**: Cross-origin izolasyon başlıkları. `SharedArrayBuffer`/yüksek çözünürlüklü timer erişimi
  ve Spectre sınıfı savunma için.
- **Bizde**: `frame-ancestors`, `X-Frame-Options`, `Permissions-Policy` var; COOP/COEP yok.
- **Değer**: Orta. COOP (`same-origin`) ucuz ve tek başına da değerli (popup tabanlı saldırı
  yüzeyini kapatıyor). COEP pahalı — tüm üçüncü taraf kaynakların CORP başlığı göndermesi gerekir,
  GTM ile çatışır. **Öneri: COOP evet, COEP hayır.**

**Ne yapıldı (0.7.43).** COOP (`same-origin`) ve `Origin-Agent-Cluster: ?1` zaten her yanıttaydı —
ama Hono `secureHeaders` **varsayılanı** olarak. Aynı byte'lar, farklı şey: miras alınan bir
varsayılan, bağımlılık fikrini değiştirdiği gün sessizce değişir ve kimse o değişikliği review
etmez. İkisi de artık `security.ts`'te açıkça yazılı, gerekçeleriyle, ve bir test ikisini de
pinliyor.

Aynı test **COEP'in yokluğunu** da pinliyor. Bu, birinin "seti tamamlamasını" engellemek için:
COEP her üçüncü taraf alt kaynağın CORP göndermesini ister, ve bu sitenin vazgeçemeyeceği üçüncü
taraf GTM. Açmak, burada kimsenin kullanmadığı cross-origin isolation'ı almak için tag manager'ı
kırmak olurdu. COEP kalıcı hayır.

### 5.5 Node permission model **[P3]**

- **Ne**: Node 24'te deneysel olmaktan çıkan `--permission` — dosya sistemi, ağ, env erişimini
  kısıtlıyor.
- **Bizde**: Yok. Container içinde çalışıyoruz, izolasyon oradan geliyor.
- **Değer**: Derinlemesine savunma. SSR sürecinin dosya sistemine yazmaya ihtiyacı yok; bunu runtime
  seviyesinde kapatmak bir RCE'nin etkisini daraltır. Node 24'e yeni geçtiğimiz için artık
  erişilebilir bir seçenek.
- **Maliyet/risk**: Vite dev, kaynak harita okuma, `.nitro`/dist erişimi gibi şeyler izin listesi
  ister. Production-only olarak denenmeli.

### 5.6 Idempotency key'leri **[P2]** **[YAPILDI — 0.7.47]**

- **Ne**: Mutasyon endpoint'lerinde tekrar eden isteğin ikinci kez etki etmemesi.
- **Bizde**: Yok. Bülten aboneliği, teklif yönlendirme gibi POST'lar çift tıklamada/retry'da iki kez
  işlenebilir.
- **Değer**: Form actions (4.2) ile birlikte doğal — progressive enhancement'ın olduğu yerde retry
  daha sık. Storage katmanı (3.3) varsa ucuz.

**Ne yapıldı (0.7.46).** `runOnce({ namespace, key, work, serialize, parse })`.

PRG'nin kapatmadığı gönderimler için. Yenilemede tekrar POST'u PRG zaten kapatıyor; **görmediği**
gönderimler var: sabırsız ikinci tık, bağlantı koptuktan sonraki retry, isteği kaybolmuş sanıp
tekrarlayan proxy. Üçü de ayrı POST olarak geliyor ve iki gerçek gönderimden ayıran tek şey
istemcinin seçtiği anahtar.

**Anahtar formun kendisinde.** `IDEMPOTENCY_FIELD` render başına basılan gizli bir input. JS'siz
çalışmasının sebebi bu: tarayıcı sayfanın verdiğini geri gönderiyor, yani **aynı render'ın** çift
tıklaması ve retry'ı aynı anahtarı taşıyor, yeni bir render taşımıyor.

**İki kayıt, bir tane değil.** Kilit "şu an biri yapıyor", değer "biri yaptı, sonucu bu" diyor. Tek
bir bayrak bunları ayıramaz ve in-flight'ı tamamlanmış saymak henüz var olmayan bir sonucu
tekrarlamak olurdu. `IdempotentRun` birleşiminde `in-flight`'ın **`value`'su yok** — çağıran
çarpışmanın ne demek olduğuna karar etmek zorunda.

**Sessiz yalan yok.** Ephemeral store olmayan bir topolojide `writeCoordinationValue` hiçbir şey
yapmıyor. Bu durumda `runOnce` `unavailable` döndürüyor — kaydı geri okuyarak doğruladıktan sonra.
Hiçbir şey yapmadığı halde koruma sağlıyormuş gibi davranan bir guard, guard'sızlıktan kötüdür;
`ssr_idempotent_runs_total{outcome="unavailable"}` alarm kurulacak seri.

**Anahtar bir cache slot'u, gövdeye gömülü bir değer değil — ve bunu bir test yakaladı.** İlk
uygulamada anahtar shell'e render başına basılıyordu. Ana sayfa paylaşımlı cache'li olduğu için tek
bir cache gövdesinden servis edilen iki ziyaretçi **aynı anahtarı** alacaktı: ikincisinin aboneliği
birincisininki olarak replay edilecekti. Guard'ın kendisi bug'a dönüşüyordu. Sigorta'nın shell
determinism testi bunu yakaladı.

Doğrusu: `submissionKey`, `cspNonce` ve `pageRequestId` ile aynı mekanizmada bir **dynamic slot**.
Cache'e placeholder giriyor, her yanıta taze değer materialize ediliyor.

`pageRequestId`'yi anahtar olarak kullanmak cazipti ve yanlış olurdu: istemci `x-request-id`
gönderebiliyor, ve istemcinin seçebildiği bir anahtar **başkası adına** seçebildiği bir anahtardır.
Slot bu yüzden platform tarafından üretiliyor ve istekten hiç okunmuyor — registry'nin "her yeni
slot açık bir güvenlik incelemesi ister" notunun karşılığı bu.

**Başarısızlık kaydedilmiyor.** `serialize` null döndürebiliyor: reddedilen bir gönderim ya da
gateway kesintisi tekrarlanabilir olmamalı, ziyaretçi düzeltip aynı formu yeniden gönderebilmeli.

---

## 6. Web platformu — sayfa geçişi ve algılanan hız

### 6.1 Speculation Rules API **[HAYIR]**

- **Ne**: `<script type="speculationrules">` ile tarayıcıya "bu linkleri prefetch/prerender et"
  demek. Document rules + `eagerness` ile "kullanıcı üzerine gelince prerender" gibi politikalar.
  Chrome/Edge 121+ sağlam; **Firefox desteklemiyor, Safari varsayılan kapalı.**
- **Bizde**: Yok. `Link` bileşenimiz ve navigation-paint çalışmamız var ama spekülasyon yok.
- **Değer**: Bizim mimarimizde **olağandışı derecede uygun**. Prerender'ın en büyük riski sunucuya
  gereksiz yük ve yan etkili GET'ler; bizde sayfalar zaten paylaşılan cache'ten geliyor, yani
  prerender edilen istek çoğunlukla cache HIT. Yani maliyeti düşük, kazancı (anında navigasyon)
  yüksek. Ayrıca `Vary`/cookie kurallarımız net olduğu için prerender edilen yanıtın kişisel
  olmadığından eminiz.
- **Maliyet/risk**: Düşük **değil** — ilk yazımdaki değerlendirme iki noktada yanlıştı, sigorta'nın
  koduna bakınca düzeldi. Aşağıya bak.

**Karar: yapılmayacak.** Sebebi ölçüm doğruluğu değil — o çözülebilir. Kazanç bu uygulamada
yerinde değil, ve onu yerine getirecek olan (S7) da bilinçli olarak ertelenmiş durumda.

**Ölçüm doğruluğu çözülebilir, hem de deterministik olarak.** Analitik ekibinin endişesi
("prefetch ettiğimiz sayfaları da sayıyoruz") gerçek ama tahmine dayalı bir çözüm gerektirmiyor:

- **Prefetch zaten sorun değil.** Prefetch JavaScript çalıştırmaz; page view diye bir şey olmaz.
  Sorun yalnızca **prerender**'da.
- **Sunucu tarafı deterministik**: Chrome spekülatif isteğe `Sec-Purpose: prefetch;prerender`
  header'ı koyuyor. Sezgi değil, header. Sigorta'da sayan üç yer var ve üçü de bu header'la
  susturulabilir: `session-start` (tracking id **basıyor** ve `newFeature` A/B kovasını atıyor —
  page view'dan daha kötüsü, atılmış bir prerender geride kova ataması bırakır), `storeBotVisit`,
  ve `logRequest`.
- **İstemci tarafı deterministik**: prerender sırasında `document.prerendering === true`, aktivasyonda
  `prerenderingchange` ateşleniyor.

**Asıl iş GTM konteynerinde.** `server/product/analytics.ts` zincirinin 7 adımı prerender edilen
belgede hemen çalışır; konteyner yüklendiği anda kendi `gtm.js`/`gtm.dom`/`gtm.load` tetikleyicilerini
ve onlara bağlı Page View tag'ini ateşler. Çözüm konteyneri prerender sırasında **hiç yüklememek**:
adım 1 (`dataLayer` init) çalışsın, 2–7 aktivasyona kadar beklesin. Zincir zaten `sequencedScript`
ile sıralı ve bir hazır bayrağı/olayı var — dikiş yerinde, önüne bir kapı eklemek küçük bir değişiklik.

Bunun bedeli dürüstçe söylenmeli: **prerender boyamayı anlık yapar, analytics'i bedava yapmaz.**
Zincir aktivasyonda başlar, yani bugünkü maliyetiyle aynı yerde durur.

**Kazancın yerinde olmaması, erteleme sebebi.** İlk değerlendirme "sayfalarımız paylaşılan cache'ten
geliyor, prerender ucuz" diyordu. Sigorta'da bu **bugün doğru değil**: paylaşımlı cache'li tek sayfa
`/` ve o da genelde giriş sayfası — kimse üstünde durduğu sayfayı prerender etmez. Prerender edilecek
hedefler `/kasko`, `/zorunlu-trafik-sigortasi`, `/motorlu-tasitlar-vergisi`; üçü de `neverCache`.
Yani atılan her prerender **tam SSR + dört gateway çağrısı**. Ucuz olan senaryo tam olarak
gerçekleşmeyen senaryo.

**Karar.** 6.1 kapalı. Bir gün açılacaksa sırası şudur ve tersi çalışmaz: önce S7 (hangi sayfaların
paylaşımlı cache'e alınacağı, ölçümle), sonra analitik kapısı (`Sec-Purpose` + `document.prerendering`,
testleriyle), en son speculation rules. Analitik kapısı S7'den bağımsız olarak da yazılabilir ve
prerender'dan bağımsız bir değeri vardır — ama tek başına bir kazanç değil, bir ön koşuldur, ve
bugün ödenecek bir fatura yok.

Yukarıdaki tespit silinmedi: bu madde tekrar açılırsa dört sayan yüzey ve neden ikisinin header,
ikisinin tarayıcı API'si ile kapatıldığı burada yazılı duruyor.

### 6.2 Early Hints (HTTP 103) **[P2]**

- **Ne**: Sunucu asıl yanıtı hazırlarken 103 ile kritik kaynakları önceden bildiriyor.
- **Bizde**: Yok. Cache MISS'te gateway beklerken geçen süre tam olarak 103'ün doldurduğu boşluk.
- **Değer**: Cache MISS ve cold-fill senaryolarında gerçek TTFB→LCP kazancı. Cache HIT'te zaten
  hızlıyız, yani kazanç dar bir dilimde — ama o dilim (cold path) bizim en yavaş yolumuz.
- **Maliyet/risk**: Hono + Node HTTP/1.1 üzerinde 103 göndermek doğrudan desteklenmiyor; ters proxy
  (nginx/CDN) katmanı gerekebilir. Altyapıya bağımlı.

### 6.3 View Transitions (cross-document) **[P2]** **[YAPILDI — 0.7.43]**

- **Ne**: `@view-transition { navigation: auto }` ile MPA'da sayfalar arası yumuşak geçiş.
- **Bizde**: `0.7.15-navigation-paint` migration'ında bu CSS zaten enjekte ediliyor — yani
  **temel hali var**. Eksik olan isimlendirilmiş geçişler (`view-transition-name`) ile öğe
  morph'lama.
- **Değer**: Speculation Rules ile birleştiğinde etkileyici: hedef sayfa zaten prerender edilmişse
  geçiş animasyonu ilk kareden itibaren akıcı çalışıyor. İkisi birlikte alınmalı.

**Ne yapıldı (0.7.43).** İki eksik de kapandı.

**İsimli geçişler.** Chrome bir öğeyi belgeler arasında ancak iki tarafta da aynı adı taşıyorsa
morph eder. Kabuk zaten değişmeyen kısımdır: `data-view-transition="header" | "footer" | "main"`
taşıyan öğeler critical paint CSS'inde bir ada bağlanıyor, böylece navigasyon "site değişti" değil
"sayfa değişti" gibi okunuyor. Ad belge başına tekil olmak zorunda — iki öğe aynı adı taşırsa
tarayıcı geçişin tamamını atlar, yani bugünkü davranışa düşer, kırılmaz. Bu yüzden rol başına tek
değer.

**Reduced-motion.** Root cross-fade bu koruma olmadan çıkmıştı, yani "reduce" diyen kullanıcı da
animasyon alıyordu. Animasyonsuz bir view transition anlık bir takastır — tercihin istediği şey tam
olarak budur.

### 6.4 bfcache uyumluluğu **[P2]** **[ÖLÇÜLDÜ — 0.7.45]**

- **Ne**: Geri/ileri navigasyonunda sayfanın tamamen canlı olarak geri gelmesi.
- **Bizde**: Açıkça test edilmiyor. `unload` dinleyicisi, açık WebSocket/EventSource ve
  `Cache-Control: no-store` bfcache'i bozar — ve bizde **üçü de var**: market-live island'ı
  EventSource açıyor, çerez taşıyan yanıtlar `no-store` alıyor.
- **Değer**: Geri tuşu, gerçek trafikte navigasyonun büyük dilimi. Bunu ölçmüyoruz bile.
  Chrome'un bfcache blocklist raporlaması ile ölçmek ilk adım — muhtemelen bugün çoğu sayfada
  bfcache devre dışı ve bundan haberimiz yok.
- **Maliyet/risk**: Ölçmek ucuz; düzeltmek `no-store` politikamızla çatışabilir (kişiselleştirme
  gereği). Önce ölç.

**Ölçüldü (0.7.44) — ve korku büyük ölçüde yersizmiş.**

Yukarıdaki "muhtemelen bugün çoğu sayfada bfcache devre dışı" tahmini sigorta için **yanlış**.
`tests/bfcache-eligibility.test.ts` üç durumu sabitliyor:

| Durum                           | `Set-Cookie` | `Cache-Control`                | bfcache            |
| ------------------------------- | ------------ | ------------------------------ | ------------------ |
| İlk ziyaret (session basılıyor) | var          | `private, no-store`            | hayır              |
| Sonraki her ziyaret             | yok          | `private, no-cache, max-age=0` | **evet**           |
| Form gönderimi (POST)           | —            | `private, no-store`            | hayır (doğrusu bu) |

`applyCookies` yalnızca gerçekten `Set-Cookie` taşıyan yanıtı düşürüyor, ve session cookie'leri bir
kez basılıyor. Yani maliyet ilk ziyarette bir kez ödeniyor, sonra geri tuşu çalışıyor.

**İlginç kısım:** bu durum bir yan etki. `session-start.ts`'teki `isBot` bayrağı bir zamanlar her
istekte yeniden türetiliyordu — yani her yanıtta bir `Set-Cookie`, yani her yanıtta `no-store`, yani
**site genelinde bfcache kapalı**. O hata HTTP cache gerekçesiyle düzeltilmişti; bfcache'i de
düzelttiğini kimse bilmiyordu. Ölçmenin değeri buydu: düzeltilecek bir şey değil, doğrulanacak bir
şey bulduk — ve artık bir test onu geri gitmekten koruyor.

**Gerçek blocker'lar nerede:** hiçbir yerde `unload` dinleyicisi yok — bfcache'i kesin kapatan tek
şey odur ve bizde yok. Sigorta'da ayrıca WebSocket ve EventSource da yok.

Showroom'un `market-live` island'ı EventSource açıyor, ama **kapatıyor da**: `visibilitychange` →
`hidden` geldiğinde bağlantıyı kapatıyor, ve o olay sayfa donduruImadan **önce** ateşleniyor. Yani
tarayıcı uygunluğa bakarken ortada açık bağlantı kalmıyor; sayfa geri geldiğinde de aynı dinleyici
yeniden bağlanıyor. Standart mitigasyon zaten uygulanmış durumda.

Geriye kalan tek dürüst cevap: **bilmiyoruz, artık ölçüyoruz.** "EventSource var, demek ki kapalı"
bir varsayımdır ve bu maddenin tamamı böyle varsayımların yanlış çıkmasıyla ilgili.
`notRestoredReasons` bunu söyleyecek olan şey.

**Aracın kendisi de test edildi (0.7.45).** Bir ölçüm maddesinde en kötü boşluk, ölçen şeyin
denenmemiş olmasıdır: sessizce yanlış bir neden, olmayan bir blocker'ı aramaya gönderen bir metrik
etiketine dönüşür. `packages/origin-shared/tests/back-forward-cache.test.ts` frame ağacının
düzleştirilmesini, tekrar edenlerin atılmasını, sekiz nedenlik sınırı, kullanılabilir neden
taşımayan girdilerin atlanmasını, sıradan bir yüklemenin (o da `pageshow` ateşler) rapor
üretmemesini ve navigasyon bitmeden okumamayı kapsıyor.

Test bir kusur da buldu: fonksiyon iki kez çağrılırsa iki `pageshow` dinleyicisi kuruyor ve bir
restore'u iki kez sayıyordu. Artık ikinci çağrı hiçbir şey yapmıyor — çift sayan bir sayaç, olmayan
bir sayaçtan kötüdür.

**Ölçüm aracı kalıcı.** `reportBackForwardCache()` tarayıcının kendi iki sinyalini okuyor:
`pageshow.persisted` sayfanın canlı geri geldiğini, Chrome'un `notRestoredReasons`'ı gelemediyse
nedenini söylüyor. Sonuç `ssr_client_bfcache_total{outcome,reason}` sayacına düşüyor. Reason
vocabulary tarayıcının ve sürümler arası büyüyor, o yüzden island isimleriyle aynı şekilde
sınırlandı: tanınmayan bir neden sonsuza kadar yeni bir seri açmak yerine `other`'a düşüyor.

---

## 7. Geliştirici deneyimi

### 7.1 DevTools paneli **[P1]** **[YAPILDI — 0.7.31]**

- **Ne**: Nuxt DevTools — tarayıcı içinde route'lar, bileşen ağacı, sunucu route'ları, payload,
  timeline, açık modüller.
- **Bizde**: `origin-doctor`, route manifest ve (bu turda eklenen) `SSR_DIAGNOSTICS` var — hepsi
  terminal tarafında.
- **Değer**: Bizim mimarimizde görünmez olan şeyler tam olarak bir panele muhtaç: bu sayfa cache
  HIT mi MISS mi, hangi cache key, hangi fragment nereden geldi, hangi island hydrate oldu, hangi
  gateway çağrıları yapıldı ve ne kadar sürdü. Bu bilgilerin **hepsi zaten üretiliyor** —
  `x-cache` başlığı, cache key codec, diagnostics kayıtları, island runtime. Eksik olan sunum.
  Bu yüzden görece ucuz ve etkisi büyük.
- **Maliyet/risk**: Düşük-orta. Dev-only, production bundle'a sıfır etki (ayrı entry).

### 7.2 Layers / extends **[P2]**

- **Ne**: Nuxt'ın layer'ları — bir uygulama başka bir uygulamayı miras alıyor: bileşenler,
  composable'lar, sunucu route'ları, konfigürasyon. Çok markalı/çok siteli kurulumların ve DDD tarzı
  modüler monolitin temeli. `~~/layers` altındakiler otomatik kaydediliyor.
- **Bizde**: `create-app` plugin'leri var ama bunlar **üretim zamanı** (scaffold) — üretilen kod
  kopyalanıyor, sonra ıraksıyor. Çalışma zamanı katmanlama yok.
- **Değer**: "Baz projelerimden biri" dediğin senaryonun tam karşılığı. Bugün sigorta ile bir
  sonraki ürün arasındaki ortaklık kopyala-yapıştır ile taşınıyor; bu turda template ile sigorta
  arasında gördüğümüz ıraksama (eski shell contract'ı, düşmüş lint kuralları) tam olarak bunun
  semptomu.
- **Maliyet/risk**: Yüksek. Çözünürlük sırası, tip birleştirme, override semantiği zor problemler.
  Ama bu ıraksama sorununu başka türlü çözmek de zor.

### 7.3 Tip güvenli env şeması (`astro:env`) **[P1]** **[YAPILDI — 0.7.31]**

- **Ne**: Astro'nun `astro:env`'i — her env değişkeni şema seviyesinde tanımlı, tipli, doğrulanmış
  ve **public/secret ayrımı** açık. Secret'ın istemci bundle'ına sızması derleme hatası.
- **Bizde**: `config-validation.ts` startup'ta doğruluyor (ve iyi yapıyor — production'da eksik
  `GATEWAY_URL`/`RELEASE_ID`/auth secret ile açılmayı reddediyor, bunu bu turda doğruladım). Ama
  şema tipli değil ve public/secret ayrımı konvansiyon.
- **Değer**: Doğrulama zaten var, eksik olan **tip ve sınır**. `import.meta.env` üzerinden bir
  secret'ın istemciye sızması bugün bizde sadece dikkatle engelleniyor.
- **Maliyet/risk**: Düşük. Mevcut `validateConfig` altyapısının üstüne şema.

### 7.4 `instrumentation.register` / `onRequestError` **[P2]** **[YAPILDI — 0.7.43]**

- **Ne**: Next'in tek dosyalık gözlemlenebilirlik giriş noktası: `register()` sunucu ayağa kalkarken
  bir kez, `onRequestError()` server component/route handler/action'daki yakalanmamış hatalar için.
- **Bizde**: OTel başlatma `server/index.ts`'te, hata yolları dağınık, `metricSources` runtime
  sözleşmesinde. Uygulamanın "her hatayı Sentry'ye bağla" için tek kancası yok.
- **Değer**: Orta. Bizde zaten yapılandırılmış log ve OTel var; bu daha çok düzen kazancı.

---

**Ne yapıldı (0.7.43).** `OriginRuntime.onRequestError` kancası: her beklenmedik sunucu hatası, bir
kez, ziyaretçiye gösterilen referansla birlikte. Uygulama Sentry'yi buraya bağlar — her giriş
noktasını sarmalamak yerine bir kez.

Öncesinde raporlama, her catch bloğunun ne çağırdıysa oydu: beş `logError` çağrısı, beş farklı alan
kümesi, ve platformu yamamadan bir reporter takılacak yer yok. Beşi de tek bir `reportRequestError`
çağrısına birleşti.

**Log satırları bilerek aynı kaldı.** `msg` rapor tipinde bir alan, `phase`'ten türetilmiyor —
çünkü "route execution failed" gibi etiketlerin okuyucusu var ve bir faz adı o sorguları sessizce
eşleşmez hale getirirdi. (Bunu ilk denemede kaybettim; testleri kırdığı için yakalandı.)

Kanca senkron çağrılıyor ve hatası yutuluyor: zaten başarısız olan bir yolda çalışıyor, ve fırlatan
bir reporter render edilmiş bir hata sayfasını hiç sayfa olmayana çeviremez. Fırlatırsa kendi
başarısızlığı olarak bir kez loglanıyor — özyinelemeyi önlemek için bu fonksiyona geri girmeden.

## 8. Production olgunluğu

### 8.1 `after()` / `waitUntil` — yanıttan sonra iş **[P1]** **[YAPILDI — 0.7.28]**

- **Ne**: Next'in `after()`'ı, edge runtime'ların `waitUntil`'i. Yanıt gönderildikten sonra çalışacak
  işi kaydediyorsun; runtime süreci o iş bitene kadar kapatmıyor.
- **Bizde**: **Yok, ve bu bir hata kaynağı.** Sigorta'nın `session-start` middleware'i bot ziyaretini
  `void postStoreBot(...)` ile "detached" çağırıyor — yorumunda gerekçesi de yazıyor (bot trafiği
  için gateway RTT'sini yanıtın önüne koymamak). Ama `void` ile bırakılan iş, graceful shutdown
  sırasında **sessizce kaybolur** ve hatası hiçbir yere gitmez.
- **Değer**: Bizde zaten graceful shutdown, drain ve bot analytics kuyruğu var — `after()` bunları
  tek primitifte birleştirir ve "unutulmuş `void` promise" desenini ortadan kaldırır. Yüksek değer,
  düşük maliyet.
- **Maliyet/risk**: Düşük. `AsyncLocalStorage` ile istek bağlamı zaten var (`activeRequestId` bu
  turda kullanıldı), shutdown drain altyapısı var.

### 8.2 Deployment preset'leri / adapter'lar **[P3]**

- **Ne**: Nitro preset'leri ve Astro adapter'ları — aynı uygulama Node, Cloudflare Worker, Vercel,
  Netlify veya statik dizin olarak çıkabiliyor. Nitro'nun çıktısı `node_modules`'suz tek dizin.
- **Bizde**: Node + Docker, tek hedef.
- **Değer**: Portabilite şu an bizim problemimiz değil (kendi altyapımıza deploy ediyoruz). Ama
  Nitro'nun **bağımlılıksız tek dizin çıktısı** fikri bağımsız olarak değerli: production imajında
  `node_modules` olmaması hem imaj boyutu hem saldırı yüzeyi kazancı. Bizim `origin-build` zaten
  self-contained SSR bundle üretiyor — yani yarısı var.
- **Maliyet/risk**: Preset sistemi yüksek maliyet, düşük getiri. **Sadece "bağımlılıksız çıktı"
  kısmını al.**

### 8.3 Zamanlanmış görevler (Nitro tasks) **[P3]**

- **Ne**: Nitro'nun in-process scheduled task'ları (Worker'da platform cron'a devrediyor).
- **Bizde**: Yok; cache warming/revalidation kendi mekanizmamızda.
- **Değer**: Düşük — Kubernetes CronJob bunu zaten çözüyor.

---

## 9. JS / runtime katmanı

### 9.1 Explicit Resource Management (`using` / `await using`) **[P1]** **[YAPILDI — 0.7.41]**

- **Ne**: TC39 önerisi, Node 24'te destekli. Blok bitince kaynağı otomatik serbest bırakıyor.
- **Bizde**: Elle serbest bırakılan kaynaklar var ve bu turda **tam bu sınıfta bir sorun gördük**:
  `releaseGatewayResponse` her çağrı yolunda elle çağrılmak zorunda; unutulursa undici bağlantısı
  havuza dönmüyor. Cache cold-fill lock'ları, OTel span'leri de aynı desende.
- **Değer**: Node 24'e yeni geçtik, yani artık kullanılabilir. `await using response = ...` deseni
  "gateway yanıtını serbest bırakmayı unutma" hata sınıfını dilin kendisine devrediyor.
- **Maliyet/risk**: Düşük. TypeScript 5.2+ destekliyor (bizde 5.9), Node 24 destekliyor. Kademeli
  benimsenebilir.

**Ne yapıldı (0.7.41).** `gatewayFetch` ve iki kimlik sarmalayıcısı artık `GatewayResponse`
döndürüyor — kendini bırakan bir `Response`. Bloktan çıkan hiçbir dal temizliği atlayamıyor. Dispose
idempotent, yani mevcut `try`/`finally` çağrıları aynen çalışıyor ve geçiş dosya dosya yapılabiliyor.

**Şüphe doğrulandı.** Sigorta'da yedi servis dosyası yanıtı **hiç bırakmıyordu** (kasko, zorunlu
trafik, MTV ve ana sayfa page-data'ları, recourse forward-page, menu, sitemap); iki yerde de release
await edilmemiş floating promise'ti. Yani bu bir teori değil, ölçülmüş bir sızıntı sınıfıydı.

`asGatewayResponse` test double'ları için export edildi: çıplak bir `Response` döndüren sahte
gateway'de dispose edilecek bir şey yok ve hata servisin hata yoluna düşüyor, double'a değil.
`0.7.34-disposable-gateway-response` migration'ı tsconfig `lib` listesine `ESNext.Disposable`
ekliyor ve uygulamanın kendi gateway adapter'ının tipi silmesini engelliyor.

### 9.2 `AsyncContextFrame` — AsyncLocalStorage'ın ucuzlaması **[P1, bedava]** **[ÖLÇÜLDÜ — 0.7.43]**

- **Ne**: Node 24'te `AsyncLocalStorage` varsayılan olarak `AsyncContextFrame` kullanıyor; artık her
  async işlem için async_hooks altyapısına dayanmıyor.
- **Bizde**: İstek bağlamı, request id, memoization ve (bu turda ekli) diagnostics hep ALS üzerinde.
  Yani bu iyileştirme **Node 24 geçişiyle birlikte zaten kazanıldı** — ölçmeye değer.
- **Değer**: Ölçüm dışında iş yok. Kapasite testlerimizi Node 22 vs 24 karşılaştırmasıyla bir kez
  koşup baseline'ı güncellemek yeterli.

**Ölçüldü (0.7.43).** `scripts/als-benchmark.mjs`, iki runtime'da da koşturulup karşılaştırılır.
Kasıtlı olarak mikrobenchmark: kapasite koşusu "saniyede kaç istek" sorusunu cevaplar ve o gateway'e,
cache topolojisine ve makineye bağlıdır; buradaki soru bir store yazımının ve bir store okumasının
maliyeti — ki Node sürümünün tek başına değiştirebileceği kısım da bu.

| İşlem                    | Node 22.22 | Node 24.19 |     Fark |
| ------------------------ | ---------: | ---------: | -------: |
| `run` + `get` (düz)      |     349 ns |     310 ns |     −11% |
| `run` + 10 await + `get` |    1554 ns |     701 ns | **2.2×** |
| `get`, store yok         |     134 ns |      48 ns | **2.8×** |

Kazanç tam olarak bizim kodumuzun durduğu yerde: düz çağrıda kayda değer bir şey yok, ama bir SSR
render'ı derin bir await zinciridir ve `memoizeRequestValue` / `activeRequestId` / `after()` aynı
store'u tekrar tekrar okur. § 9.2'nin "zaten kazanıldı" iddiası doğruymuş — ve artık sayısı var.

### 9.3 WinterTC / Minimum Common API **[P2]**

- **Ne**: WinterCG artık Ecma TC55 (WinterTC). Minimum Common Web API'nin ilk baskısı **Aralık
  2025'te Genel Kurul tarafından kabul edildi** — sunucu runtime'larının uygulaması beklenen web
  API alt kümesi.
- **Bizde**: Hono seçimimiz zaten Web Standards üzerine kurulu (Request/Response/Headers/URL). Yani
  farkında olmadan bu standarda yakınız.
- **Değer**: Bir **kısıt** olarak değerli, özellik olarak değil: "platform kodu yalnız Minimum Common
  API + açıkça izin verilen Node API'leri kullanır" kuralı, ileride edge/worker'a taşınabilirliği
  bedavaya yakın tutar. Bunu bir lint kuralı olarak zorlamak mümkün — bu turda
  `no-direct-gateway-import` ile aynı desen.
- **Maliyet/risk**: Düşük. Kural olarak başlar, ihlalleri raporlar.

### 9.4 `node:sqlite` — yerleşik gömülü veritabanı **[P3]**

- **Ne**: Node 24'te yerleşik SQLite.
- **Değer**: Bizim için doğrudan kullanım yok, ama **L1 cache'in disk destekli varyantı** ya da dev
  ortamında Redis'siz L2 taklidi için ilginç. Şu an Redis yokken L1-only'ye düşüyoruz; sqlite
  destekli bir ara katman dev/tek-pod senaryosunda anlamlı olabilir.

---

## 10. Build ve dev sunucusu

### 10.1 Vite Environment API **[P2]**

- **Ne**: Vite 6+ ile gelen, Vite 7'de olgunlaşan model: client/ssr/worker gibi birden fazla
  "environment"ı birinci sınıf tanımlıyorsun, her birinin kendi modül grafiği ve runner'ı var.
  Astro 6 bunun üstüne **workerd dev sunucusu** koyup dev/prod paritesi sağladı.
- **Bizde**: Klasik client + ssr ikilisi, `vite.config.ts` + `vite.server.config.ts` olarak ayrı.
- **Değer**: Orta vadeli sağlamlık. Bugün dev'de Node, prod'da Node çalıştığımız için parite sorunu
  yaşamıyoruz — yani acil değil. Ama Vite'ın gideceği yön bu ve `@originloom/shared/vite` preset'imiz
  er geç uyum sağlamalı.
- **Maliyet/risk**: Orta, ve büyük kısmı Vite'ın kendi geçiş takvimine bağlı. **İzle, şimdi taşıma.**

### 10.2 Rolldown **[P3]**

- **Ne**: Rust tabanlı bundler, `rolldown-vite` ile drop-in denenebiliyor, ileride Vite'ın varsayılanı
  olacak.
- **Değer**: Build süresi. Bizim build zaten dakikalar değil saniyeler mertebesinde, yani acil değil.
  Varsayılan olduğunda gelir.

---

## 11. Öncelik özeti

Değer/maliyet oranına göre, mimarimize uygunluk sırasıyla:

### İlk dalga — yüksek değer, düşük/orta maliyet

İlk dalganın tamamı yapıldı. Ayrıntı ilgili maddenin başlığındaki **[YAPILDI]** notunda ve
`docs/migrations/` altında. Çalışan örnekler showroom'da: `/server-island`, `/preview-demo`,
`/bulten` (form action). Bu tabloda başlangıçta 6.1 de vardı; § 6.1'deki gerekçeyle
**Kasıtlı hayır**'a taşındı.

| #      | Madde                        | Neden ilk                                                                   |
| ------ | ---------------------------- | --------------------------------------------------------------------------- |
| 4.1 ✅ | Hono RPC ile tip güvenli BFF | Hono'yu zaten kullanıyoruz; bedava duran özellik                            |
| 8.1 ✅ | `after()` / `waitUntil`      | Mevcut `void promise` deseni sessiz veri kaybı üretiyor                     |
| 5.2 ✅ | Taint / sızma koruması       | Mimarimizin en yüksek etkili hata sınıfı, bugün sadece test koruyor         |
| 3.4 ✅ | Draft / preview mode         | CMS güdümlü üründe eksik; yanlış yapılırsa güvenlik sorunu                  |
| 2.1 ✅ | Server Islands               | "Kişisel içerik JS'e bağımlı" kısıtını kaldırır                             |
| 5.1 ✅ | Trusted Types                | 2026'da cross-browser oldu; DOM XSS'i CSP'nin kapatamadığı yerden kapatıyor |
| 7.1 ✅ | DevTools paneli              | Veri zaten üretiliyor, sadece sunum eksik                                   |
| 7.3 ✅ | Tip güvenli env şeması       | Doğrulama var, tip ve public/secret sınırı yok                              |
| 3.1 ✅ | İsimli cache profilleri      | Ham TTL sayıları okunabilirliği ve denetimi zorlaştırıyor                   |
| 9.1 ✅ | `using` ile kaynak yönetimi  | `releaseGatewayResponse` unutma sınıfını dile devreder                      |
| 4.2 ✅ | Form actions                 | JS'siz form; a11y ve dayanıklılık                                           |

### İkinci dalga

İlk dalga bittiği için sıradaki dalga bu. Birkaçının bir kısmı, başka bir işin yan ürünü olarak
zaten gelmiş — o yüzden burası da artık düz bir liste değil, durum taşıyan bir tablo.

`◐` = bir kısmı var, eksik olan yazıyor. `—` = hiç yok.

| #      | Madde                       | Durum | Bugünkü durum ve eksik olan                                                                                       |
| ------ | --------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| 9.2 ✅ | `AsyncContextFrame`         | ✅    | Ölçüldü — derin await zincirinde **2.4×**, çıplak store okumasında **2.8×**; § 9.2'de tablo                       |
| 5.4 ✅ | COOP / Origin-Agent-Cluster | ✅    | Miras değil, yazılı karar; test ikisini de ve COEP'in yokluğunu da pinliyor. COEP kalıcı hayır                    |
| 6.3 ✅ | View Transitions            | ✅    | İsimli geçişler (`data-view-transition`: header/footer/main) ve reduced-motion boşluğu kapandı                    |
| 7.4 ✅ | instrumentation kancaları   | ✅    | `onRequestError` runtime kancası; beş dağınık `logError` tek rapora birleşti, log satırları aynen                 |
| 6.4 ✅ | bfcache ölçümü              | ✅    | Ölçüldü: ilk ziyaret hariç her sayfa restorable. `ssr_client_bfcache_total` kalıcı ölçüm; test regresyonu tutuyor |
| 5.6 ✅ | Idempotency key'leri        | ✅    | `runOnce` + formun taşıdığı anahtar; JS'siz çalışıyor, store yoksa sessizce değil `unavailable` diyor             |
| 6.2    | Early Hints (103)           | —     | Kazanç cache MISS/cold-fill diliminde. Sigorta'da üç sayfa `neverCache` olduğu için o dilim sanıldığından geniş   |
| 3.2    | `routeRules`                | —     | Route politikası bugün `cache-keys.ts` registry'si + route dosyaları arasında bölünmüş                            |
| 3.3    | Storage soyutlaması         | —     | L1/L2 cache var ama unstorage benzeri bir sürücü arayüzü yok                                                      |
| 4.4    | OpenAPI üretimi             | —     | `contracts/openapi.json` hâlâ elle yazılmış fixture; route'lardan türemiyor, sessizce eskiyebilir                 |
| 7.2    | Layers / extends            | —     | Tek ürün olduğu sürece fatura ödenmiyor; ikinci ürün geldiği gün ilk sıraya çıkar                                 |
| 9.3    | WinterTC kısıtı             | —     | Bugün Node'a bağlıyız ve tek deploy hedefimiz var                                                                 |
| 10.1   | Vite Environment API        | —     | Client/SSR yapılandırması bugün elle ayrılmış; API bunu tek yerde toplardı                                        |

### Üçüncü dalga — fikir olarak dursun

Bugün yapılmayacak, ama "hayır" da değil: koşullar değişirse yeniden bakılır. Her satırdaki koşul,
o maddeyi tekrar gündeme getirecek olan şey.

| #    | Madde                  | Durum | Hangi koşulda geri gelir                                                                                                                                                           |
| ---- | ---------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.2  | Partial Prerendering   | —     | Server islands (2.1) faydanın büyük kısmını verdi. React'in PPR'ı stabil bir API haline gelirse yeniden bakılır                                                                    |
| 3.5  | Build-time prerender   | —     | İçeriğimiz CMS güdümlü ve saatlik değişiyor; gerçekten statik bir bölüm (blog arşivi gibi) çıkarsa anlamlı olur                                                                    |
| 5.5  | Node permission model  | —     | Tek süreçte çalışıyoruz ve üçüncü taraf kod çalıştırmıyoruz. Plugin mekanizması gerçek kod çalıştırmaya başlarsa gerekli olur                                                      |
| 8.2  | Deployment preset'leri | —     | Tek deploy hedefi var. Yalnız "bağımlısız çıktı" fikri ayrıca değerli; ikinci hedef çıkarsa tamamı gündeme gelir                                                                   |
| 8.3  | Zamanlanmış görevler   | —     | `after()` yanıt sonrası işi çözdü. Yanıttan **bağımsız** periyodik iş (cache ısıtma, sitemap tazeleme) ihtiyacı doğarsa                                                            |
| 9.4  | `node:sqlite`          | —     | Gömülü veri ihtiyacımız yok; L1 cache byte-bütçeli map, L2 Redis. Yerel bir okuma-ağırlıklı veri seti çıkarsa                                                                      |
| 10.2 | Rolldown               | —     | Vite 8'deyiz ama bundler hâlâ esbuild/Rollup; `@rolldown/pluginutils` yalnızca bir plugin yardımcısı olarak lockfile'da. Rolldown Vite'ta varsayılan olduğunda kendiliğinden gelir |

### Kasıtlı hayır

- **6.1 Speculation Rules** — analitik itirazı çözülebilir (§ 6.1'de nasıl olduğu yazılı), ama
  prerender'ın ucuz olduğu senaryo bu uygulamada gerçekleşmiyor: paylaşımlı cache'li tek sayfa `/`
  ve kimse üstünde durduğu sayfayı prerender etmez. Gerçek hedefler üç `neverCache` sayfa, yani
  atılan her prerender tam SSR + dört gateway çağrısı. S7 kararı verilmeden bu madde açılmaz.
- **2.3 Resumability (Qwik)** — React'e taşınamaz, island modelimiz faydanın çoğunu zaten veriyor.
- **5.3 SRI** — ana üçüncü taraf script'imiz GTM ve o sürekli değiştiği için SRI uygulanamaz;
  sabit sürümlü vendor'larda dar fayda.
- **5.4'ün COEP kısmı** — tüm üçüncü taraf kaynakların CORP göndermesini gerektiriyor, GTM ile
  çatışır. COOP alınmalı, COEP alınmamalı.
- **8.2 preset sistemi (tamamı)** — tek deploy hedefimiz var; portabilite bugün ödemediğimiz bir
  fatura.

---

## 12. Dikkat edilecek tuzaklar

Araştırma sırasında çıkan, uygularken sorun çıkaracak noktalar:

1. **Speculation Rules + analytics**: Prerender edilen sayfada page view erkenden ateşlenirse
   görüntülenmemiş sayfa için ölçüm üretirsin. Sigorta'nın kodunda **dört** sayan yüzey var, ikisi
   ilk taramada gözden kaçmıştı: head'deki GTM zinciri, `page-analytics` island'ı, `session-start`'ın
   tracking id + A/B kovası ataması, ve `storeBotVisit`/`logRequest`. İlk ikisi
   `document.prerendering` / `prerenderingchange` ile, son ikisi `Sec-Purpose` header'ı ile
   kapatılır. En kötüsü page view değil **kova ataması**: atılmış bir prerender, kullanıcı sayfayı
   hiç görmeden onu bir deney kovasına yazar. 6.1'den önce çözülecek şey budur. Ayrıntı: § 6.1.
2. **Server Islands props imzası**: Ertelenmiş render'ın props'u istemciden geliyorsa endpoint
   saldırgan kontrollü hale gelir. İmza/şifreleme opsiyonel değil.
3. **Taint'in sınırı**: React'in kendi dokümanı açıkça söylüyor — `{...user}` ya da
   `{name: user.name}` yeni ve **kirletilmemiş** bir nesne üretir. Taint tek başına güvenlik değil,
   DAL'daki filtrelemenin yerine geçmez.
4. **bfcache vs `no-store`** — **ölçüldü, çatışma dar çıktı.** `applyCookies` yalnızca gerçekten
   `Set-Cookie` taşıyan yanıtı düşürüyor ve session cookie'leri bir kez basılıyor: ilk ziyaret
   restorable değil, sonraki her ziyaret restorable. Asıl ders tuzağın kendisinde değil: her
   istekte cookie basan bir hata (session-start'ın eski `isBot` davranışı) site genelinde bfcache'i
   kapatır ve **hiçbir yerde görünmez**. Artık görünüyor — § 6.4.
5. **Preview mode ve cache**: Preview çerezli istek paylaşılan cache'e **yazmamalı**. Bu kuralın
   framework tarafından garanti edilmesi şart; uygulamaya bırakılırsa er geç yayınlanmamış içerik
   herkese servis edilir.
6. **Trusted Types ve React**: `dangerouslySetInnerHTML` politika ister. Report-only ile başlayıp
   ihlal toplamadan enforce'a geçmek riskli.

---

## Kaynaklar

- [Next.js 16](https://nextjs.org/blog/next-16) · [cacheComponents](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents) · [instrumentation.js](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) · [Data Security](https://nextjs.org/docs/app/guides/data-security)
- [Nitro — KV Storage](https://nitro.build/docs/storage) · [Nitro — Cache](https://nitro.build/docs/cache) · [Nuxt Rendering Modes](https://nuxt.com/docs/3.x/guide/concepts/rendering) · [Nuxt Layers](https://nuxt.com/docs/4.x/getting-started/layers) · [Intro to Nitro (InfoWorld)](https://www.infoworld.com/article/4061129/intro-to-nitro-the-server-engine-built-for-modern-javascript.html)
- [Astro 5.0](https://astro.build/blog/astro-5/) · [Astro 6 Beta](https://astro.build/blog/astro-6-beta/) · [Astro Actions](https://docs.astro.build/en/guides/actions/) · [Live Content Collections](https://astro.build/blog/live-content-collections-deep-dive/)
- [SvelteKit Form actions](https://svelte.dev/docs/kit/form-actions) · [Remote functions rehberi](https://blog.imseankim.com/sveltekit-remote-functions-query-form-command-prerender-guide-2026/)
- [Hono RPC](https://hono.dev/docs/guides/rpc) · [Hono Validation](https://hono.dev/docs/guides/validation) · [Hono Stacks](https://hono.dev/docs/concepts/stacks)
- [Vite Environment API](https://vite.dev/guide/api-environment) · [Vite 7.0](https://vite.dev/blog/announcing-vite7)
- [React `experimental_taintObjectReference`](https://react.dev/reference/react/experimental_taintObjectReference) · [`experimental_taintUniqueValue`](https://react.dev/reference/react/experimental_taintUniqueValue)
- [CSP `require-trusted-types-for` (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/require-trusted-types-for) · [Trusted Types ile DOM XSS (Chrome)](https://developer.chrome.com/docs/lighthouse/best-practices/trusted-types-xss)
- [Speculation Rules API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API) · [Prerender (Chrome)](https://developer.chrome.com/docs/web-platform/prerender-pages) · [Early Hints vs Resource Hints vs Speculation Rules](https://aarontgrogg.com/blog/2026/03/31/early-hints-vs-resource-hints-vs-speculation-rules-which-is-right-for-what-and-when/)
- [WinterTC](https://wintertc.org/) · [Minimum common web API](https://min-common-api.proposal.wintertc.org/) · [WinterCG → WinterTC](https://www.w3.org/community/wintercg/2025/01/10/goodbye-wintercg-welcome-wintertc/)
- [Node.js 24.0.0](https://nodejs.org/en/blog/release/v24.0.0) · [What's New with Node.js 24 (OpenJS)](https://openjsf.org/blog/nodejs-24-released)
