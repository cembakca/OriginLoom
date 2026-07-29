# Progressive HTML ve Server-Sent Events

Route'taki `streaming: true`, React Suspense shell'ini önce gönderir. Header gönderildikten sonra HTTP
status değişemeyeceği için kritik loader kararlarını stream başlamadan verin. Streaming HTML shared
cache'e yazılmaz; botların tamamlanmış document ihtiyacını ürün politikasında ayrıca değerlendirin.

`/api/ticks` production-safe SSE iskeletidir:

- `Accept: text/event-stream`, same-origin ve `Sec-Fetch-Site` doğrulaması,
- process ve IP başına aktif bağlantı admission'ı,
- heartbeat, maksimum connection süresi ve reconnect bildirimi,
- abort/shutdown temizliği ve idempotent lease release,
- `private, no-store, no-transform`, `X-Accel-Buffering: no`,
- bounded-label Prometheus metrikleri.

Gerçek upstream akışında her browser için ayrı gateway socket açmayın. Symbol/topic bazlı ortak bir
hub kurun. Slow consumer kuyruğunu sınırsız büyütmeyin; snapshot türü veride latest-value coalescing
kullanın. Event payload'ı da gateway JSON'u gibi untrusted input'tur ve boyut/şema sınırından geçer.
