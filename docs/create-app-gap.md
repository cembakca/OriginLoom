# `create-app` ile showroom arasındaki fark

Showroom platformun her yeteneğini kullanan referans üründür; `origin-create-app` ise çalışan ama
ince bir iskelet üretir. Bu belge farkı **tek tek** çıkarır ve her kalem için "üretilene eklensin
mi" kararını kayda geçirir.

Ölçüm (2026-07-27): showroom `server/` altında 55 dosya, üretilen app'te 12. Showroom'un
`@originloom/core`'dan kullandığı 19 modül üretilen şablonlarda hiç geçmiyor.

---

> **Durum (2026-08):** A1–A11, B (`--with-ops`), C1–C3 tamamlandı — aşağıda ✅ ile işaretli.
> Bölüm D showroom'a özgü içerikleri bilinçli olarak şablona taşımama listesidir.
> `--with-ops` compose runtime (`pnpm compose:up`) ilk Docker ortamında ayrıca doğrulanmalıdır
> ([mock-gateway.md](./mock-gateway.md), [template-changes.md](./template-changes.md)).

## A. Platform yeteneği var, örneği yok → **eklenmeli**

Bunlar platformun sunduğu ama üretilen uygulamada hiçbir izi olmayan şeyler. Sonuç: ekip özelliğin
var olduğunu bilmiyor ya da sıfırdan, yanlış kuruyor.

### A1. Gateway'den veri çekme — **en kritik** ✅ yapıldı

|                   | Showroom                                                                 | Üretilen app                          |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| Çağrı             | `gatewayFetch` (`@originloom/core/adapters/gateway`)                     | yok                                   |
| Payload doğrulama | `readGatewayJson` + `requireGatewayPayload`                              | yok                                   |
| Runtime guard'lar | `services/gateway-guards.ts` (`isRecord`, `isString`, `MAX_COLLECTION`…) | yok                                   |
| Örnek servis      | `services/financial-products.ts`                                         | `services/items.ts` — bellekteki dizi |

Üretilen app'in hiçbir loader'ı upstream'e gitmiyor; `.env`'deki `GATEWAY_URL` kullanılmıyor ve
`origin-dev` her açılışta "Gateway: … (start it yourself)" yazıyor. Yani platformun **en çok
kullanılacak** yeteneğinin örneği yok.

### A2. Mock gateway (upstream olmadan geliştirme) ✅ yapıldı

Showroom `tests/fixtures/gateway/` altında 14 dosyalık bir mock GW taşır (`pnpm mock-gw`) ve smoke
testi bununla hermetik çalışır. Üretilen app'te yok → A1'i eklersek ekip ilk gün "gateway nerede"
sorusuna çarpar.

### A3. SEO route'ları — robots.txt / sitemap.xml ✅ yapıldı

Showroom `server/seo.ts` + `services/sitemap.ts` ile `mounts.seo` üzerinden mount ederdi; üretilen
app'te yoktu.

**Çözüm:** mekanik `@originloom/core/seo`'ya taşındı (`mountSeoRoutes` — header'lar, cache,
XML escape, kaynak çökerse fallback). İçerik uygulamada: üretilen app sitemap'i kendi gateway
verisinden kuruyor, showroom da aynı platform mount'unu kullanıyor.

### A4. Cache purge API ✅ yapıldı

`@originloom/core/cache/purge` vardı ama HTTP yüzeyi showroom'daydı; üretilen app'te hiç yoktu.

