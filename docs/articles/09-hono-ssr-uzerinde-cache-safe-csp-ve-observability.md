# Hono SSR Üzerinde Cache-Safe CSP ve Observability

> Full-document Redis cache, React streaming ve uzun yaşayan SSE bağlantıları aynı uygulamada
> bulununca güvenlik başlıkları ile telemetry semantiği request pipeline’ın açık kontratı olmalıdır.

Bu yazının ilk sürümü CSP’yi yalnız sabit inline script hash’leri üzerinden anlatıyordu. React
streaming eklendiğinde bu model tek başına yeterli kalmadı: React, Suspense boundary’lerini açmak için
response’a dinamik inline runtime script’leri yazabilir. Bugünkü sistem bu nedenle sabit hash ile
request-scoped nonce’u birlikte, farklı amaçlarla kullanıyor.

## Cache body ile güvenlik header'ını ayırmak

Redis full HTML body’yi saklar; HTTP güvenlik header’ları ise her request’in finalization aşamasında
yeniden üretilir. Shared body içinde request’e özel değer bulunmamalıdır.

Buffered/cached document’te analytics bootstrap script’leri deterministik metin taşır. Bunların
SHA-256 hash’leri module load sırasında bir kez hesaplanır:

```ts
function sha256(content: string): string {
  return `'sha256-${crypto.createHash("sha256").update(content).digest("base64")}'`;
}
```

Streaming response ise cache’e canlı akış olarak yazılmaz. Security middleware request başında nonce
üretir, route context’e koyar ve aynı değer React’in `renderToPipeableStream` çağrısına verilir:

```text
request nonce
  ├─ Content-Security-Policy: script-src 'nonce-{value}' ...
  └─ React stream runtime <script nonce="{value}">
```

Bu ayrım nonce’un cache’te tekrar kullanılmasını engeller. Sabit analytics script’leri hash ile,
response’a özgü React runtime script’leri nonce ile yetkilendirilir.

## “Nonce var, cache güvenli” demek için gereken invariant'lar

1. Request nonce’u cached HTML body’ye yazılmamalıdır.
2. Streaming response doğrudan shared HTML cache entry’sine dönüşmemelidir.
3. Cache HIT’inde body aynı kalsa da CSP header yeni nonce ile yeniden üretilebilir olmalıdır.
4. Nonce gereken dinamik script ile header aynı request context’ini kullanmalıdır.
5. Static inline script metni değişirse hash testi/build kontrolü bunu yakalamalıdır.

Projede normal full-document render `renderToString` kullanır ve React streaming runtime script’i
üretmez. `streaming: true` route’un canlı request’i cache yerine pipe edilir; bot ve cache-fill yolu
`allReady` tamamlanana kadar buffer edilir. Bu davranışlar değişirse CSP kontratı da birlikte yeniden
incelenmelidir.

## Development CSP neden production ile aynı olamaz?

Vite HMR ve React Refresh development’ta inline script ve WebSocket bağlantısı kullanır. CSP’de hash
veya nonce varken browser’ın `'unsafe-inline'` davranışı beklendiği gibi olmayabilir. Bu nedenle:

- Production: sabit hash’ler + request nonce + kapalı origin listesi.
- Development: Vite HTTP/WS origin’leri + yalnız local ortam için `'unsafe-inline'`.

Bu bir production gevşetmesi değildir. `VITE_DEV_SERVER_URL` production config’inde kabul edilmez;
production protocol/origin validasyonu startup’ta fail-fast çalışır.

`CSP_ENFORCE=false` ise aynı direktifler `Content-Security-Policy-Report-Only` olarak gönderilir.
Rollout sırasında raporları izlemek faydalıdır, fakat report-only güvenlik kontrolü değildir; nihai
hedef enforce modudur.

## `connect-src` artık yalnız analytics değildir

Browser canlı piyasa verisini aynı-origin `/api/markets/stream` üzerinden aldığı için CSP’de ayrı
gateway origin’i veya credential açılmaz; `'self'` yeterlidir. Gateway bearer token yalnız server
process’inde kalır.

Bu tasarım iki riski azaltır:

- Gerçek gateway hostname/token browser bundle veya DevTools’a sızmaz.
- CSP’ye geniş `https://*` ya da `wss://*` eklemek gerekmez.

İleride stream ayrı public origin’e taşınırsa `connect-src`, CORS, credential ve Origin politikası
birlikte tasarlanmalıdır; yalnız CSP allowlist eklemek yetmez.

## Observability: her süre aynı request histogram'ına girmez

Kısa HTTP request ile beş dakika açık kalan SSE bağlantısını aynı latency histogramında ölçmek p95/p99
değerlerini anlamsızlaştırır. Normal SSR request’lerinde status, route template, cache state ve duration
ölçülür. Market stream’de ise lifecycle ayrı metriklerle izlenir:

```text
ssr_market_stream_active_connections
ssr_market_stream_connections_total{outcome=...}
ssr_market_stream_events_total{outcome=...}
```

