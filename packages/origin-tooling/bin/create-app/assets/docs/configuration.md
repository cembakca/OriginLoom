# Configuration referansı

Platform değişkenleri `@originloom/core/config`, ürün değişkenleri `server/product/config.ts`
tarafından okunur. Ürün config'i tek yerde tutulmalı ve `validateConfig([validateProductConfig])` ile
ilk request'ten önce fail-fast doğrulanmalıdır.

Production'da `SITE_URL`, `GATEWAY_URL`, `RELEASE_ID` ve
`AUTH_REFRESH_COORDINATION_SECRET` zorunludur. Redis için `REDIS_URL`, purge için
`CACHE_PURGE_SECRET` secret manager'dan gelir. Secret'ları image, repo, ConfigMap veya client bundle'a
yazmayın.

## Development'ta ne çalışır

`pnpm dev` yalnız **uygulamayı ve Vite'ı** başlatır. İki şey kasıtlı olarak dışarıda:

- **Gateway.** Genellikle başka birinin süreci: bir staging upstream'i, başka bir terminalde çalışan
  bir servis. Paketli mock'u istiyorsanız `pnpm dev:mock` (ya da ayrı terminalde `pnpm mock-gw`).
  `GATEWAY_URL`'de hiçbir şey dinlemiyorsa `pnpm dev` bunu açıkça söyler — boş menülü, veri
  sayfaları 500 dönen bir site "şablon bozuk" gibi okunur, oysa 4002'de kimse yoktur.
- **Operations listener.** `/metrics`, readiness ve cache purge uçları development'ta kapalıdır
  (`METRICS_ENABLED`, varsayılan: yalnız production). Bir metriğe bakmak ya da yerelde purge etmek
  isterseniz `METRICS_ENABLED=true` verin. Kapalı olmasının pratik faydası: `pnpm dev` iki yerine tek
  port tutar, yani aynı anda açık ikinci bir projeyle iki kat daha az çakışır.

## Mock gateway ne gördüğünü yazar

Her istekte uygulamanın gerçekten ne gönderdiğini görürsünüz:

```
[mock-gw] GET /items?category=konut · tracking=9f1f2f7e-abc ip=203.0.113.9 device=Mobile auth=yes
```

Kimlik değerleri her satırda, çünkü yukarı akışta bir şey ters göründüğünde bakılan şeyler bunlar:
ilk ziyarette tracking id var mı, client IP ziyaretçininki mi yoksa proxy'ninki mi, cihaz sayfanın
cache'lendiği değer mi.

| Değişken            | Etkisi                             |
| ------------------- | ---------------------------------- |
| `MOCK_GW_HEADERS=1` | Gelen **tüm** header'ları da yazar |
| `MOCK_GW_QUIET=1`   | Log'u kapatır (load test için)     |

`authorization`, `cookie` ve `proxy-authorization` değerleri **her zaman redakte edilir**. Bir
terminal scrollback'i de bir ekran görüntüsü de token'ın bulunmaması gereken yerlerdir.

Başlıca kapasite grupları:

- SSR: `SSR_REQUEST_TIMEOUT_MS`, `SSR_MAX_CONCURRENCY`, `SSR_MAX_QUEUE`, `SSR_QUEUE_WAIT_MS`.
  - `SSR_MAX_CONCURRENCY` set edilmezse platform CPU sayısına göre hesaplar (`max(32, cores×4)`,
    üst sınır 256). Mevcut deploy'larda env ile sabitlediyseniz davranış değişmez.
  - Cache'li sayfalar (`x-cache: HIT` / `STALE`) render admission almaz; BYPASS rotalar slot
    tüketir. Yoğunlukta önce cache hit oranını ve BYPASS payını kontrol edin.
- Upstream: `GATEWAY_TIMEOUT_MS`, `GATEWAY_CONNECT_TIMEOUT_MS`,
  `GATEWAY_HEADERS_TIMEOUT_MS`, `GATEWAY_BODY_TIMEOUT_MS`, `GATEWAY_MAX_CONNECTIONS` (origin başına),
  `GATEWAY_PIPELINING`, `GATEWAY_KEEP_ALIVE_TIMEOUT_MS`, `API_REQUEST_TIMEOUT_MS`,
  `PROXY_REQUEST_TIMEOUT_MS`.
- Cache: `CACHE_BACKEND`, `CACHE_REQUIRED`, `CACHE_MAX_ENTRIES`, `CACHE_FILL_TIMEOUT_MS`,
  `CACHE_FILL_WAIT_MS`, `CACHE_FILL_POLL_MS`, `SWR_REVALIDATION_ATTEMPTS`,
  `SWR_REVALIDATION_BACKOFF_MS`, `SWR_DRAIN_TIMEOUT_MS`, `MENU_CACHE_TTL`, `MENU_CACHE_SWR`.
- Stream: `LIVE_STREAM_MAX_CONNECTIONS`, `LIVE_STREAM_MAX_CONNECTIONS_PER_IP`,
  `LIVE_STREAM_MAX_DURATION_MS`, `LIVE_STREAM_HEARTBEAT_MS`.
- Proxy trust: `TRUST_PROXY`, `TRUSTED_PROXY_HOPS`, `TRUSTED_PROXY_CIDRS`.
- Middleware: `MAINTENANCE_MODE`, `MAINTENANCE_RETRY_AFTER_SECONDS` (bkz. `docs/middleware.md`).
  Bakım bayrağı her istekte okunur; çalışan deployment'ta değiştirildiğinde rollout beklemez.
- Delivery: `HTTP_COMPRESSION_THRESHOLD_BYTES`, `ASSET_CDN_URL`, `IMAGE_CDN_URL`,
  `IMAGE_TRANSFORM_URL`.
- Operations: `METRICS_ENABLED`, `METRICS_PORT`, `CACHE_PURGE_SECRET`.
- Security/telemetry: `CSP_ENFORCE`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`,
  `LOG_LEVEL`, `REQUEST_LOG_SAMPLE_RATE`.

Heartbeat stream süresinden, ürün worker drain'i global shutdown budget'ından kısa olmalıdır.
Multi-pod production'da Redis zorunluysa `CACHE_REQUIRED=true` kullanın. `TRUST_PROXY` yalnız
kontrollü proxy arkasında açılır.

`GATEWAY_TIMEOUT_MS` bütün çağrının üst sınırıdır. Connect, header ve body timeout'ları farklı
arıza sınıflarını erken keser; body timeout toplam indirme süresi değil, body chunk'ları arasındaki
sessizlik bütçesidir. Pool kapasitesini pod başına seçin: örneğin 10 pod ve pod başına 64 bağlantı,
gateway'e en fazla yaklaşık 640 açık bağlantı demektir.

`REQUEST_LOG_SAMPLE_RATE` yalnız başarılı access log'larını örnekler. HTTP 4xx/5xx ve `x-cache=ERROR`
cevapları her zaman loglanır. `LOG_LEVEL=info` production varsayılanıdır; tek tek Web Vitals/island
metric JSON satırları yalnız `debug` seviyesinde yazılır, Prometheus serileri ise her seviyede devam
eder.
