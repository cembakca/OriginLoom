# OriginLoom

Hono üzerine kurulu, meta-framework kullanmayan full-document SSR altyapısı. Sunucu çekirdeği UI
framework'ünden bağımsızdır; React 19 desteği takılabilir bir render adaptörü olarak gelir.

Mimari kararların gerekçesi ve Next.js’ten geçişin teknik hikâyesi için
[makale serisi indeksine](docs/articles/README.md) bakın. **15+ ürün / Next migration organizasyonu**
için [çok ürünlü adoption rehberi](docs/multi-product-adoption.md); platform üstüne yeni bir ürün
uygulaması eklemek için [new-product-app.md](docs/new-product-app.md). Production güvenlik kabulü, secret rotation
ve incident adımları [production security runbook'unda](docs/production-security.md) tutulur.
Paketlerin sürümlenmesi ve yayın hattı için [releasing.md](docs/releasing.md).

## Mimari

Bir sayfa isteği sırasıyla şu katmanlardan geçer:

1. Hono request-id ve güvenlik middleware'lerini çalıştırır.
2. Auth, session ve CMS redirection pipeline'ı request'i zenginleştirir.
3. Routing katmanı redirect, internal rewrite veya explicit external rewrite kararı verir; gateway
   browser yüzeyi wildcard proxy yerine BFF handler'larıyla açılır.
4. Route cache policy hesaplanır; uygun GET isteğinde HTML cache okunur.
5. MISS durumunda loader çalışır ve kurulu renderer document'ı üretir (showroom'da React).
6. Etkileşimli alanlar bağımsız island chunk'ları olarak hydrate/mount edilir.

## Dizinler

```text
packages/
  origin-shared/  Framework-nötr taban (@originloom/shared)
    src/lib/        Route/Ctx tipleri, metadata motoru, device/media/menu yardımcıları
    src/routing/    Rewrite/redirect resolution engine
    src/render.ts   OriginRenderer — UI framework seam'i
  origin-core/    Platform sunucu runtime'ı (@originloom/core) — React bağımlılığı yok
    src/adapters/   Gateway gibi dış sistem adapter'ları
    src/cache/      Katmanlı L1 memory + opsiyonel L2 Redis, Pub/Sub invalidation
    src/middleware/ Request pipeline adımları
    src/ssr/        Request çözümleme, cache/loader ve response orkestrasyonu
    src/handler.ts  SSR pipeline'ın ince giriş noktası
    src/document.ts Document render orkestrasyonu (HTML'i renderer üretir)
    src/runtime.ts  Ürünün platforma verdiği kontrat (renderer, fragment, shell, metrik)
  origin-react/   React adaptörü: island runtime + Vite preset (@originloom/react)
    src/server/     createReactRenderer — OriginRenderer'ın React implementasyonu
  origin-vanilla/ Framework'süz adaptör (@originloom/vanilla)
    src/html.ts     html`` tagged template — otomatik escape
    src/server/     createHtmlRenderer — OriginRenderer'ın string implementasyonu
  origin-tooling/ build/dev/env/compose/smoke bin'leri (@originloom/tooling)

apps/
  showroom/       Referans ürün uygulaması
    server/routes/    Loader, cache ve metadata içeren SSR route tanımları
    server/api/       Public ve internal BFF endpointleri
    server/services/  Server-only veri orkestrasyonu
    server/product/   Platforma enjekte edilen ürün kontratı (runtime, renderer, fragment, document shell)
    src/features/     Route'ların feature bazlı SSR-safe sunum/shell bileşenleri
    src/islands/      Client-side etkileşim giriş noktaları
    src/components/   SSR-safe UI bileşenleri
    src/lib/          Ürüne özel tip, kontrat ve yardımcılar (cache-keys dahil)
    tests/            src ve server yapısını izleyen Vitest testleri

tools/
  mock-gw/        Bağımsız mock gateway (dev/test aracı)
```

## Workspace

