# Configuration referansı

Platform değişkenleri `@originloom/core/config`, ürün değişkenleri `server/product/config.ts`
tarafından okunur. Ürün config'i tek yerde tutulmalı ve `validateConfig([validateProductConfig])` ile
ilk request'ten önce fail-fast doğrulanmalıdır.

Production'da `SITE_URL`, `GATEWAY_URL`, `RELEASE_ID` ve
`AUTH_REFRESH_COORDINATION_SECRET` zorunludur. Redis için `REDIS_URL`, purge için
`CACHE_PURGE_SECRET` secret manager'dan gelir. Secret'ları image, repo, ConfigMap veya client bundle'a
yazmayın.

Başlıca kapasite grupları:

- SSR: `SSR_REQUEST_TIMEOUT_MS`, `SSR_MAX_CONCURRENCY`, `SSR_MAX_QUEUE`, `SSR_QUEUE_WAIT_MS`.
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
