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

### 3.2 `routeRules` — bildirimsel, tek yerde route politikası **[P2]** **[YAPILDI — 0.7.49]**

- **Ne**: Nitro'nun `routeRules`'ı glob başına cache, header, redirect, proxy, prerender, ISR/SWR
  kurallarını tek konfigürasyonda topluyor: `"/blog/**": { cache: { maxAge: 3600 } }`,
  `"/api/**": { swr: 3600 }`.
- **Bizde**: Parçalar var ama dağınık — cache politikası `defineRoute` içinde, redirect/rewrite
  `src/routing/rules.ts`'te, header'lar middleware'de. Route manifest'imiz bunları raporluyor ama
  tek kaynak değil.
- **Değer**: Operasyonel netlik. "Bu path'e ne oluyor?" sorusunun tek cevabı olur. Bizim route
  manifest çıktımız zaten bu tabloyu üretmeye çalışıyor — kaynağı da tekleştirmek doğal devam.
- **Maliyet/risk**: Orta. Mevcut iki kaynağı tek modele indirirken geriye uyumluluk gerekiyor.

**Ne yapıldı (0.7.49).** `createApp({ routeRules })` — sıralı bir tablo, path desenleri route
tablosunun kendi diliyle (`/a/:id`, `/a/:path*`).

Şikâyet bölünmeydi: "bu path ne gönderiyor" sorusunun cevabı registry, middleware ve route dosyası
arasında dağılmıştı. Tablo o cevabın tek yeri.

**Sıralama route tablosunun tersi.** Route'ta ilk eşleşen kazanır; burada **sonraki kazanır**, yani
tablo en genelden özele okunur — stylesheet gibi. İkisi farklı olduğu için `match` yeniden
kullanılmadı.