Repo bir pnpm workspace'idir: platform paketleri (`packages/*`) bir kez yazılır, ürün uygulamaları
(`apps/*`) bunları `workspace:*` bağımlılığı olarak tüketir ve ayrı deploy edilir. Paketler kaynak
`.ts` export eder; ayrı bir derleme adımı yoktur — Vite/tsx/Vitest/tsc kaynağı doğrudan çözer.
Bağımlılık yönü tek yönlüdür: `showroom → {core, renderer} → shared`. `core`, `react` ve `vanilla`
birbirini import etmez — ikisi de `@originloom/shared`'daki kontratlara yaslanır, böylece sunucu runtime'ı
UI framework'ünden bağımsız kalır. Ters yöndeki bir import ya da core/shared içinde bir React
specifier'ı `pnpm check:cycles` tarafından reddedilir.

### Paketleme ve sürüm

Beş `@originloom/*` paketi **sabit grup**: hep aynı sürümü paylaşır ve birlikte çıkar (birbirlerine
tam sürümle bağlılar, kısmi bir yayın tüketiciyi çözülemez bir kümeyle bırakır).

```bash
pnpm changeset          # değişiklik notu ekle (PR ile birlikte commit'lenir)
pnpm changeset:version  # beş paketi birlikte yükselt, CHANGELOG yaz
pnpm release:verify     # yerel Verdaccio'ya yayınla, temiz bir app'e kur, build + smoke
```

`release:verify` kapıdır: paketleri workspace'ten değil **registry'den** kurup uygulamayı ayağa
kaldırır — `dist` derlemesi, `publishConfig.exports` haritası ve paketler arası sürümler ancak orada
buluşur. CI'da her PR'da hem react hem vanilla için koşar.

Gerçek bir registry'ye yayın **henüz bağlı değil**: her pakette `publishConfig.registry` yerel
Verdaccio'yu gösterir, yani buradaki hiçbir komut kazayla npmjs'e ulaşamaz. Sürümleme kararları,
provanın adım adım ne yaptığı ve gerçek yayına geçerken yapılacaklar listesi:
[docs/releasing.md](docs/releasing.md).

Kök komutlar tüm workspace'i kapsar:

```bash
pnpm install
pnpm dev            # apps/showroom dev stack (Vite + mock gateway + SSR server)
pnpm build          # apps/showroom production build
pnpm test           # tüm projeler (vitest projects)
pnpm ci             # typecheck + cycles + lint + format + coverage + build + smoke
pnpm create-app     # yeni ürün uygulaması üretir (standalone; --workspace ile apps/<ad>)
                    # varsayılan renderer React; --vanilla ile UI framework'süz app
```

Aşağıdaki tablodaki uygulama komutları showroom kapsamındadır; kökten
`pnpm --filter showroom <komut>` ile ya da `apps/showroom` dizininden çalıştırılır.

## Route kontratı

```ts
type Route<T> = {
  path: string;
  cache?: (ctx: Ctx) => CachePolicy;
  loader: (ctx: Ctx) => Promise<{ data: T; status?: number }>;
  Component: (props: { data: T }) => ReactElement;
};
```

Cache key yalnızca normalize edilmiş, HTML çıktısını gerçekten değiştiren değerlerden oluşturulmalıdır. Auth token veya kullanıcıya özel veri ortak HTML cache'e girmez.

## Finans referans route'ları

| Public path                   | Mimari örnek                                             | HTML cache                       |
| ----------------------------- | -------------------------------------------------------- | -------------------------------- |
| `/konut-kredisi`              | Filtreli/paginated ürün kataloğu ve internal rewrite     | Shared, içerik query'leri key'de |
| `/kredi-kartlari/:slug`       | React 19 streaming kampanya sınırı                       | Yok                              |
| `/araclar/kredi-hesaplama`    | SSR + `hydrate` island + same-origin hesaplama BFF'i     | Yok; yüksek query cardinality    |
| `/karsilastir/kredi-kartlari` | 2–3 ürünlü, noindex ve canonical query karşılaştırması   | Yok; seçime özel HTML            |
| `/bankalar/:slug`             | Düşük cardinality'li banka/ürün profili ve banka JSON-LD | Shared, 15 dakika                |
| `/piyasalar/bist-100`         | Cache'li SSR snapshot + güvenli SSE güncellemesi         | Shared, kısa TTL                 |