Connection outcome kapalı bir kümedir: accepted, invalid request, IP/global limit ve closed gibi
sonuçlar. Event outcome da received, invalid veya coalesced gibi bounded değerlerden oluşur. Symbol,
IP, request ID, raw URL ve user ID metric label’ı değildir.

## Cardinality kontrolü route template ile başlar

`/blogs/paginated?page=2` veya benzersiz ürün slug’ını doğrudan Prometheus label’ına yazmak sonsuz seri
üretir. Hono context’teki `requestRoute` normalize şablonu kullanılır:

```text
/blogs/paginated
/konut-kredisi/:slug
/api/markets/stream
```

Request ID log ve trace correlation içindir; metric label değildir. Cache key sayısı da label’a
çevrilmez. Route bazlı cardinality gözlemi aggregate counter/histogram veya kontrollü inventory ile
yapılır.

## Gateway timeout, client abort ve stream disconnect aynı şey değildir

Gateway fetch’inde internal timeout controller tetiklendiyse outcome `timeout` olabilir. Browser
sekmesini kapattığı için request signal kesildiyse bu gateway SLA ihlali değildir. Canlı upstream
stream’in kopması ise tekrar bağlanabilir lifecycle olayıdır ve kısa JSON fetch error metriğine
karıştırılmamalıdır.

Trace ağacında ayrım şu şekilde görünmelidir:

```text
http.server request
  ├─ route.loader
  ├─ gateway.fetch
  ├─ cache.lookup / cache.fill
  └─ ssr.render

market stream process lifecycle
  ├─ upstream handshake
  ├─ batch parse/publish
  └─ reconnect/backoff
```

Process hub tek upstream bağlantıyı birçok browser subscriber’a dağıttığı için upstream lifecycle
tek bir kullanıcı request span’ının child’ı değildir. Uzun yaşayan background span’lerde sampling ve
span süresi maliyeti ayrıca değerlendirilmelidir; temel sağlık sinyali bounded metric ve structured
log olabilir.

## Alarm için anlamlı oranlar

Tek counter değeri yerine zaman penceresinde oran ve saturation izlenmelidir:

- `invalid_request / total_connections`: abuse veya client contract regresyonu.
- `ip_limited + global_limited`: admission saturation.
- `invalid_events / received_events`: upstream schema/drift problemi.
- `coalesced_events / received_events`: slow consumer veya publish hızı baskısı.
- Active connections / configured process limit: kapasite headroom’u.
- Upstream reconnect sıklığı ve son başarılı batch yaşı: provider sağlığı.
- Client `market-stream` telemetry oranı: parse/chunk/runtime problemi.

Connection limitleri process-local olduğu için cluster kapasitesi `replica × process limit` diye körlemesine
varsayılmamalıdır. Load balancer dağılımı, pod headroom’u, file descriptor limiti ve gateway fan-out
kapasitesi birlikte ölçülmelidir.

## Release ve trace context

Structured log, trace resource ve metrics scrape aynı `service`/`releaseId` bağlamını taşımalıdır.
Gateway çağrılarında request ID ile W3C trace context aktarılır. Böylece “yeni release sonrası yalnız
MISS render mı yavaşladı, yoksa upstream stream mi sık koptu?” sorusu deployment ile korele edilebilir.

OpenTelemetry SDK `OTEL_SDK_DISABLED=false` varsayımıyla başlar; exporter endpoint’i yoksa API no-op
kalırken Prometheus-style process/application metrics çalışmaya devam eder. Bu, tracing exporter
arızasının uygulama startup’ını veya `/metrics` yüzeyini zorunlu olarak düşürmemesini sağlar.

## Sonuç

Cache-safe CSP’nin bugünkü kontratı “yalnız hash” değildir:

- Shared buffered HTML deterministik inline script hash’leri kullanır.
- React streaming runtime request-scoped nonce taşır.
- Nonce cached body’ye gömülmez.
- Dev HMR istisnaları production’a taşınmaz.
- Browser gateway’e değil same-origin BFF stream’ine bağlanır.

Observability tarafında da başarı “çok metric” değildir. Kısa request, background iş ve uzun yaşayan
bağlantının farklı lifecycle’ları vardır. Label domain’i kapalı, error sınıfları anlamlı ve release
correlation’ı kurulmuşsa sistem üretimde yorumlanabilir hale gelir.

---

## Kaynaklar

- [Hono Secure Headers Middleware](https://hono.dev/docs/middleware/builtin/secure-headers)
- [Hono Streaming Helper](https://hono.dev/docs/helpers/streaming)
- [W3C Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)
- [OpenTelemetry Metrics](https://opentelemetry.io/docs/concepts/signals/metrics/)
- [Prometheus Naming ve Labels](https://prometheus.io/docs/practices/naming/)
- [Cache Bir Optimizasyon Değil, Route Kontratıdır](./03-cache-bir-optimizasyon-degil-route-kontratidir.md)
- [SSR Snapshot ile Güvenli Canlı Piyasa Verisi](./13-ssr-snapshot-ile-guvenli-canli-piyasa-verisi.md)