**İkinci bir cache policy yolu değil.** `Route.cache` key oluşmadan önce çalışıyor ve isteği
okuyabiliyor; statik bir tablo okuyamaz, ve tek bir karar için iki kaynak zaten bölünmenin başladığı
yer. `cache-control`, `set-cookie` ve `content-type` bu yüzden korumalı: üçü de yanıt başına, bir
path deseninin göremeyeceği şeyleri bilen makine tarafından kararlaştırılıyor (bu bir gönderim
miydi, cookie basıldı mı, preview policy'yi düşürdü mü). Tablo bunları ezseydi hata bir kural gibi
değil bir cache bug'ı gibi görünürdü. Korumalı bir başlık yazmaya çalışan tablo **açılışta**
uyarı alıyor — üretimde eksik bir header'dan öğrenmek pahalı yol.

**Catch-all deseni yoktu, ve kimse söylemedi (0.7.58 düzeltti).** Her iki uygulama da tablosunu
`/:path*` ile açıyordu; `matchPath` ise `*`'ı hiç bilmiyor, adı `path*` olan sıradan bir parametre
okuyordu. Sonuç: genel kural tam olarak **tek segmentli** yollara uygulanıyordu — `/urun` alıyor,
`/` almıyor, `/urun/kasko` almıyordu. `RouteRule.path`'in kendi dokümantasyonu dili doğru sayıyordu
(`/a/b`, `/a/:id`, `/a/:id?`), yani core yalan söylemiyordu; iki uygulama dilin dışında bir desen
yazdı ve hiçbir şey itiraz etmedi.

Bu, maddenin kendi ilkesine düşen bir boşluktu: korumalı header yazan tablo açılışta uyarı alıyor,
hiç eşleşemeyecek desen yazan tablo sessizdi. İki taraf da kapandı — `match` artık gerçek bir rest
parametresi tanıyor (`:name*`, sıfır segment dahil, yani `/` de kapsanıyor) ve rest'i son segment
olmayan bir tablo açılışta uyarı alıyor. Testler de düzeldi: eskisi genel kuralı `/:path?` ile
sınıyordu, yani **uygulamaların kullanmadığı deseni** doğruluyordu; `/:path*` yalnız gövde/status
testinde ve tek segmentli bir path ile geçiyordu. Şimdi `/`, `/urun`, `/urun/kasko` ve `/a/b/c/d`
için header'ın kendisi assert ediliyor.

### 3.3 Harici cache driver (unstorage'ın yarısı) **[P2]** **[KISMEN — 0.7.49]**

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

**Ne yapıldı (0.7.49).** `registerCacheDriver({ name, create })`.

`CacheStore` zaten bir sürücü arayüzüydü — memory, Redis ve ikisinin tiered bileşimi onun üç
implementasyonu. Eksik olan **dışarıdan giriş**ti: platformun hiç duymadığı bir runtime'da çalışan
bir uygulama (Cloudflare KV, Memcached, her çağrıyı kaydeden bir test double'ı) fork etmek zorundaydı.

`initCache`'ten **önce** kaydediliyor ve çalışan bir sunucunun altından değiştirilemiyor: store
uçuş sırasında değişse uçuştaki okumalar bir backend'e, yazmaları başkasına konuşurdu. Geç kayıt
denemesi sessizce yok sayılmıyor, hata veriyor.

Sürücünün adı topology etiketi oluyor, yani `cache initialized` log satırı ve metrikler hangi
store'un çalıştığını söylüyor.

**Yarısı — ve madde bu yüzden yeniden adlandırıldı.** Yukarıda değer ikiye ayrılmıştı:
(a) cache dışı KV ihtiyaçları için tek arayüz, (b) Redis bağımlılığını bir driver seçimine indirmek.
`registerCacheDriver` yalnız (b). (a) için ham malzeme var — `readCoordinationValue` /
`writeCoordinationValue` / `takeDistributedRateLimit` / `acquireCacheLock` fiilen genel bir KV — ama
isimli alan (`useStorage("sessions")` gibi) yok, alan başına driver seçimi yok, ve dışarıdan sürücü
yazmak hâlâ HTML-cache'e özgü zorunlu yüzeyi (`keysByTags`, `deleteByPrefix`, `listKeys`, `flushAll`)
uygulamayı gerektiriyor. Madde artık yaptığı şeyin adını taşıyor; **isimli genel KV ayrı ve açık bir
madde olarak duruyor.**

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

### 4.4 Route'lardan OpenAPI üretimi **[HAYIR]**

**İlk değerlendirme yanlış bir dosyayı işaret ediyordu.** Şöyle yazmıştım:
"`contracts/openapi.json` elle yazılmış bir fixture — gerçek route'lardan türetilmiyor, dolayısıyla
sessizce eskiyebilir." Dosyaya bakınca ikisi de çıkmadı.

**O belge bizim API'mizi tarif etmiyor, gateway'i tarif ediyor.** İçindeki path'ler `/items`,
`/pages/menuitem/list` — bizim `/api` uçlarımız değil, tükettiğimiz upstream'in uçları. Bizim
route'larımızdan türetilemez, çünkü başka birinin sistemini anlatıyor. Türetseydik yanlış sistem
hakkında bir belge üretmiş olurduk.

**Ve "elle yazılmış fixture" değil, çalışan bir consumer-driven contract.** `contracts:fixtures`
üretilen uygulamaların `ci` zincirinde koşuyor ve fixture'ları şemaya karşı doğruluyor;
`.github/workflows/contract-staging.yml` aynı kontrolü gerçek gateway'e karşı koşuyor. Yani drift
koruması zaten var.

**Peki `@hono/zod-openapi` (maddenin asıl önerisi) gerekli mi? Hayır.** O, _bizim kendi_ `/api`
uçlarımız için OpenAPI üretirdi. O uçların istemcisi bizim kendi island'larımız ve 4.1 (Hono RPC)
onlara tipi **kaynaktan** veriyor — üretilmiş bir belgeden kesin olarak daha iyi. Kendi API'miz için
OpenAPI, ancak birlikte derlemediğimiz bir istemci (mobil uygulama, partner) çıktığında hak eder.

**Ve OpenAPI zarfı 0.7.52'de tamamen kaldırıldı.** Soru haklıydı: zarfı hiçbir şey okumuyordu.
Kontrol eden araç yalnız `components.schemas`'a bakıyordu; `openapi`, `info` ve `paths` bir kez bile
okunmadı, endpoint'in method'u ve path'i de zaten manifest'te duruyordu. Kimsenin okumadığı bir
zarf, aynı bilginin ikinci kez yazıldığı ve zamanla ayrıştığı yerdir. Dosya artık
`contracts/gateway-schemas.json` ve düz JSON Schema 2020-12: bir `$schema` satırı ve `$defs`.
`0.7.52-json-schema-contracts` migration'ı iki dosyayı birlikte taşıyor — yarım uygulanmış bir
yeniden adlandırma hiç yapmamaktan kötüdür, çünkü manifest artık var olmayan bir belgeyi gösterir.

Bu, kontrol eden aracı da sadeleştirdi: OpenAPI zarfını Ajv'nin strict mode'una sokabilmek için
şemaları `$defs` altına taşıyıp pointer'ları yeniden yazan bir dönüşüm katmanı vardı; belge zaten o
biçimde olduğu için katman silindi.

**Şema yine de elle yazılmaz — bunu ilk denemede ben yanlış yaptım.** `origin-scaffold-gateway`
(`contracts:scaffold`) zaten var ve tam bunu yapıyor: gerçek bir gateway cevabını verirsin, fixture,
JSON Schema, OpenAPI kaydı, manifest girdisi, TypeScript tipi ve servis iskeleti üretir. Ben ilk
turda iki şemayı testlerdeki yüklerden elle yazdım; doğru yol komutu çalıştırmak.

Komutta bir boşluk vardı ve bu uygulamanın durumu tam da oydu: `--service-only` (contract'sız proje)
vardı ama tersi yoktu. Servisi ve `GatewayContracts` girdisi zaten olan, yalnız şeması eksik bir uç
için komut mevcut servisin yanına ikinci bir tane yazmayı öneriyordu. `--contracts-only` bunun için
eklendi (0.7.51).

**Gerçek risk başkaydı ve daha büyüktü.** Ne showroom ne sigorta bu makineden hiçbirini
benimsememişti: sigorta on beş gateway ucu okuyor, hepsinin byte bütçesi var, **hiçbirinin şeması,
fixture'ı ya da drift kapısı yoktu.** Byte bütçesi şekil kontrolü değildir — upstream'in on megabayt
yollamasını engeller, bir alanı yeniden adlandırdığı gün hiçbir şey söylemez. Bu, dökümanın işaret
ettiği riskin yerine geçen gerçek risk. § 4.4 yerine oraya bakılmalı: 0.7.50'de sigorta'ya kapı
takıldı ve **kendi kendini kapatan** hale getirildi (aşağıda).

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

### 5.6 Idempotency key'leri **[P2]** **[YAPILDI — 0.7.48, sözleşme 0.7.58'de kapandı]**

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

**Garanti store başına — pod başına değil (0.7.58'de yazıya döküldü).** Yukarıdaki `unavailable`
cümlesi store'un **yokluğu** hakkında ve o haliyle doğru. Üretimdeki asıl incelik başka: kilit de
kayıt da cache'in yaşadığı yerde yaşıyor, ve şablonun ürettiği `.env.production` `CACHE_BACKEND=memory`
ile geliyor. MemoryStore `writeEphemeral`'ı uyguladığı için `unavailable` hiç görünmüyor; guard
gerçekten çalışıyor, sadece **tek process kadar geniş**. İki pod aynı anahtarı ayrı ayrı bir kez
kabul eder.

Redis'i zorunlu kılmak yanlış cevap olurdu: tek pod'da guard hâlâ gerçek iş yapıyor — çift tık,
retry, proxy replay'in üçü de aynı process'e geliyor. Bunun yerine sözleşme daraltıldı ("bir store
başına en fazla bir kez") ve **ilk guard çalıştığında** bir kez uyarı düşüyor: paylaşımlı L2 ya da
kayıtlı bir driver yoksa `idempotency records are process-local`. Açılışta değil, ilk kullanımda —
bu yolu hiç kullanmayan bir uygulama için o topoloji zaten doğru, ve kimsenin kodunun hak etmediği
bir uyarı herkesin atlamayı öğrendiği uyarıdır.

Testteki "Two pods" yorumu da düzeltildi: dosyadaki her şey **tek** `MemoryStore` paylaşıyor, yani
test eşzamanlılığı doğruluyor, dağıtıklığı değil. Sınırın kendisi artık ayrı bir testle pinli.

**Sözleşme bir tur daha daraldı, sonra genişledi.** İkinci review üç sınır daha buldu; üçü de
"paylaşımlı L2 var mı" sorusunun ötesindeydi ve üçü de kapandı.

1. **Uyarı, shared olmayan bir driver'ı shared sanıyordu.** `warnWhenGuaranteeIsProcessLocal`
   herhangi bir kayıtlı driver'ı yeterli sayıyordu, ama `registerCacheDriver()` driver'ın
   process-local mı paylaşımlı mı olduğunu söylemiyordu; bir test double ya da dosya sistemi
   driver'ı uyarıyı susturur, ve uyarı susturulduğu anda korumayı bilmediğimiz bir yalana çevirir.
   `CacheDriver` artık `coordinationScope: "process" | "shared"` beyan ediyor ve **varsayılan
   `"process"`** — iyimser tahmin pahalı olan taraf, o yüzden driver açıkça söylemeden hiçbir şey
   onun adına iddia edilmiyor. Soru da doğru yere taşındı: `isCoordinationShared()`.
2. **Redis namespace'i `RELEASE_ID` taşıyordu.** `RedisStore` her anahtarı — `ephemeral:` ve `lock:`
   dahil — `ssr:<releaseId>:` ile prefix'liyordu, ve deployment sözleşmesi her deploy'un yeni bir
   `RELEASE_ID` almasını şart koşuyor. Rolling deploy sırasında eski ve yeni pod'lar aynı Redis'te
   olsalar bile **farklı** kayıtlara bakıyordu: aynı anahtar release başına bir kez çalışabiliyordu.
   Blue/green'in HTML için istediği izolasyon, koordinasyon için tam tersi şey. Koordinasyon durumu
   artık release namespace'inin dışında, sabit bir `ssr:coordination:` altında; cache kilitleri
   (cold-fill, revalidation) bilerek release'in içinde kaldı, çünkü onlar zaten release'e ait bir
   şeyi koruyor. Ayrımı taşıyan şey `CacheStore`'daki `acquireCoordinationLock` — `readEphemeral`'ın
   `read`'den ayrı olmasıyla aynı sebep.
3. **`in-flight`, "kimse cevap veremedi"yi yutuyordu.** `acquireCacheLock` hem gerçek contention'da
   hem backend exception'ında `null` döndürüyordu; ikisi de `in-flight` oluyordu. Redis erişilemezse
   ziyaretçiye "gönderiminiz zaten işleniyor" deniyor, hiçbir şey işlemiyor, ve alarmın izlediği
   `unavailable` serisi tam da var olma sebebi olan kesinti boyunca düz kalıyordu. `attemptCoordinationLock`
   üç durumu ayırıyor: `acquired` / `held` / `unavailable`. Kilidi hiç desteklemeyen bir backend
   dördüncü durum ve o `acquired` — tek process'te dışlanacak başka tutan yok, ve orada reddetmek
   platformun varsayılan topolojisini kırardı.

Bugünkü sözleşme: **paylaşımlı bir store başına en fazla bir kez, ve o store paylaşımlıysa deploy
sınırını da geçiyor.** Paylaşımlı store yoksa garanti tek process kadar — ve bunu ilk guard
çalıştığında uyarı söylüyor.

**Anahtar bir cache slot'u, gövdeye gömülü bir değer değil — ve bunu bir test yakaladı.** İlk
uygulamada anahtar shell'e render başına basılıyordu. Ana sayfa paylaşımlı cache'li olduğu için tek
bir cache gövdesinden servis edilen iki ziyaretçi **aynı anahtarı** alacaktı: ikincisinin aboneliği
birincisininki olarak replay edilecekti. Guard'ın kendisi bug'a dönüşüyordu. Sigorta'nın shell
determinism testi bunu yakaladı.

Doğrusu: `submissionKey`, `cspNonce` ve `pageRequestId` ile aynı mekanizmada bir **dynamic slot**.
Cache'e placeholder giriyor, her yanıta taze değer materialize ediliyor.

Slot'u eklemek yetmedi — ikinci bir test daha yakaladı. MISS'te form somut anahtarla çiziliyor
(çizilmek zorunda, form MISS'te de çalışmalı), yani cache'e **somut** anahtar giriyordu. `normalize`
pass'ine bir kural eklendi: diğer iki slot için o pass defence-in-depth, bunun için **tek koruma**.

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

### 6.2 Early Hints (HTTP 103) **[P2]** **[YAPILDI — 0.7.49]**

- **Ne**: Sunucu asıl yanıtı hazırlarken 103 ile kritik kaynakları önceden bildiriyor.
- **Bizde**: Yok. Cache MISS'te gateway beklerken geçen süre tam olarak 103'ün doldurduğu boşluk.
- **Değer**: Cache MISS ve cold-fill senaryolarında gerçek TTFB→LCP kazancı. Cache HIT'te zaten
  hızlıyız, yani kazanç dar bir dilimde — ama o dilim (cold path) bizim en yavaş yolumuz.
- **Maliyet/risk**: Hono + Node HTTP/1.1 üzerinde 103 göndermek doğrudan desteklenmiyor; ters proxy
  (nginx/CDN) katmanı gerekebilir. Altyapıya bağımlı.

**Ne yapıldı (0.7.49).** `EARLY_HINTS=true` ile açılıyor, **varsayılan kapalı**.

Kritik olan ne zaman gönderildiği. 103, sunucu upstream'i beklerken soketin boşta durduğu dilimde
işe yarıyor; cache HIT'te doküman zaten elde ve hint bir milisaniye sonra gerçek yanıtın cevapladığı
şeyi soruyor — saf maliyet. Bu yüzden blanket middleware değil: `executeSsrRequest` **cache'ten bir
yanıt gelmediğini** öğrendiği anda, render'dan hemen önce gönderiyor.

Bu "yalnız MISS" demek değil, ve önceki ifade yanlıştı: cache policy'si olmayan bir render de
buradan geçiyor ve sonradan `x-cache: BYPASS` oluyor. Davranış doğru — 103'ün kazandırdığı dilim
tam olarak upstream beklenen dilim, ve BYPASS render'lar zaten en yavaş olanlar. Kapsam dışında
kalan tek şey, hint'in saf maliyet olduğu yer: cache'ten servis edilen yanıt.

Yalnız ilk boyamanın beklediği şeyler hint ediliyor: stylesheet, entry (`modulepreload` olarak —
`preload; as=script` farklı bir cache girdisi, yanlışını hint etmek dosyayı iki kez indirtir) ve
build'in preload işaretlediği fontlar (`crossorigin` ile, yoksa tarayıcı preload'ı atıp yeniden
indirir). Modül preload grafiği kasıtlı olarak dışarıda: büyük ve spekülatif.

Her hata sessiz. `writeEarlyHints`'i olmayan bir runtime, kapanmış bir bağlantı, soketi açmayan bir
adapter — hiçbiri başarıyla sonuçlanacak bir isteği düşürmek için sebep değil. `ssr_early_hints_total`
yalnızca gerçekten gönderilenleri sayıyor.

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

**İsimler yanlış elemandaydı (0.7.58 düzeltti).** `data-view-transition="header"` ve `"footer"`,
fragment dikişini yapan `ssr-fragment` sarmalayıcısına konmuştu — ve o sarmalayıcı
`display: contents`. Principal box üretmeyen bir eleman için `view-transition-name` etkisizdir, yani
pratikte yalnız gerçek `<main>` isimlendirilmişti: maddenin amacı olan "kabuk yerinde kalsın, içerik
morph etsin" hiç gerçekleşmiyordu.

Sessiz olması asıl kötü kısım. Bu madde tam olarak böyle sessiz bozulmalardan (çift ad → geçiş
atlanır) endişelenen bir yorumla yazılmıştı ve aynı sınıfa düştü. Test de sessizliğe ortaktı: CSS
metninin çıktıda bulunduğunu doğruluyordu, ki bu kuralın **hangi elemana** bağlandığı hakkında hiçbir
şey söylemiyor.

Ad artık kutuyu çizen elemanın üstünde: showroom ve Sigorta'da `<header>` / `<footer>`. Yeni test
tarayıcı gerektirmeden ikisini ayırt edebilen en ucuz şeyi assert ediyor — adın **hangi etikette**
durduğunu, her rolün belge başına tam bir kez göründüğünü, ve hiçbir `ssr-fragment`'ın ad taşımadığını.

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

**Header sözleşmesi sabitlendi (0.7.44) — ve korkunun dayanağı zayıf çıktı.**

Yukarıdaki "muhtemelen bugün çoğu sayfada bfcache devre dışı" tahmini bir **varsayıma** dayanıyordu:
sigorta her yanıtta `no-store` gönderiyor olmalı. O varsayım yanlış. Gerçek bfcache sonucu ise burada
ölçülmedi — ölçen tek şey `ssr_client_bfcache_total`.

`tests/bfcache-eligibility.test.ts` üç durumda **framework'ün ne gönderdiğini** sabitliyor:

| Durum                           | `Set-Cookie` | `Cache-Control`                | `no-store` uygulanıyor mu |
| ------------------------------- | ------------ | ------------------------------ | ------------------------- |
| İlk ziyaret (session basılıyor) | var          | `private, no-store`            | evet                      |
| Sonraki her ziyaret             | yok          | `private, no-cache, max-age=0` | **hayır**                 |
| Form gönderimi (POST)           | —            | `private, no-store`            | evet (doğrusu bu)         |

Kolonun adı bilerek "bfcache'i engelliyor mu" değil. Header sözleşmesinden tarayıcı sonucu
çıkarmak, bu maddenin en başta yaptığı hatanın aynısı olurdu — sadece ters yönde.

**Tablonun sınırı, ve önceki sürümünün fazla söylediği şey.** Bu tablo bir **header sözleşmesi**;
test de tam olarak onu pinliyor (`Set-Cookie` ve `Cache-Control`), gerçek bir tarayıcı navigasyonu
değil. "Sonraki her sayfa restorable" demek bir adım fazlaydı: header engellemiyor olmak, restore
edilecek demek değil — `unload` dinleyicisi, açık bağlantı, bellek baskısı, ve tarayıcıdan tarayıcıya
değişen `no-store` politikası hâlâ konuşuyor. Chrome güvenli durumlarda `no-store` sayfaları
bfcache'e almayı denedi ve cookie değişiminde eviction uyguluyor; yani header → sonuç eşlemesi
tarayıcılar arasında sabit bile değil.

Somut bir karşı örnek de var: showroom'un `longLivedRoutes` ile işaretlediği market stream'i açık
bağlantı tutan bir sayfa — header'ları temiz olsa da kapsam dışı kalabilir.

Vaat edilecek şey header davranışı; sonucu söyleyen tek şey `ssr_client_bfcache_total`.

`applyCookies` yalnızca gerçekten `Set-Cookie` taşıyan yanıtı düşürüyor, ve session cookie'leri bir
kez basılıyor. Yani engelin maliyeti ilk ziyarette bir kez ödeniyor.

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

### 7.2 Layers / extends **[P2]** **[YAPILDI — 0.7.57]** · _runtime kalıtım kasıtlı olarak yok_

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

**Önce ölçüldü (0.7.54).** "Tek ürün olduğu sürece fatura ödenmiyor" notu yanlıştı:
`docs/multi-product-adoption.md` on beş ürün planlıyor, ve template ile sigorta arasındaki fark
zaten ödenmiş bir faturaydı.

| Dosya                           | Farklı satır |
| ------------------------------- | -----------: |
| `server/diagnostics/gateway.ts` |          164 |
| `server/index.ts`               |           64 |
| `server/product/runtime.ts`     |           51 |
| `src/entry.client.tsx`          |           27 |
| `eslint.config.js`              |           26 |
| `tsconfig.json`                 |           13 |

Bir kısmı **olması gereken** fark: route tablosu, product runtime, client tercihleri ürüne ait.
`eslint.config.js` değil — ve ıraksamasının bedeli somut çıktı:

1. **Gateway seam kuralı sigorta'da hiç yoktu.** Servislerin gateway'i diagnostics sarmalayıcısı
   yerine doğrudan import etmesini engelleyen kural. Dört servis tam bunu yapıyordu ve o çağrılar
   `SSR_DIAGNOSTICS`'e görünmüyordu. Olmayan bir kural hiçbir şeyi düşürmez, o yüzden kimse fark
   edemezdi.
2. **Import sıralaması hiç açılmamıştı.** Config plugin'i kaydediyor ama kurallarını `error`
   yapmıyordu; 89 ihlal sessizce birikmişti.

**Yapılan, layer sistemi değil.** Config kopyalanmıştı, oysa **paketlenmeliydi**.
`@originloom/tooling/eslint` paylaşılan kuralları ve seam kuralını taşıyor; üretilen config preset'i
yayıyor ve yalnızca gerçekten kendine ait olanı tutuyor. Kural ve testi de pakete taşındı — her
uygulamaya üretilen bir kural, her uygulamada ayrı ayrı çürüyen bir kuraldır.

**Bu, o turda 7.2'yi kapatmadı.** Var olmak için sebebi olmayan en büyük ıraksama parçasını
kaldırdı — ki bu, runtime layer kalıtımından farklı ve _ucuz_ bir şey: çözünürlük sırası yok, tip
birleştirme yok, override semantiği yok. Geriye kalan ya gerçekten ürüne aitti, ya da aynı
muameleyi bekliyordu.

**Sıradaki 164 satır (0.7.55).** `server/diagnostics/gateway.ts` ve onu besleyen
`ssr-diagnostics.ts`: sıfır ürün içeriği, iki uygulamada iki farklı sürüm. Doğru çözüm bunları
platforma taşımak değil, **seam'i ortadan kaldırmaktı**. Sarmalayıcının tek işi gateway çağrısını
kaydetmekti; artık `gatewayFetch` bunu kendisi yapıyor. Trace kaydedicisi
`@originloom/core/diagnostics/request-trace` olarak paketlendi.

Sarmalayıcı, unutulabilir olduğu için sorundu — ve 0.7.54'te bulduğumuz "dört servis onu unutmuş"
tablosu bunun kanıtıydı. Unutulamayan tek sarmalayıcı, sarmalayıcı olmayandır. Onu zorunlu kılan
lint kuralı da bu yüzden emekliye ayrıldı: yasakladığı import artık doğru olan import.

Taşırken modülün taşıdığı bir bug çıktı: kayıtlar async context'teki id ile yazılıyor,
`logSsrOutcome` ise `x-request-id` header'ıyla okuyordu — header'ı yalnız belli bir proxy set
ediyor, yoksa arama ıskalıyor ve trace boş çıkıyordu. Boş trace "hiçbir şey olmadı"dan ayırt
edilemez; iki kopya arasında dolaşan bir bug'ın kaç tur hayatta kaldığını bundan iyi anlatan bir
örnek yok.

**Kalan ıraksama** (biçimlendirilmiş scaffold'a karşı ölçüldü):

| Dosya                       | Farklı satır | Değerlendirme                                       |
| --------------------------- | -----------: | --------------------------------------------------- |
| `server/index.ts`           |           54 | Ürüne ait: route tablosu, middleware sırası         |
| `server/product/runtime.ts` |           49 | Ürüne ait: runtime sözleşmesinin doldurulması       |
| `src/entry.client.tsx`      |           23 | Ürüne ait: island kaydı                             |
| `eslint.config.js`          |           20 | Ürüne ait: Türkçe yorum + `public/` için global'ler |
| `tsconfig.json`             |            0 | —                                                   |
| `vitest.config.ts`          |            0 | —                                                   |

0.7.54'ün tablosundaki `tsconfig.json` **13 satır** aslında ölçüm hatasıydı: scaffolder şablonları
yazarken prettier'dan geçiriyor, ben ham şablonla karşılaştırmıştım. Fark sıfır. `vitest.config.ts`
kozmetikti, hizalandı.

**Tam sweep (0.7.56).** Altı dosyaya bakmak yetmiyordu. Şablonun ürettiği her dosya ile sigorta
karşılaştırıldı: **154 ortak dosya, ~5.300 satır fark.** Tablo şunu söylüyor:

| Nerede                                                                           | Ne kadar | Meşru mu?                                   |
| -------------------------------------------------------------------------------- | -------: | ------------------------------------------- |
| `server/services/menu.ts`, `src/lib/cache-keys.ts`, route'lar, sayfalar, testler |    ~5000 | Evet — ürünün kendisi                       |
| `server/lib/bff-{http,auth}.ts`                                                  |       83 | **Hayır** — saf altyapı, sıfır ürün içeriği |

Yani sistemin geri kalanı sağlıklıydı; ıraksamanın neredeyse tamamı ürün kodunun ürün olmasıydı.
Geriye tek bir kopya kalmıştı ve o da aynı hikâyeydi: sigorta'nın kopyasında `BFF_HEADERS` ve
`halt()` hiç yoktu, ve "gövdeyi önce oku, yoksa `Body is unusable`" uyarısı düşmüştü. Bir hata
önleyicisi, sessizce.

**0.7.56: son kopya da pakete gitti.** `@originloom/core/bff` — dokuz yardımcı, bir BFF route'unun
ihtiyacı olan her şey.

**0.7.57: migration'ın kendi çöpü.** Bunu 0.7.56'nın migration'ını gerçek bir uygulamada
_çalıştırmak_ ortaya çıkardı. `origin-migrate` değiştirdiği her dosyanın yedeğini
`.originloom/backups/` altına yazıyor; hiçbir şey o dizini ignore etmiyor, hiçbir şey onu test
toplamasından dışlamıyordu. Bir test dosyasına dokunan ilk migration, testin ikinci bir kopyasını
üretti — kopya migration'ın az önce sildiği modülü import etmeye devam ediyordu ve suite kimsenin
yazmadığı bir dosyada düştü.

**Asıl teslim: `origin-doctor --drift`.** Üç turun üçünde de sorunu bulan şey, elle alınmış bir
diff'ti. On beş üründe kimsenin yapmayacağı adım tam olarak budur. Komut, uygulamanın bugün
üretilecek hâlinden dosya başına kaç satır uzakta olduğunu en büyükten küçüğe listeler.

Bilerek bir **gate değil**. Sağlıklı bir uygulamanın ıraksamasının çoğu ürünün kendisidir; bunları
uyarıya çevirmek herkese komutu görmezden gelmeyi öğretirdi — ve üç bulgunun üçü de listenin
tepesine yakın duran _tek bir altyapı dosyasıydı_. Sıralama, o dosyayı doğru olmaktan çıkarıp
görünür yapar.

Karşılaştırılabilir bir baseline üretebilmek için `.originloom/project.json` artık uygulamanın hangi
argümanlarla üretildiğini (`scaffold`) taşıyor; migration bunu geriye dolduruyor. `title` doldurulmuyor:
hiçbir yerde tek anlamlı kayıtlı değil ve tahmin etmek yedi dosyayı uygulamanın hiç sebep olmadığı
bir ıraksama olarak raporlardı. Onlar "karşılaştırılmadı" olarak çıkıyor.

---

**Runtime layer kalıtımı yapılmadı — ve bu maddenin cevabı bu.**

Nuxt'ın layer'ı bir uygulamanın başka bir uygulamayı miras almasıdır. Bugün miras alınacak ikinci
bir uygulama yok, ve bir layer'ın taşıyacağı şeyler (kurumsal chrome, analytics, auth) şu an
sigorta'nın **ürün** dosyaları — şekillerini tahmin ederek bir çözünürlük sırası, tip birleştirme ve
override semantiği tasarlamak, ölçüm yerine varsayımla çalışmak olurdu. Bu turda üç kez varsayım
yanlış çıktı.

Bu maddenin gerçek acısı hiçbir zaman kalıtım değildi; **kopyanın sessizce ıraksaması**ydı. Üç tur
boyunca ölçülen de, kapatılan da o oldu:

| Tur    | Kopya                           | Kopyanın kaçırdığı                                  |
| ------ | ------------------------------- | --------------------------------------------------- |
| 0.7.54 | `eslint.config.js`              | Gateway seam kuralı — dört servis onu atlıyordu     |
| 0.7.55 | `server/diagnostics/*`          | `x-request-id` yokken boş çıkan trace               |
| 0.7.56 | `server/lib/bff-{http,auth}.ts` | `BFF_HEADERS`, `halt()`, "gövdeyi önce oku" uyarısı |

Üçü de artık paket. Dördüncüsü olursa onu bir komut söyleyecek, bir kaza değil. İkinci ürün geldiği
gün runtime kalıtım yeniden açılır — o zaman paylaşılacak şey elimizde olur ve tasarım onu ölçerek
yapılır.

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

**"Her hata" iddiası hem daraltıldı hem genişletildi (0.7.58).** İki gerçek boşluk vardı.

_Async reporter._ Kanca tipi `(report) => void`, ama TypeScript `void` dönüşe her değeri kabul eder;
`async` bir reporter sorunsuz derleniyor ve reject'i `reportRequestError` döndükten **sonra**, yani
`try`'ın dışında, unhandled rejection olarak düşüyordu. İlginç olan: bunu paketin kendi lint
preset'i zaten yakalıyor (`@typescript-eslint/no-misused-promises`), yani ilk savunma hattı vardı.
Ama başka bir preset ile linleyen ya da reporter'ı `any` üzerinden veren bir uygulama oraya
ulaşabiliyor — artık dönen değer thenable ise `catch`'i bağlanıyor. **Await edilmiyor**: yanıt yolu
bir transport'u beklemez.

_Bağlanmamış iki yol._ HEAD hataları ve server-island render hataları hâlâ doğrudan `logError`
kullanıyordu, yani Sentry'ye bağlanmış bir uygulama render hatalarının hepsini görüyor**du**, bu
ikisi hariç. İkisi de bağlandı. Gerekçeleri (HEAD gövdesiz 500 döner, island sessizce tek deliği
düşürür) **yanıt** hakkındaydı; kimin haber alacağı ayrı bir karar ve yanıt davranışı değişmedi.
Island'ın log satırındaki `island` alanını kaybetmemek için rapora `context` eklendi — bir çağrı
yerini buraya taşımak log satırına hiçbir şeye mal olmamalı.

_Ve iddia daraltıldı._ "Her beklenmedik sunucu hatası" değil: **ziyaretçinin ne aldığına karar veren**
her beklenmedik hata (request / route / render / stream). Tasarlanmış bir fallback'i olan degradasyon
— ıskalayan L2 okuması, fallback'ine düşen fragment, başarısız `after()` görevi — log satırı olarak
kalıyor, çünkü ziyaretçinin aldığı sayfa tasarımın öngördüğü sayfa. Sınır artık runtime
sözleşmesinde yazılı.

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

### 9.3 WinterTC / Minimum Common API **[P2]** **[KASITLI HAYIR — 0.7.58]**

- **Ne**: WinterCG artık Ecma TC55 (WinterTC). Minimum Common Web API'nin ilk baskısı **Aralık
  2025'te Genel Kurul tarafından kabul edildi** — sunucu runtime'larının uygulaması beklenen web
  API alt kümesi.
- **Bizde**: Hono seçimimiz zaten Web Standards üzerine kurulu (Request/Response/Headers/URL). Yani
  farkında olmadan bu standarda yakınız.
- **Değer**: Bir **kısıt** olarak değerli, özellik olarak değil: "platform kodu yalnız Minimum Common
  API + açıkça izin verilen Node API'leri kullanır" kuralı, ileride edge/worker'a taşınabilirliği
  bedavaya yakın tutardı.

---

**Ölçüldü (0.7.58).** Platform kodunda `node:` kullanımı:

| Paket           |  Dosya | Ne                 |
| --------------- | -----: | ------------------ |
| `origin-shared` | 0 / 60 | —                  |
| `origin-core`   | 22/106 | 14'ü `node:crypto` |
| `origin-react`  | 1 / 17 | `node:stream`      |

`node:crypto`'nun neredeyse tamamı `randomUUID`, `createHash`, `createHmac`, `timingSafeEqual` —
hepsinin Web Crypto karşılığı Minimum Common API'de. Yani **yaprak dosyalar sanıldığından
taşınabilir**.

Node bağı orada değil, **temelde**: `@hono/node-server` (HTTP sunucusunun kendisi), `ioredis` (L2
cache), `@opentelemetry/sdk-node` (tracing), asset manifest'i okuyan `node:fs`. `src/**` üzerine
kurulacak bir lint kuralı kolay %5'i korur, %95 hakkında hiçbir şey söylemez — ve "taşınabiliriz"
diye yanlış bir güven üretir. Bu, olmayan bir kuraldan kötüdür. Üstüne, edge/worker hedefi yol
haritasında yok: on beş ürünün hepsi aynı k8s + Redis deseni. § 8.2 için verilen karar burada da
aynen geçerli.

**Ama ölçüm gerçek bir sınır buldu.** `@originloom/shared` altmış kaynak dosyasında sıfır `node:`
import taşıyor ve bu tesadüf değil: o paketin modülleri tarayıcı bundle'ına giriyor — island
runtime, devtools paneli, client telemetry, data layer. Sınır **korumasızdı**. Oraya girecek bir
`node:fs` bugün hiçbir şeyi düşürmez; onu ilk import eden island'da, sonra, başka bir üründe patlar.
Tanıdık desen.

0.7.58'de kök ESLint config'i `packages/origin-shared/src/**` altında `node:*` import'unu reddediyor
(`src/vite.ts` hariç — build konfigürasyonu, hiçbir tarayıcıya gitmiyor). Kuralın kendisi bir testle
korunuyor: config'te `packages/**` için genel bir `no-restricted-imports: "off"` bloğu var ve bu
kural yalnız ondan _sonra_ tanımlandığı için kazanıyor; iki bloğun yeri değişse kural sessizce
kapanırdı. Bugün sıfır ihlalle geçiyor.

Yani bu maddeden alınan şey portabilite değil, **zaten var olan ve zaten değerli olan bir sınırın
kanıtlanması**.

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
  yaşamıyoruz — yani acil değil.
- **Maliyet/risk**: Orta.

---

**Ölçüldü (0.7.58).** Dokümandaki "Vite'ın kendi geçiş takvimine bağlı" gerekçesi eskimişti: **zaten
Vite 8'deyiz**, Environment API olgunlaşma aşamasını çoktan geçti. Gerçek gerekçe başka çıktı.

İki config builder'ın (`createBaseClientViteConfig`, `createServerViteConfig`) paylaştığı tek şey
`resolve.alias` ve `dedupe`. Geri kalanı gerçekten ayrı: client tarafında dev server, manifest,
`optimizeDeps`; server tarafında `ssr.noExternal`, `target: node24`, minify, `entryFileNames`.

Environment API'nin asıl vaadi runtime-agnostik modül runner'ları ve workerd dev paritesi — ve bizim
SSR bundle'ımız **dev'de Vite'tan hiç geçmiyor**, düz Node. Yani başlık özelliği tam olarak
kullanmadığımız şey. Geriye kalan kazanç iki dosyayı bire indirmek: her ürünün build yolunu, on
küsur satır için yeniden yazmak.

**Ama ölçüm burada da gerçek bir şey buldu.** Alias haritası her uygulamada **üç dosyada** elle
yazılıydı: `vite.config.ts`, `vite.server.config.ts`, `vitest.config.ts`. Üçü ayrışırsa testler
build'in çözdüğünden başka bir modülü çözer ve bunu hiçbir şey raporlamaz — testler geçer, bundle
başka bir dosya taşır. 0.7.58'de `@originloom/shared/vite`'ın `originLoomAliases(root)` yardımcısı
üçünü de besliyor; migration mevcut uygulamalarda haritayı çağrıyla değiştiriyor, üçüncü bir alias
eklemiş bir config'e ise dokunmuyor.

Environment API'ye geçiş, Vite mevcut API'yi deprecate ettiği gün ya da SSR'ı dev'de Vite üzerinden
çalıştırmayı istediğimiz gün yeniden açılır. İkisi de bugün doğru değil.

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

**0.7.58 bir review turuydu, yeni madde turu değil.** Bu dalganın "yapıldı" satırları dışarıdan
okundu ve altısı fazla söylüyordu. Üçü gerçek koddu — `routeRules`'ın catch-all deseni hiç
eşleşmiyordu, View Transition adları `display: contents` bir sarmalayıcıda etkisizdi, `onRequestError`
iki yolu ve async bir reporter'ı kaçırıyordu — üçü de düzeltildi ve teste bağlandı. Üçü ifadeydi:
bfcache'in tablosu bir sonuç değil bir header sözleşmesi, Early Hints yalnız MISS'te değil, storage
maddesi vaat ettiğinin yarısı. Aşağıdaki satırlar bu turdan sonraki hali.

| #       | Madde                       | Durum | Bugünkü durum ve eksik olan                                                                                                                                                                                                                           |
| ------- | --------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.2 ✅  | `AsyncContextFrame`         | ✅    | Ölçüldü — derin await zincirinde **2.2×**, çıplak store okumasında **2.8×**; § 9.2'de tablo                                                                                                                                                           |
| 5.4 ✅  | COOP / Origin-Agent-Cluster | ✅    | Miras değil, yazılı karar; test ikisini de ve COEP'in yokluğunu da pinliyor. COEP kalıcı hayır                                                                                                                                                        |
| 6.3 ✅  | View Transitions            | ✅    | İsimli geçişler + reduced-motion. 0.7.58: adlar `display:contents` sarmalayıcıdan gerçek `<header>`/`<footer>`'a                                                                                                                                      |
| 7.4 ✅  | instrumentation kancaları   | ✅    | `onRequestError`; log satırları aynen. 0.7.58: HEAD + server-island bağlandı, async reporter yakalanıyor, iddia ziyaretçinin yanıtına karar veren hatalarla sınırlandı                                                                                |
| 6.4 ◐   | bfcache                     | ◐     | Ölçüm altyapısı ✅ (`ssr_client_bfcache_total`). Tablo bir **header sözleşmesi**; "restorable" sonucunu söyleyen tek şey telemetri                                                                                                                    |
| 5.6 ✅  | Idempotency key'leri        | ✅    | `runOnce` + formun taşıdığı anahtar; JS'siz. Garanti **paylaşımlı store başına** ve deploy sınırını da geçiyor (koordinasyon, release namespace'inin dışında); driver `coordinationScope` beyan ediyor; store arızası `in-flight` değil `unavailable` |
| 6.2 ✅  | Early Hints (103)           | ✅    | Cache'ten servis edilmeyen her render'da (MISS **ve** BYPASS), render'dan hemen önce; varsayılan kapalı                                                                                                                                               |
| 3.2 ✅  | `routeRules`                | ✅    | Sıralı tablo, sonraki kazanır; korumalı header'lar + 0.7.58: gerçek rest deseni (`/:path*` artık `/` ve derin yolları da kapsıyor)                                                                                                                    |
| 3.3 ◐   | Harici cache driver         | ◐     | `registerCacheDriver` = unstorage'ın (b) yarısı; artık `coordinationScope` da beyan ediyor. İsimli genel KV (`useStorage("sessions")`) hâlâ yok — ayrı madde                                                                                          |
| 4.4 ⛔  | OpenAPI üretimi             | ⛔    | **Kasıtlı hayır** — madde yanlış dosyayı işaret ediyordu; gerçek risk gateway contract kapsamıydı, o kapatıldı                                                                                                                                        |
| 7.2 ✅  | Layers / extends            | ✅    | Üç kopya pakete taşındı, `origin-doctor --drift` ıraksamayı ölçüyor. Runtime kalıtım kasıtlı olarak yok                                                                                                                                               |
| 9.3 ⛔  | WinterTC kısıtı             | ⛔    | **Kasıtlı hayır** — Node bağı yaprakta değil temelde (server, redis, otel). Ölçüm `origin-shared`'ın Node-free sınırını buldu, o korumaya alındı                                                                                                      |
| 10.1 ⛔ | Vite Environment API        | ⛔    | **Kasıtlı hayır** — SSR dev'de Vite'tan geçmiyor, başlık özelliği kullanılmıyor. Tek gerçek tekrar olan alias haritası tek kaynağa indi                                                                                                               |

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

- **4.4 Route'lardan OpenAPI üretimi** — kendi `/api` uçlarımızın istemcisi kendi island'larımız ve
  4.1 onlara tipi kaynaktan veriyor; üretilmiş bir belgenin okuyucusu yok. Birlikte derlemediğimiz
  bir istemci (mobil, partner) çıkarsa yeniden bakılır. Ayrıntı ve maddenin neden yanlış teşhis
  olduğu: § 4.4.
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
- **9.3 WinterTC kısıtı** — ölçüldü: Node bağı yaprak dosyalarda değil, temelde (`@hono/node-server`,
  `ioredis`, `@opentelemetry/sdk-node`). `src/**` üzerine kurulacak bir kural kolay %5'i korur ve
  yanlış bir taşınabilirlik güveni üretir. Ölçümün bulduğu gerçek sınır — `origin-shared`'ın
  Node-free olması — korumaya alındı. Ayrıntı: § 9.3.
- **10.1 Vite Environment API** — SSR bundle'ımız dev'de Vite'tan hiç geçmiyor, yani API'nin asıl
  vaadi (runtime-agnostik runner, workerd paritesi) bizde karşılıksız. İki config'in paylaştığı tek
  şey alias haritasıydı ve o tek kaynağa indi. Vite mevcut API'yi deprecate ederse yeniden açılır.
  Ayrıntı: § 10.1.

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