Mock gateway içerik doğruluğunu değil HTTP, payload, güven ve yaşam döngüsü kontratlarını temsil eder.
Hesaplama formülü client bundle'ına kopyalanmaz: ilk sonuç SSR loader'ında, hydrate sonrası sonuç
`/api/finance/loan-calculation` BFF'i üzerinden gateway'de hesaplanır. JavaScript kapalı form da aynı
public GET route'u üzerinden çalışır.

## Geliştirme

Node.js 22.12 veya daha yeni bir sürüm gerekir.

Ortam yapılandırması `.env.development`, `.env.staging` ve `.env.production` dosyalarıyla
yönetilir. Kişisel override'lar için `.env.local` (veya `.env.<ortam>.local`) kullanın; shell
değişkenleri dosyalardan önceliklidir.

| Komut                            | Ortam dosyası                                 | Cache   | Açıklama                                                  |
| -------------------------------- | --------------------------------------------- | ------- | --------------------------------------------------------- |
| `pnpm dev`                       | `.env.development`                            | L1-only | Günlük geliştirme — Redis gerekmez                        |
| `pnpm dev:redis`                 | `.env.development` + `.env.development.redis` | L1+L2   | Docker Redis ile dağıtık cache testi                      |
| `pnpm compose:up`                | `.env.production` (Docker)                    | L1-only | Foreground stack; Ctrl+C sonrası container'lar kaldırılır |
| `pnpm compose:redis`             | + Redis overlay                               | L1+L2   | Redis overlay ile stack; çıkışta `compose down`           |
| `pnpm compose:clean`             | —                                             | —       | Dev + load-test compose container'larını kaldırır         |
| `pnpm start:local`               | `.env.production` + local mock gateway        | L1-only | **Yerel dry-run**: prod build, gerçek altyapı yok         |
| `pnpm start:local:redis`         | `.env.production` + local mock gateway        | L1+L2   | **Yerel dry-run**: + Docker Redis, gerçek altyapı yok     |
| `pnpm start:staging:local`       | `.env.staging` + local mock gateway           | L1-only | **Yerel dry-run**: staging config, gerçek altyapı yok     |
| `pnpm start:staging:local:redis` | `.env.staging` + local mock gateway           | L1+L2   | **Yerel dry-run**: + Docker Redis, gerçek altyapı yok     |
| `pnpm start:memory`              | `.env.production` + memory overlay            | L1-only | Gerçek production build, Redis'siz tek pod deploy         |
| `pnpm start:staging`             | `.env.staging`                                | redis   | Gerçek staging bundle (gerçek altyapıya bağlanır)         |
| `pnpm start`                     | `.env.production`                             | redis   | Gerçek production bundle (gerçek altyapıya bağlanır)      |

`start:local*` ve `start:staging:local*` komutları `pnpm build` sonrası prod bundle'ı **yerel
mock gateway'e** karşı çalıştırır — `GATEWAY_URL`/`SITE_URL` her zaman `127.0.0.1`'e zorlanır, staging/
production `.env` dosyalarındaki gerçek adresler asla kullanılmaz. `:redis` varyantı
`docker-compose.redis.yml`'deki `redis` servisini otomatik ayağa kaldırır. Bunlar yalnız yerel
doğrulama/test amaçlıdır; gerçek deploy her zaman `start`, `start:staging` veya `start:memory`
kullanır ve altyapı adreslerini/secret'ları ortam değişkenlerinden veya secret manager'dan alır.

```bash
pnpm install
pnpm dev
```

