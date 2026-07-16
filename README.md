# ssr-kit

Hono ve React 19 üzerine kurulu, meta-framework kullanmayan full-document SSR altyapısı.

## Mimari

Bir sayfa isteği sırasıyla şu katmanlardan geçer:

1. Hono request-id ve güvenlik middleware'lerini çalıştırır.
2. Auth, session ve CMS redirection pipeline'ı request'i zenginleştirir.
3. Routing katmanı redirect, internal rewrite veya gateway proxy kararı verir.
4. Route cache policy hesaplanır; uygun GET isteğinde HTML cache okunur.
5. MISS durumunda loader çalışır ve React document render edilir.
6. Etkileşimli alanlar bağımsız island chunk'ları olarak hydrate/mount edilir.

## Dizinler

```text
server/
  adapters/       Gateway gibi dış sistem adapter'ları
  api/            Public ve internal BFF endpointleri
  cache/          Memory/Redis cache implementasyonları
  middleware/     Request pipeline adımları
  routes/         Loader, cache ve metadata içeren SSR route tanımları
  services/       Server-only veri orkestrasyonu
  handler.ts      Route çözümleme, cache ve render akışı
  document.tsx    Tam HTML document render'ı

src/
  routes/         Route'ların SSR-safe sunum/shell bileşenleri
  islands/        Client-side etkileşim giriş noktaları
  components/     SSR-safe UI bileşenleri
  lib/            Paylaşılan saf tip, kontrat ve yardımcılar

tests/            src ve server yapısını izleyen Vitest testleri
```

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

## Geliştirme

```bash
npm ci
npm run dev
```

Bu komut uygulamayı `http://localhost:3005`, bağımsız mock gateway'i ise
`http://localhost:4002` adresinde çalıştırır. Client modülleri `http://127.0.0.1:5174`
üzerindeki gerçek Vite development server'dan gelir. Browser'da yalnız Hono adresini açın.

- `src/islands` ve client bağımlılıkları React Fast Refresh ile state'i koruyarak güncellenir.
- Server/SSR dosyaları `tsx watch` ile kontrollü restart olur; Hono hazır olduğunda browser tam
  document reload yapar.
- Development sırasında `dist/client` veya manifest yeniden üretilmez.
- Production build hâlâ hashed asset ve `.vite/manifest.json` kullanır.

Gateway'i tek başına başlatmak için:

```bash
npm run mock-gw
```

Redis'i Docker'da, uygulama ve gateway'i host üzerinde watch modunda çalıştırmak için:

```bash
npm run dev:local
```

Bu script önce Compose'taki `app` ve `mock-gw` container'larını durdurur, yalnızca Redis'i
`docker compose up -d --wait redis` ile hazırlar ve sonra `npm run dev` çalıştırır. Script
kapatıldığında Redis açık kalır; sonraki kod değişikliklerinde `compose down` gerekmez.

## Embedded JSON ve crawl kontratı

Island hydration prop'ları crawler-visible HTML'e yazılmadan önce `serializeEmbeddedJson()` ile
serialize edilir. Route-benzeri `/...` değerleri JSON'un geçerli `\/` escape'iyle çıkar; browser
`JSON.parse` sırasında bunları otomatik olarak tekrar `/...` haline getirir. Böylece gerçek
`<a href>` linkleri değişmeden kalırken `data-props` içindeki publicPath, pathname, menu URL ve içerik
alanları ikinci bir URL inventory'si oluşturmaz.

Serializer ayrıca `<`, `>`, `&`, U+2028 ve U+2029 karakterlerini güvenli JSON escape'lerine çevirir.
Bu kural yalnız HTML'e embedded JSON içindir; API body, Redis ve log serialization'ına uygulanmaz.

## Kontroller

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:coverage
npm run build
npm run ci
```

## Gözlemlenebilirlik

`server/instrumentation.ts` process başına bir kez OpenTelemetry SDK'yı başlatır ve graceful
shutdown sırasında exporter'ı flush eder. Bir OTLP collector bağlamak için:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run dev
```