**Çözüm:** `@originloom/core/api/cache-purge` → `mountCachePurgeApi`. Üretilen app bunu
**operations portunda** mount ediyor (showroom'un yaptığı gibi), public sitede değil — secret'la
korunsa bile internete açık bir purge ucu DoS kaldıracıdır. `CACHE_PURGE_SECRET` core config'e
taşındı; production'da secret yoksa uç 503 döner.

### A5. Ürün metrikleri ✅ yapıldı

`OriginRuntime.metricSources` alanı ve `@originloom/core/metrics/primitives` ile uygulama kendi
metriklerini `/metrics` çıktısına ekleyebiliyor; üretilen app hiç kullanmıyordu.

**Çözüm:** `server/metrics/catalog.ts` örneği — katalog görüntülemelerini sayar ve `metricSources`
ile bağlanır. Örnek, label kardinalitesi dersini de veriyor: sayfa numarası etiketlenmiyor,
bucket'lanıyor (`first`/`early`/`deep`).

### A6. Ürün env'i ve doğrulaması ✅ yapıldı

Showroom `server/product/config.ts` içinde kendi env'ini okur ve `validateConfig`'e ek doğrulama
geçerdi; üretilen app'te kalıp yoktu.

**Çözüm:** üretilen app `server/product/config.ts` + `validateConfig([validateProductConfig])` ile
geliyor. Örnek ayar dekoratif değil — `CATALOG_PAGE_SIZE` katalog sayfasını gerçekten sürüyor
(3 → 3 ürün, 5 → 5 ürün) ve `0` verilince sunucu **başlangıçta** hata verip duruyor.

### A7. OpenTelemetry ✅ yapıldı

**Çözüm:** üretilen `server/index.ts` başta `register()` çağırıyor, kapanışta ve başlatma hatasında
`shutdownInstrumentation()` ile kapatıyor; `server started` logu artık `tracingEnabled` taşıyor.
OTLP endpoint tanımlı olmadıkça SDK no-op kaldığı için lokalde bedeli yok. `.env.development`
kapalı örnekleri gösteriyor (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`).

### A8. Auth akışı örneği ✅ yapıldı

BFF yapıştırıcısı showroom'daydı ama içinde tek bir ürün bilgisi yoktu — hepsi core primitifleri
üzerine kuruluydu. **Çözüm:** `@originloom/core/auth/bff`'e taşındı (`authenticateBffRequest`,
`forceTokenRefresh`, `confirmBffSession`, `challengeBffSession`, `rejectBffSession`,
`withBffAuthCookies`); showroom artık oradan tüketiyor.

Üretilen app buna dayanan tam bir örnek taşıyor: `server/api/session.ts` (`GET /api/session`,
`POST /api/session/refresh`, `guardPublicApi` ile korunuyor, `private, no-store`),
`server/services/profile.ts` (üç sonuçlu `ok | unauthorized | unavailable` — "bilinmiyor",
"çıkış yapıldı" demek değil) ve mock gateway'de `/user/profile`. `account` route'unun defer
island'ı artık saat değil, gerçek oturumu gösteriyor: yüklenirken / girişli / girişsiz /
bilinmiyor. Doğrulandı: çerezsiz `{"signedIn":false}` 401, `access_token` çereziyle profil 200.

### A9. Güvenlik yardımcıları ✅ yapıldı

`security/rate-limit`, `security/public-api-guard`, `security/secrets` showroom'da kullanılıyordu;
üretilen app'te hiç geçmiyordu.

**Çözüm:** `server/api/items.ts` — `guardPublicApi` ile korunan public bir JSON ucu (global + IP
limiti, cross-origin yazma reddi). Doğrulandı: 65 istekte 58×200, 7×429 + `retry-after`.
`registerCspScriptHashes` eklenmedi — üretilen app'te inline script yok, ölü kod olurdu; skill'de
anlatılıyor.

### A11. Yapılanların örnekteki karşılığı ✅ yapıldı

Pipeline'lar vardı ama üretilen app'te kullanan yoktu: `pnpm media` responsive varyantlar
üretiyordu, hiçbir sayfa `responsiveImage()` çağırmıyordu; CSP seam'i açılmıştı, hiçbir uygulama
kendi origin'ini bildirmiyordu; script sıralayıcı yazılmıştı, örneği yoktu.

**Çözüm:**

- **Hero görseli** ana sayfada: `responsiveImage("hero")` + `preloadImages` + `sizes`. Tarayıcı
  1280 px'te tek dosya indiriyor (960 avif) ve preload tam o adayı işaret ediyor.
- **`/media` demo sayfası** — showroom'un `/medya-pipeline` sayfasının karşılığı: aynı kaynak
  görselin responsive ve dönüşümsüz teslimi yan yana, `IMAGE_CDN_URL` / `IMAGE_TRANSFORM_URL`
  durum rozetleriyle ve üretilen srcset'in kendisi ekranda. `noindex` — teknik demonun arama
  sonuçlarında işi yok.
- **CDN yolu** env ile: `IMAGE_TRANSFORM_URL` verilince aynı sayfa hiç değişmeden CDN URL'leri
  üretiyor, CSP `img-src`'ye origin'ler kendiliğinden ekleniyor.
- **Sıralı analytics** (`server/product/analytics.ts`): consent → dataLayer → tag → kendi beacon'ın.
  Mock gateway consent aracını canlandırıyor, yani zincir dev'de gerçekten çalışıyor;
  `createApp({ csp })` satıcı origin'ini bildiriyor.

Bu tur şablonlarda üç kez import sırası hatası çıktı — şablon bir string olduğu için bu repo'nun
lint'i içine bakmıyor, yalnız üretilen app'in CI'ı yakalıyor. Artık şablon testi hem modül hem de
süslü parantez içi isim sırasını doğruluyor.

### A10. Medya / ikon pipeline ✅ yapıldı

`pnpm icons` (SVG → bileşen) ve `pnpm media` (görsel/font manifest'i) showroom'da script'ti;
üretilen app'te ikisi de yoktu.

**Çözüm:** her iki renderer'a `pnpm media` + örnek kaynak (OG görseli, brand mark) ve
`server/media.config.json`; `pnpm icons` SVGR ile React bileşeni üretir.
Bu sırada bir platform sızıntısı daha çıktı: `build-media.mjs` Inter'in lisans dosyasını
`node_modules/@fontsource-variable/inter/LICENSE`'tan **sabit** kopyalıyordu — font seçimi uygulamanın
işi olduğu için lisans yolu artık config'teki `fonts[].license` alanından geliyor.

---

## B. Ops varlıkları → **`--with-ops` bayrağı ile** ✅ yapıldı

Hepsini her uygulamaya basmak şişkinlik yaratırdı; kimsenin okumadığı yirmi YAML dosyası hiçbir şey
öğretmez. Bu yüzden opt-in: `origin-create-app odeme-web --with-ops`.

| Varlık                               | Showroom                     | Üretilen app                                                              |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------- |
| `Dockerfile`                         | var                          | **var** (bayraksız da)                                                    |
| CI workflow                          | repo kökünde                 | **var** (bayraksız da)                                                    |
| `docker-compose.yml` + redis overlay | var                          | **`--with-ops`**                                                          |
| k8s manifestleri                     | 12 dosya                     | **`--with-ops`** — 12 dosya                                               |
| load-test                            | 8 dosyalık paket             | **`--with-ops`** — tek dosyalık kapalı döngü üreteci                      |
| Redis ile lokal çalışma              | `dev:redis`, `compose:redis` | **`--with-ops`** — aynı script'ler                                        |
| pentest scriptleri                   | `scripts/`                   | **yok** — showroom'un kendi hazırlık kontrolleri, platform yeteneği değil |

Taşırken ürün sızıntıları ayıklandı: showroom'un configmap'indeki `MARKET_STREAM_*` ve
`BOT_ANALYTICS_*` anahtarları ile aynı alan adlarına dayanan alarm kuralları çıkarıldı. Kalan
alarmlar platformun kendi metriklerine bakıyor (`ssr_cache_cardinality_overflow_total`,
`ssr_render_rejected_total`, `ssr_gateway_invalid_payload_total` …), yani her uygulamada çalışır.

`OPERATIONS.md` de üretiliyor: uygulamadan önce mutlaka değiştirilmesi gerekenler (imaj digest'i,
host adları, secret'lar), iki portun neden ayrı olduğu ve `RELEASE_ID`'nin cache'i neden isim
alanına ayırdığı.

Doğrulandı: 14 YAML dosyasının hepsi geçerli; üretilen app `--with-ops` ile kendi CI'ını geçiyor;
yük aracı gerçek bir production build'e karşı 3730 istek/s, p50 1.9 ms, %100 cache HIT ölçtü ve
sunucu kapalıyken çökmek yerine ne yapılması gerektiğini söyleyip 1 ile çıkıyor.

**Denenmedi:** `pnpm compose:up` / `compose:redis` — bu makinede Docker daemon çalışmıyor. Compose
dosyaları geçerli YAML ve tooling'in beklediği adlarda, ama ilk çalıştıran doğrulamalı.

---

## C. Platformda düzeltilmesi gereken sızıntı

### C1. `gateway-payload` showroom'un domain'lerini hardcode ediyor ✅ çözüldü

`packages/origin-core/src/gateway-payload.ts` içindeki `GatewayPayloadContract` kapalı bir union:

```ts
"account" |
  "auth_refresh" |
  "blogs" |
  "credit_cards" |
  "finance_referral" |
  "finance_tools" |
  "housing_loans" |
  "knowledge_center" |
  "markets" |
  "popular_blogs" |
  "menu" |
  "offers" |
  "page" |
  "profile" |
  "redirect" |
  "route_domains" |
  "sitemap";
```

Byte bütçeleri de aynı listeye bağlıydı; yeni bir ürün kendi contract'ını platformu değiştirmeden
ekleyemiyordu.

**Çözüm:** contract artık bir nesne ve uygulama tanımlıyor —
`defineGatewayContract(name, maxBytes)`. Showroom kendi 15 contract'ını
`server/services/gateway-contracts.ts` içinde topladı; platformun kendi gateway çağrıları
(auth refresh, CMS redirect) de kendi contract'larını tanımlıyor. Core'da tek bir ürün domain adı
kalmadı. Kayıt defteri yerine nesne tercih edildi: "kaydetmeyi unutma" diye bir hata durumu yok.

### C3. `request-deadline` showroom'un uçlarını hardcode ediyordu ✅ çözüldü

`packages/origin-core/src/middleware/request-deadline.ts` içinde iki sabit liste vardı:
`KNOWN_API_ROUTES` (`/api/referrals`, `/api/finance/loan-calculation`, `/api/markets/stream` …) ve
`LONG_LIVED_API_ROUTES`. Üretilen app'in `/api/items`, `/api/session` uçları listede olmadığı için
**sayfa** sayılıyordu: render zaman bütçesi alıyor, aşırı gövdede JSON yerine düz metin dönüyor ve
timeout metriğinde `class="ssr"` olarak görünüyorlardı.

**Çözüm — üç ayrı soru, üç ayrı cevap:**

1. **Sınıflandırma** artık konvansiyondan okunuyor: `/api/` altındaki her şey API. Açıkça
   yapılandırılmış bir proxy kuralı bunu geçer — o belirli bir yol hakkında bilinçli bir ifade,
   prefix ise yalnızca konvansiyon.
2. **Uzun ömürlü uçlar** (SSE, long poll) platformun tahmin edebileceği bir şey değil, o yüzden
   `createApp({ longLivedRoutes })` ile uygulama söylüyor. Showroom `/api/markets/stream`,
   üretilen app `/api/ticks` beyan ediyor.
3. **Metrik etiketi** app'in kendi route tablosundan türetiliyor: `createApp` mount işlemi bittikten
   sonra `app.routes` üzerinden somut `/api` yollarını topluyor. Beyan istemek yerine türetmek,
   "kaydetmeyi unuttum" hatasını ortadan kaldırıyor; sınır ise korunuyor — mount edilmemiş bir yol
   `/api/<unmatched>` kovasına düşüyor, yoksa herhangi bir çağıran sınırsız time series üretebilirdi.

Doğrulandı: üretilen app'te aşırı gövde `/api/items` için JSON 413, sayfa yolunda düz metin;
üç rastgele `/api/...` isteği tek etikette toplanıyor.

### C2. `.env` görünürlüğü ✅ yapıldı

**Çözüm:** üretilen `.env.development`'a "Platform knobs" bölümü eklendi — upstream/render
bütçeleri, render admission (concurrency/queue/shed), cache boyutu, `CSP_ENFORCE`, `TRUST_PROXY`,
shutdown bütçesi ve tracing. Hepsi **yorumlu** ve core'daki varsayılan değerle yazılı: ekip hangi
düğmelerin var olduğunu görüyor, ama kopyalayıp varsayılanı dondurmuş olmuyor.

---

## D. Doğru şekilde yok — eklenmemeli

Bunlar showroom'un ürün içeriği; platform yeteneği değil:

- Finansal domain servisleri (kredi kartı, konut kredisi, piyasa verisi, bilgi merkezi)
- Market-stream SSE hub'ı ve admission kontrolü
- Referral akışı ve istatistik ucu
- GTM/dataLayer bootstrap, site doğrulama meta'ları (google/bing/yandex)
- Bot analytics dispatcher
- Showroom'a özgü routing kuralları, cache-key registry içeriği, Türkçe içerik

---

## Öneri: iki aşama

**Aşama 1 — "gerçek bir ürün gibi" iskelet (A1-A5 + C1)**
Gateway'den veri çeken bir route, mock gateway, SEO uçları, cache purge ve ürün metriği. Bunlar
birlikte "bu platformla gerçek bir ürün nasıl yazılır" sorusunu cevaplar. C1 önce çözülmeli, yoksa
A1 örneği platformu düzenlemeden yazılamaz.

**Aşama 2 — opsiyoneller (A6-A10 + B)**
Ürün config'i, OTel, auth örneği, güvenlik yardımcıları, medya pipeline'ı ve ops varlıkları.
Bayrakla (`--with-ops`) veya belgeye referansla verilebilir.