Bu komut uygulamayı `http://127.0.0.1:3005`, bağımsız mock gateway'i ise
`http://127.0.0.1:4002` adresinde çalıştırır. Client modülleri `http://127.0.0.1:5174`
üzerindeki gerçek Vite development server'dan gelir. Browser'da bu adresi açın —
`localhost` ile `127.0.0.1` karışımı CSS/asset gecikmesine yol açabilir.

Development modunda Tailwind CSS, `<head>` içinde Vite üzerinden blocking stylesheet
olarak yüklenir; böylece full reload'da layout kayması (FOUC) oluşmaz.
Cache in-memory çalışır; process restart sonrası sıfırlanır.

- `src/islands` ve client bağımlılıkları React Fast Refresh ile state'i koruyarak güncellenir.
- Server/SSR dosyaları `tsx watch` ile kontrollü restart olur; Hono hazır olduğunda browser tam
  document reload yapar.
- Development sırasında `dist/client` veya manifest yeniden üretilmez.
- Production build hâlâ hashed asset ve `.vite/manifest.json` kullanır.

## Island module preload

Production SSR document'i Vite manifestindeki recursive static import grafiğini okuyarak ana client
entry, `layout-client`, `page-analytics` ve bunların shared dependency'leri için
`<link rel="modulepreload">` üretir. Böylece browser, her sayfada hemen çalışacağı bilinen bu island
chunk'larını `entry.client` çalıştıktan sonra keşfetmek yerine HTML head parse edilirken indirmeye
başlayabilir.

Bu optimizasyon JavaScript miktarını azaltmaz; gerekli eager modüllerin network waterfall'ını kısaltır.
`mobile-menu`, `footer-accordion` ve diğer viewport/deferred island'lar preload edilmez, lazy
davranışlarını korur. İlk yükte gerçekten kritik olan route island'ları açıkça eklenebilir:

```ts
defineRoute({
  path: "/kredi-hesaplama",
  preloadIslands: ["market-live"],
  // loader, Component...
});
```

`preloadIslands` yalnız indirmeyi erkene alır; island'ı çalıştırmaz. Client'ta hemen mount edilmesi
gerekiyorsa ilgili `<Island>` ayrıca `eager` olmalıdır. Ayrıntılı ağ akışı, trade-off ve ölçüm rehberi
için [Vite Manifest ile Island Preload](docs/articles/07-vite-manifest-ile-island-modulepreload.md)
yazısına bakın.

Gateway'i tek başına başlatmak için:

```bash
pnpm mock-gw
```

Çalışan CMS redirect/query merge örneği:

```text
http://127.0.0.1:3005/eski-konut-kredisi?q=kredi&source=incoming
  → 301
http://127.0.0.1:3005/konut-kredisi?q=kredi&source=legacy
```

Mock destination içindeki `source=legacy` incoming değeri ezer; `q=kredi` korunur ve CMS
destination fragment'i redirect sonucuna taşınmaz.

Redis/SWR/purge davranışını production'a yakın test etmek için (opsiyonel):

```bash
pnpm dev:redis
```

Bu script önce Compose'taki `app` ve `mock-gw` container'larını durdurur, yalnızca Redis'i
`docker compose up -d --wait redis` ile hazırlar, `.env.development.redis` overlay'ini uygular ve
sonra `pnpm dev` çalıştırır. Script kapatıldığında (Ctrl+C) Redis container'ı da kaldırılır; kalıntı
temizliği için `pnpm compose:clean` kullanın.

`dev:local`, `dev:redis` için geriye dönük alias'tır.

## Embedded JSON ve crawl kontratı

Island hydration prop'ları crawler-visible HTML'e yazılmadan önce `serializeEmbeddedJson()` ile
serialize edilir. Route-benzeri `/...` değerleri JSON'un geçerli `\/` escape'iyle çıkar; browser
`JSON.parse` sırasında bunları otomatik olarak tekrar `/...` haline getirir. Böylece gerçek
`<a href>` linkleri değişmeden kalırken `data-props` içindeki publicPath, pathname, menu URL ve içerik
alanları ikinci bir URL inventory'si oluşturmaz.