Her HTTP isteği inbound trace context'ini devralan bir server span üretir. Loader, SSR render,
gateway, cache/Redis ve SWR revalidation bunun altında child span olarak görünür. Gateway çağrıları
aktif W3C `traceparent`/`tracestate` context'ini ve `correlationid` olarak request ID'yi taşır.
Structured loglar `service`, `releaseId`, aktif `traceId` ve `spanId` alanlarını otomatik ekler.

`/metrics`, bounded-label Prometheus metrikleri sunar: request/cache/gateway/revalidation sayaç ve
latency histogramları, gateway timeout/error outcome'ları, event-loop lag, CPU, heap/RSS, uptime ve
release bilgisi. `requestId`, raw URL ve kullanıcı bilgisi metric label'ı yapılmaz.

## Image ve font pipeline

`npm run media`, `server/media.config.json` içindeki yerel görselleri build-time Sharp ile responsive
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

Temel değişkenler:

- `PORT` — HTTP portu, varsayılan `3005`
- `GATEWAY_URL` — backend gateway adresi; local varsayılan `http://localhost:4002`
- `CACHE_BACKEND` — `memory` veya `redis`; production yalnızca `redis` kabul eder
- `CACHE_REQUIRED` — `true` ise Redis problemi readiness'i başarısız yapar; varsayılan fail-open
- `REDIS_URL` — Redis seçildiğinde zorunlu
- `CACHE_MAX_ENTRIES` — memory cache kapasitesi
- `CACHE_PURGE_SECRET` — production purge endpoint yetkilendirmesi
- `MENU_CACHE_TTL` / `MENU_CACHE_SWR` — menü cache süreleri
- `SITE_URL` — canonical URL tabanı
- `RELEASE_ID` — release/Git SHA; Redis HTML cache namespace'i
- `OTEL_SERVICE_NAME` — trace ve metric service adı; varsayılan `ssr-kit`
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP/HTTP collector adresi; yoksa tracing no-op kalır
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` — yalnız trace sinyali için tam OTLP endpoint'i
- `OTEL_TRACES_EXPORTER` — `otlp` veya `none`
- `OTEL_SDK_DISABLED` — varsayılan `false`; `true` ile OpenTelemetry SDK'yı tamamen kapatır
- `GATEWAY_TIMEOUT_MS` — gateway/proxy timeout'u
- `PROXY_BODY_LIMIT_BYTES` — `/api/*` istek gövdesi üst sınırı
- `TRUST_PROXY` — yalnızca güvenilir ingress arkasında forwarded IP header'larını etkinleştirir
- `REDIRECT_ALLOWED_HOSTS` — virgülle ayrılmış harici redirect host allowlist'i
- `REDIRECT_CACHE_MAX_ENTRIES` — redirect lookup cache üst sınırı
- `SWR_REVALIDATION_ATTEMPTS` — background revalidation toplam deneme sayısı
- `SWR_REVALIDATION_BACKOFF_MS` — retry için başlangıç backoff süresi
- `SWR_DRAIN_TIMEOUT_MS` — shutdown sırasında aktif revalidation bekleme süresi
- `ASSET_CDN_URL` — opsiyonel asset CDN origin'i
- `IMAGE_CDN_URL` — opsiyonel, dönüşümsüz image dosyaları için CDN prefix'i; path korunur
- `IMAGE_TRANSFORM_URL` — opsiyonel responsive image transformation endpoint'i
- `VITE_DEV_SERVER_URL` — yalnız development orchestrator tarafından kullanılan Vite origin'i;
  production'da tanımlanması config hatasıdır

Local Docker testinde `localhost:3005` gibi bare loopback image URL'leri otomatik olarak
`http://localhost:3005` biçimine normalize edilir. HTTP istisnası yalnız `localhost`, `127.0.0.1` ve
`[::1]` için geçerlidir; uzak production CDN ve transformer adresleri HTTPS olmak zorundadır.

Mock veri ve auth davranışları uygulama runtime'ında bulunmaz. `mock-gw/` bağımsız bir Node servisi
olarak 4002 portunda çalışır; Docker Compose uygulamayı bu servise bağlar. Gerçek gateway hazır
olduğunda yalnızca `GATEWAY_URL` değiştirilir.

Detaylı cache ve geliştirme kuralları için [docs/conventions.md](docs/conventions.md) belgesine bakın.
