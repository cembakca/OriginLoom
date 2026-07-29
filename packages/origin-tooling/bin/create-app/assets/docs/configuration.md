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
- Upstream: `GATEWAY_TIMEOUT_MS`, `API_REQUEST_TIMEOUT_MS`, `PROXY_REQUEST_TIMEOUT_MS`.
- Cache: `CACHE_BACKEND`, `CACHE_REQUIRED`, `CACHE_MAX_ENTRIES`, `CACHE_FILL_TIMEOUT_MS`,
  `CACHE_FILL_WAIT_MS`, `CACHE_FILL_POLL_MS`, `SWR_REVALIDATION_ATTEMPTS`,
  `SWR_REVALIDATION_BACKOFF_MS`, `SWR_DRAIN_TIMEOUT_MS`, `MENU_CACHE_TTL`, `MENU_CACHE_SWR`.
- Stream: `LIVE_STREAM_MAX_CONNECTIONS`, `LIVE_STREAM_MAX_CONNECTIONS_PER_IP`,
  `LIVE_STREAM_MAX_DURATION_MS`, `LIVE_STREAM_HEARTBEAT_MS`.
- Proxy trust: `TRUST_PROXY`, `TRUSTED_PROXY_HOPS`, `TRUSTED_PROXY_CIDRS`.
- Security/telemetry: `CSP_ENFORCE`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`.

Heartbeat stream süresinden, ürün worker drain'i global shutdown budget'ından kısa olmalıdır.
Multi-pod production'da Redis zorunluysa `CACHE_REQUIRED=true` kullanın. `TRUST_PROXY` yalnız
kontrollü proxy arkasında açılır.