Serializer ayrıca `<`, `>`, `&`, U+2028 ve U+2029 karakterlerini güvenli JSON escape'lerine çevirir.
Bu kural yalnız HTML'e embedded JSON içindir; API body, Redis ve log serialization'ına uygulanmaz.

## Redis ve HTTP cache sınırı

Redis (L2), origin içindeki SSR HTML body cache'idir — her podda L1 memory her zaman önce okunur.
Sıcak L1 hit'te request başına Redis round-trip yapılmaz. Bir route L1 veya L2'den `HIT` dönse bile HTML response'u
varsayılan olarak `Cache-Control: private, no-cache, max-age=0` taşır; downstream CDN kendiliğinden
ikinci bir HTML cache katmanına dönüşmez. Finalization sırasında herhangi bir `Set-Cookie` eklenirse
response zorunlu `private, no-store` olur. Hash'li statik asset'lerin immutable CDN cache'i bu
kontrattan bağımsızdır.

Redis'e yazılan tam HTML document'leri Brotli'nin UTF-8 `TEXT` mode'u, quality 8, 512 KiB window ve
gerçek body size hint'iyle sıkıştırılır. Bu generic bir “her cache değerini sıkıştır” politikası
değildir: 1 KiB altındaki değerler, JSON/service cache payload'ları ve raw halinden küçük olmayan
çıktılar sıkıştırılmaz. Binary frame `getBuffer()` ile okunur; legacy JSON entry'ler mevcut TTL'leri
boyunca desteklenir. Ayrı dictionary veya manuel regeneration adımı yoktur. Tasarım ve wire format için
[Redis HTML Cache'i İçin HTML-Odaklı Brotli Sıkıştırma](docs/articles/08-redis-html-cache-icin-html-odakli-brotli-sikistirma.md)
yazısına bakın.

## Kontroller

```bash
pnpm typecheck
pnpm lint
pnpm format:check
ppnpm test
ppnpm test:coverage
pnpm build
ppnpm install
```

## Yük testi ve pentest hazırlığı

Docker üzerinde **2 vCPU / 4 GiB** sınırlı production build ile L1-only ve L1+Redis profil karşılaştırması:

```bash
pnpm loadtest:memory
pnpm loadtest:redis
pnpm loadtest:compare
```

Kapasite kırma (503/504 bilinçli): `pnpm stress:memory` / `pnpm stress:redis`. Kısa: `--quick`.

Kılavuz: [load-testing.md](docs/load-testing.md), [load-test/README.md](apps/showroom/load-test/README.md).

Staging pentest öncesi otomatik kontrol:

```bash
BASE_URL=https://staging.example.com pnpm pentest:readiness
```

Rehber: [pentest-prep.md](docs/pentest-prep.md), firmaya iletilecek şablon:
[pentest-brief-template.md](docs/pentest-brief-template.md).

## Gözlemlenebilirlik

`server/instrumentation.ts` process başına bir kez OpenTelemetry SDK'yı başlatır ve graceful
shutdown sırasında exporter'ı flush eder. Bir OTLP collector bağlamak için:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm dev
```

Her HTTP isteği inbound trace context'ini devralan bir server span üretir. Loader, SSR render,
gateway, cache/Redis ve SWR revalidation bunun altında child span olarak görünür. Gateway çağrıları
aktif W3C `traceparent`/`tracestate` context'ini ve `correlationid` olarak request ID'yi taşır.
Structured loglar `service`, `releaseId`, aktif `traceId` ve `spanId` alanlarını otomatik ekler.

`METRICS_PORT` üzerindeki `/metrics`, bounded-label Prometheus metrikleri sunar: request/cache/gateway/revalidation sayaç ve
latency histogramları, gateway timeout/error outcome'ları, bot analytics queue/drop/batch/drain
metrikleri, event-loop lag, CPU, heap/RSS, uptime ve release bilgisi. Cache write'ları ayrıca route
bazında body/key byte histogramı ile bounded distinct key observation gauge'i üretir; örnek alarmlar
`apps/showroom/k8s/prometheus-rules.yaml` içindedir. `requestId`, raw URL ve kullanıcı bilgisi metric label'ı
yapılmaz. Varsayılan operations listener `9090` portundadır; `/metrics`, cache purge ve referral stats
bu listener'dadır. `origin-loom-operations` ClusterIP servisi yalnız monitoring/operations namespace'lerine
NetworkPolicy ile açılır. Public application `Service` yalnız `3005` portunu yayınlar; public
`/metrics` ve operations endpoint'leri `404` döner.

Client runtime error ingestion'ı validation sonrası sampling, güvenilir client IP başına bounded
TTL/LRU limiter ve process-global son güvenlik freni uygular. Query değerleri atılır; bearer/JWT,
e-posta ve URL query değerleri loglanmadan önce redact edilir. IP loga veya metric label'ına girmez.
Ingress/WAF sınırı ile stack retention/RBAC zorunlulukları
[client telemetry politikası](docs/client-telemetry.md) belgesindedir.

## Image ve font pipeline

`pnpm media`, `apps/showroom/server/media.config.json` içindeki yerel görselleri build-time Sharp ile responsive
AVIF, WebP ve JPEG varyantlarına dönüştürür. Çıktılar içerik hash'li olarak
`dist/client/assets/media/` altına, boyut/format bilgisi ise `asset-pipeline.json` manifest'ine yazılır.
`ResponsiveImage` intrinsic `width`/`height` ve `sizes` olmadan kullanılamaz; normal görseller lazy,
LCP görselleri eager/high priority yüklenir. Route'un `preloadImages` callback'i LCP adayını document
head'e `imagesrcset`/`imagesizes` preload olarak taşır.

`IMAGE_CDN_URL=https://cdn.example.com/images` doğrudan dosya prefix'idir. Responsive build
varyantları ve `UnoptimizedImage` kaynakları bu prefix altında sunulabilir; unoptimized kullanım tek
`src` üretir, görseli yeniden encode etmez ve runtime proxy'ye sokmaz. Prefix'in path kısmı korunur.

Gerçek bir image transformation servisi varsa ayrıca
`IMAGE_TRANSFORM_URL=https://images.example.com/transform` tanımlanır. Builder endpoint'e encode
edilmiş `url`, `w`, `q` ve `format` query parametrelerini ekler. Vendor kontratı farklıysa yalnız
`buildImageCdnUrl()` adapter'ı değiştirilir. İki değişken bağımsızdır: CDN prefix kullanmak responsive
transformer kullanmayı zorunlu kılmaz.

Canlı karşılaştırma ve font weight/subset örnekleri `/medya-pipeline` sayfasındadır.

Inter variable font browser'da dış istek üretmeden self-host edilir. Build yalnız `latin` ve
`latin-ext` WOFF2 subsetlerini kopyalar, dosyaları hash'ler, preload ve `@font-face` tanımlarını
manifest üzerinden üretir; font lisansı build çıktısına dahildir.

## Ortam değişkenleri

Ortam dosyaları:

| Dosya                    | Kullanım                                 |
| ------------------------ | ---------------------------------------- |
| `.env.development`       | `pnpm dev` — L1-only, Redis gerekmez     |
| `.env.development.redis` | `pnpm dev:redis` overlay — L1+L2         |
| `.env.production.memory` | `pnpm start:memory` — tek pod production |
| `.env.development.redis` | `pnpm dev:redis` overlay'i               |
| `.env.staging`           | `pnpm start:staging`                     |
| `.env.production`        | `pnpm start` şablonu                     |
| `.env.local`             | Kişisel override (gitignore)             |

Temel değişkenler:

- `PORT` — HTTP portu, varsayılan `3005`
- `METRICS_PORT` — cluster-only metrics + operations listener'ı; varsayılan `9090`
- `GATEWAY_URL` — path/credential/query içermeyen backend origin'i; production varsayılan HTTPS
- `ALLOW_INSECURE_GATEWAY` — yalnız güvenilir internal HTTP gateway için açık production istisnası
- `CACHE_BACKEND` — `memory` (L1-only) veya `redis` (L1 + opsiyonel L2); production'da ikisi de geçerli
- `CACHE_REQUIRED` — yalnız _runtime_ Redis kesintisini yönetir: `true` ise başlangıç ping'i başarısız olursa process patlar ve sonraki kesintilerde readiness düşer; pub/sub subscriber kurulumu her zaman best-effort'tur ve bağlantı sağlanınca kendiliğinden toparlanır. `false` (varsayılan) L1-only fallback ile devam eder
- `REDIS_URL` — `CACHE_BACKEND=redis` iken _her zaman_ zorunlu (startup'ta doğrulanır); `CACHE_REQUIRED` bu kontrolü etkilemez — eksikse process hiç başlamaz
- `ALLOW_INSECURE_REDIS` — yalnız kontrollü internal ağ için açık production TLS istisnası
- `CACHE_MAX_ENTRIES` — L1 memory kapasitesi (her pod)
- `CACHE_PURGE_SECRET` — production purge endpoint yetkilendirmesi
- `REFERRAL_STATS_SECRET` — internal referral sayı/latency endpoint'i için operations token'ı
- `MARKET_STREAM_TOKEN` — BFF ile gateway canlı piyasa stream'i arasındaki server-only token
- `AUTH_REFRESH_COORDINATION_SECRET` — replica'lar arası şifreli refresh sonucu için ayrı 32+ karakter secret
- `AUTH_REFRESH_COORDINATION_PREVIOUS_SECRET` — kesintisiz key rotation sırasında geçici eski anahtar
- `AUTH_REFRESH_COORDINATION_TTL_MS` — refresh lock/sonuç paylaşım penceresi; gateway timeout'tan büyük olmalı
- `MARKET_STREAM_MAX_CONNECTIONS` / `MARKET_STREAM_MAX_CONNECTIONS_PER_IP` — process/IP aktif SSE kotası
- `MARKET_STREAM_MAX_SYMBOLS` — browser bağlantısı başına sembol üst sınırı
- `MENU_CACHE_TTL` / `MENU_CACHE_SWR` — menü cache süreleri
- `SITE_URL` — canonical URL tabanı
- `GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION` / `YANDEX_SITE_VERIFICATION` — isteğe bağlı webmaster doğrulama token'ları
- `RELEASE_ID` — release/Git SHA; Redis HTML cache namespace'i
- `OTEL_SERVICE_NAME` — trace ve metric service adı; varsayılan `origin-loom`
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP/HTTP collector adresi; yoksa tracing no-op kalır
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` — yalnız trace sinyali için tam OTLP endpoint'i
- `OTEL_TRACES_EXPORTER` — `otlp` veya `none`
- `OTEL_SDK_DISABLED` — varsayılan `false`; `true` ile OpenTelemetry SDK'yı tamamen kapatır
- `GATEWAY_TIMEOUT_MS` — gateway/proxy timeout'u
- `CACHE_FILL_TIMEOUT_MS` — cold miss loader + render toplam timeout bütçesi
- `CACHE_FILL_WAIT_MS` — başka pod'un cold fill sonucunu bekleme bütçesi
- `CACHE_FILL_POLL_MS` — distributed cold fill sırasında cache/lock polling aralığı
- `PROXY_BODY_LIMIT_BYTES` — public request/external rewrite gövdesi üst sınırı
- `TRUST_PROXY` — yalnızca güvenilir ingress arkasında forwarded IP çözümünü etkinleştirir
- `TRUSTED_PROXY_HOPS` — sağdan güvenilecek proxy hop sayısı
- `TRUSTED_PROXY_CIDRS` — forwarded header kabul edilebilecek socket peer ağları
- `CSP_ENFORCE` — production varsayılanı `true`; kontrollü rollout dışında report-only bırakılmaz
- `REDIRECT_ALLOWED_HOSTS` — virgülle ayrılmış harici redirect host allowlist'i
- `REDIRECT_CACHE_MAX_ENTRIES` — redirect lookup cache üst sınırı
- `SWR_REVALIDATION_ATTEMPTS` — background revalidation toplam deneme sayısı
- `SWR_REVALIDATION_BACKOFF_MS` — retry için başlangıç backoff süresi
- `SWR_DRAIN_TIMEOUT_MS` — shutdown sırasında aktif revalidation bekleme süresi
- `BOT_ANALYTICS_QUEUE_CAPACITY` — process başına bekleyen bot event üst sınırı
- `BOT_ANALYTICS_CONCURRENCY` — eşzamanlı analytics batch gateway çağrısı üst sınırı
- `BOT_ANALYTICS_BATCH_SIZE` / `BOT_ANALYTICS_FLUSH_MS` — batch boyutu ve kısmi batch bekleme süresi
- `BOT_ANALYTICS_DEDUP_TTL_MS` — aynı bot/path için pod-local dedup penceresi
- `BOT_ANALYTICS_SAMPLE_RATE` — `0..1` aralığında event kabul oranı
- `BOT_ANALYTICS_DRAIN_TIMEOUT_MS` — shutdown sırasında analytics kuyruğu drain bütçesi
- `CLIENT_ERROR_RATE_LIMIT` / `CLIENT_ERROR_WINDOW_MS` — process başına telemetry ingestion bütçesi
- `CLIENT_ERROR_SAMPLE_RATE` — geçerli client error log kabul oranı (`0..1`)
- `CLIENT_ERROR_IP_RATE_LIMIT` — aynı güvenilir client IP'nin pencere başına event bütçesi
- `CLIENT_ERROR_IP_MAX_ENTRIES` — process içindeki bounded IP limiter registry kapasitesi
- `CLIENT_ERROR_IP_TTL_MS` — IP limiter kaydı TTL'i; window süresinden kısa olamaz
- `ASSET_CDN_URL` — opsiyonel asset CDN origin'i
- `IMAGE_CDN_URL` — opsiyonel, dönüşümsüz image dosyaları için CDN prefix'i; path korunur
- `IMAGE_TRANSFORM_URL` — opsiyonel responsive image transformation endpoint'i
- `VITE_DEV_SERVER_URL` — yalnız development orchestrator tarafından kullanılan Vite origin'i;
  production'da tanımlanması config hatasıdır

Local Docker testinde `localhost:3005` gibi bare loopback image URL'leri otomatik olarak
`http://localhost:3005` biçimine normalize edilir. HTTP istisnası yalnız `localhost`, `127.0.0.1` ve
`[::1]` için geçerlidir; uzak production CDN ve transformer adresleri HTTPS olmak zorundadır.

`GTM_CONTAINER_ID` boş olabilir; doluysa yalnız `GTM-` ile başlayan büyük harf/rakam container formatı
kabul edilir. Değer inline script üretilmeden önce startup validation'dan geçer.

Mock veri ve auth davranışları uygulama runtime'ında bulunmaz. `tools/mock-gw/` bağımsız bir Node servisi
olarak 4002 portunda çalışır; Docker Compose uygulamayı bu servise bağlar. Gerçek gateway hazır
olduğunda yalnızca `GATEWAY_URL` değiştirilir.

Detaylı cache ve geliştirme kuralları için [docs/conventions.md](docs/conventions.md) belgesine bakın.

### Migration (katmanlı cache)

Önceki sürümlerde `CACHE_BACKEND=redis` doğrudan Redis hot path anlamına geliyordu. Güncel mimaride
her podda L1 memory her zaman vardır; `redis` = L1 + L2 + Pub/Sub invalidation. Env adları korunur;
load test ve latency raporları eski sonuçlarla birebir karşılaştırılamaz.
