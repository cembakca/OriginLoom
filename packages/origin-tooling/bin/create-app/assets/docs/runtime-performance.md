# Runtime performansı

OriginLoom'un sıcak istek yolundaki temel optimizasyonları platform paketlerinde bulunur. Ürün
uygulamasının bunları kopyalaması veya özel middleware ile yeniden kurması gerekmez.

## 1. Server bundle ve cold start

Production SSR çıktısı Node 22 hedefiyle minify edilir; fonksiyon ve sınıf adları production stack
trace ile CPU profillerinde okunabilir kalır. Bundle self-contained'dır: deployment sırasında
`dist/server` ile `dist/client` yeterlidir, production `node_modules` dizisine güvenilmez.

Bu nedenle `vite.server.config.ts` içinde platform preset'ini koruyun. Server paketlerini rastgele
external yapmak çıktı boyutunu küçültür gibi görünür fakat dist-only deployment kontratını bozar.
Yeni ağır bir dependency eklediğinizde şu üç değeri birlikte review edin:

- `dist/server/index.js` byte büyüklüğü;
- process başlangıcından `/healthz` hazır olana kadar geçen süre;
- ilk gerçek SSR isteği ve ısınmış SSR isteği arasındaki fark.

## 2. CSP header maliyeti

CSP directive yapısı ve sabit security header değerleri uygulama oluşturulurken bir kez derlenir.
Production'da istek başına yalnız nonce üretilir ve hazır policy'ye eklenir. Ürün CSP kaynaklarını
`createApp({ csp })` ile, inline script hash'lerini ise `createApp` çağrısından önce product runtime
kurulumunda tanımlayın.

Request middleware içinde yeniden `secureHeaders(...)` üretmeyin. Dinamik bir origin gerekiyorsa
önce bunun gerçekten request'e bağlı olup olmadığını sorgulayın; çoğu vendor origin'i startup
config'idir ve bounded bir allowlist olmalıdır.

## 3. Request ve AbortSignal maliyeti

SSR, API ve gateway proxy istekleri deadline/cancellation semantiğini korur. Platform yalnız deadline
gereken istekler için `AbortController`, birleşik signal ve yeni `Request` oluşturur. Aşağıdaki GET
yolları bounded olduğundan ham request ile devam eder:

- `/healthz` ve `/readyz`;
- `/assets/*`;
- `/public/*` (proje kökündeki `public/` klasörü);
- uygulamanın `longLivedRoutes` listesine açıkça eklediği SSE/long-poll endpoint'leri.

Loader ve servislerde her zaman `ctx.request.signal` kullanın. Global veya orijinal Node request'ine
geri dönmek deadline iptalini koparır. Uzun ömürlü endpoint kendi heartbeat, admission ve connection
lifetime kontratını sahiplenmelidir; listeye eklemek tek başına bu korumaları sağlamaz.

## 4. URL, routing ve route match tekrarları

Platform public URL normalization, redirect/rewrite/proxy çözümü, route match, request sınıfı ve
bounded metric label'ını request başında bir kez hazırlar. SSR dispatch, HEAD ve render pipeline aynı
immutable sonucu kullanır. `createRewrites(gatewayUrl)` çıktısı da routing konfigürasyonu başına cache'lenir.

Ürün middleware'i tekrar tekrar `new URL(c.req.url)`, `resolveRoute` veya route-table `match` çağırmak
yerine mümkünse route loader/context bilgisini kullanmalıdır. Request URL'sini değiştiren özel bir
middleware eklenirse prepared-request varsayımı artık geçerli olmaz; rewrite işlemini
`src/routing/rules.ts` üzerinden tanımlayın.

## 5. Cache-hit hızlı yolu

HTML cache entry'si document içinde dinamik SSR fragment placeholder'ı bulunup bulunmadığını taşır.
Fragment içermeyen HIT/STALE cevapları regex taraması ve async fragment stitching hattına girmeden
doğrudan döner. Fragment içeren sayfalar mevcut güvenli stitching davranışını korur.

Redis wire format v3 bu biti ve derlenmiş marker konumlarını taşır. Platform eski binary v1/v2 ve
legacy JSON kayıtlarını okur, body'den metadata'yı bir kez türetir; deploy sırasında cache flush
gerekmez. Yeni kayıtlar doğal trafikle v3'e döner. `CacheEntry` nesnesini elle kuran app kodunda
metadata opsiyoneldir; platform güvenli fallback olarak body'yi bir kez tarar.

## 6. Fragment stitching

HTML cache'e yazılırken fragment adı ile başlangıç/bitiş konumları bir kez derlenir. Cache hit,
document üzerinde tekrar regex çalıştırmak yerine bu bounded planla `slice/join` yapar. Aynı isim
document içinde birden fazla kez geçse bile resolver request başına bir kez çağrılır ve sonuç bütün
konumlara uygulanır. Shell isteyen fragmentler document render ile aynı public shell dependency
promise'ını paylaşır.

`keyFromRequest`, fragment cache probe'unu full shell'den önce yapar. Fresh hit shell'i hiç başlatmaz;
stale hit eski fragmenti hemen kullanıp request'ten bağımsız, timeout'lu tek SWR refresh planlar.
Redis topolojisinde refresh lock'u podlar arası çoğalmayı da sınırlar. Fragment resolver/fallback
politikası document'ten bağımsızdır; başarısız tek parça tüm HTML response'unu düşürmez.

Fragment marker'larını string manipülasyonuyla üretmeyin; JSX `<ssr-fragment>` kontratını kullanın.
Marker içindeki kullanıcıya özel veri shared cache'e giremez. Statik veya yavaş değişen public
fragmentlere kendi TTL/key kontratını verin.

## 7. React SSR maliyeti

Bağımsız fragment çıktıları React root olarak hydrate edilmediği için static markup renderer kullanır.
Font CSS gibi asset'e bağlı sabit document parçaları process içinde yeniden kullanılır. Showroom'daki
menu view-model snapshot yaklaşımı da sorting, device projection ve serialization işini her React
render'da tekrarlamaz.

Route component'inde server'da işlevsiz provider/context ağacı kurmayın. Cache'siz route'larda büyük
domain modelini JSX ağacından geçirmek yerine loader sonucunu sayfanın gerçekten render ettiği bounded
view model'e dönüştürün.

## 8. React Query kapsamı

Global island mounter React Query provider taşımaz. Template'te yalnız `account-panel` kendi
`AppQueryProvider` wrapper'ını import eder; bu nedenle counter ve SSE island'ları React Query chunk'ına
bağlanmaz. Birden fazla query island'ı eklenirse provider'lar aynı browser QueryClient singleton'ını
paylaşır.

Query kullanmayan island'a provider eklemeyin. Query'yi tamamen kaldırma adımları
[react-query.md](./react-query.md) içindedir.

## 9. HTML ve hydration payload'ı

Props verilmeyen island artık `data-props="{}"` basmaz; client güvenli varsayılan olarak boş nesne
kullanır. Web Vitals paketi ilk route chunk'ında değildir: window load sonrasında idle callback ile
dinamik yüklenir. Lazy island'lar mevcut viewport observer davranışını, eager işaretlenen kritik
island'lar ise erken mount davranışını korur.

Island props'a tüm API cevabını vermeyin. Etkileşim için gereken küçük view model'i taşıyın; aynı
veriyi görünür HTML, props ve inline script içinde üç kez tekrar etmeyin. Below-the-fold island'ı eager
işaretlemeyin.

## 10. Menu ve shell snapshot'ı

Menu cache body değişmediği sürece doğrulanmış, normalize edilmiş ve dondurulmuş object graph process
içinde tekrar kullanılır. Böylece sıcak hit'te JSON parse, schema validation ve URL normalization
yeniden yapılmaz. Snapshot bounded'dır: template tek public menu; showroom cihaz sınıfı başına en fazla
bir snapshot tutar. Body değiştiğinde yeni snapshot doğal olarak eskisinin yerini alır.

Mutable menu nesnesine request sırasında alan eklemeyin. Ürüne özel projection gerekiyorsa immutable
menu snapshot'ını anahtar alan `WeakMap` ile cihaz/view model sonucunu cache'leyin; purge ve yeni body
eski nesneleri erişilemez bıraksın.

## 11. Gateway bağlantı yönetimi

Platform gateway çağrılarını process başına tek Undici dispatcher üzerinden yapar. Pool keep-alive
ile DNS/TCP/TLS işini tekrar kullanır. `GATEWAY_MAX_CONNECTIONS` **origin başına** socket limitidir;
pod'un toplam üst sınırı yaklaşık olarak `aktif upstream origin sayısı × GATEWAY_MAX_CONNECTIONS`
olur. Normal gateway trafiği tek origin kullanır; harici URL rewrite/proxy hedefleri eklenirse bu
origin'leri kapasite hesabına ayrıca katın. `GATEWAY_PIPELINING` bağlantı başına eşzamanlı HTTP/1.1
isteğini belirler. Varsayılan pipelining `1`'dir; gateway açıkça desteklemedikçe yükseltmeyin.

Timeout'lar ayrı sorumluluk taşır:

- `GATEWAY_CONNECT_TIMEOUT_MS`: TCP/TLS bağlantı kurulması;
- `GATEWAY_HEADERS_TIMEOUT_MS`: tam response header'ın gelmesi;
- `GATEWAY_BODY_TIMEOUT_MS`: body chunk'ları arasındaki sessizlik;
- `GATEWAY_TIMEOUT_MS`: çağrının mutlak üst sınırı ve request cancellation.

Platform otomatik retry yapmaz; retry storm ürünün kapasite problemi haline gelmez. Retry gerçekten
gerekiyorsa yalnız idempotent operasyon, bounded attempt, jitter ve kalan request deadline'ı ile ürün
servisinde açıkça tasarlanmalıdır. Composition root shutdown sırasında `closeGatewayTransport()` ile
pool'u drain eder.

Aynı inbound request içinde aynı parsed servis sonucuna iki katman ihtiyaç duyuyorsa
`memoizeRequestValue("contract:key", loader)` kullanın. Ham `Response` paylaşmayın: body'nin tek kez
tüketilmesi pooled bağlantının tekrar kullanılabilmesi için zorunludur. Reddedilen memo kaydı silinir;
kontrollü retry mümkündür.

## 12. Logging maliyeti

Logger seviye kapalıysa lazy field callback'ini ve JSON serialization'ı çalıştırmaz. Başarılı access
log'ları request ID üzerinden deterministik örneklenir; `REQUEST_LOG_SAMPLE_RATE=0.1` aynı request için
podlar arasında tutarlı karar verir. 4xx/5xx ve cache error cevapları sampling dışında kalır.

Client Web Vitals ve island mount olayları Prometheus metriği olarak kaydedilir; event başına JSON log
yalnız `LOG_LEVEL=debug` iken yazılır. Büyük payload, request header veya domain modelini log field'ına
koymayın. Access log'u `msg="request"`, uygulama/hata logları kendi mesajlarıyla ayrılır; log agent bu
alan üzerinden farklı sink ve retention uygulayabilir.

## 13. Metrics sıcak yolu

HTTP route/cache label setleri ilk kullanımda bounded biçimde derlenir. Histogram observation artık
her eşik için cumulative counter artırmaz; request yolunda yalnız tek non-cumulative bucket güncellenir,
Prometheus cumulative bucket'ları `/metrics` scrape anında açılır. Metric metni hiçbir kullanıcı
request'inde üretilmez.

Raw path, query, kullanıcı ID veya hata mesajını label yapmayın. Yeni histogram eklerken az ve anlamlı
bucket kullanın; yüksek çözünürlük gerekiyorsa tracing/profiling'e taşıyın. Route ve contract label'ları
declared/bounded kaynaklardan gelmelidir.

## 14. Compression stratejisi

`origin-build`, client ve media üretiminden sonra sıkıştırılabilir hash'li asset'ler için `.br` ve `.gz`
kardeşleri üretir. Node static server `Accept-Encoding` ile önce Brotli, sonra gzip varyantını seçer;
immutable asset her request'te tekrar sıkıştırılmaz. `Vary: Accept-Encoding` cache varyantlarını ayırır.

Dinamik HTML/JSON origin'de yalnız `HTTP_COMPRESSION_THRESHOLD_BYTES` üzerindeyse gzip edilir. SSE ve
`no-transform` cevapları compression hattına girmez. Production'da HTML compression'ını CDN/ingress'e
taşımak tercih edilir; OriginLoom'da fragment stitching response'tan hemen önce gerçekleştiği için
shared cache'e sıkıştırılmış HTML yazmak doğru değildir.

## 15. Static asset ve CDN teslimi

`dist/client/assets/*` hash'li, bir yıl immutable cache'lidir. `ASSET_CDN_URL` verildiğinde manifest JS,
CSS, font, media ve modulepreload URL'leri CDN'e yönelir; document head CDN origin'i için preconnect
üretir ve CSP allowlist otomatik genişler. CDN'e hem kaynak dosyaları hem `.br`/`.gz` kardeşlerini aynı
path altında yükleyin ve `Content-Encoding`, `Content-Type`, `Vary` metadata'sını koruyun.

Media pipeline hero/LCP görselini bounded responsive AVIF/WebP/JPEG adaylarına dönüştürür; fontlar
WOFF2 subset ve yalnız gerçekten kritikse preload edilir. `readAssets({ eagerIslands })` listesine
yalnız above-the-fold island koyun. Analytics/consent dışı third-party script'i global eager asset
graph'ına eklemeyin.

## Ürün kodu için kontrol listesi

- Server Vite preset'ini override ederken `target`, `minify`, `keepNames` ve self-contained output
  kontratını koruyun.
- CSP kayıtlarını request handler'da değil startup composition root'ta yapın.
- Loader fetch çağrılarına `ctx.request.signal` taşıyın.
- Redirect/rewrite/proxy kararlarını product routing rules içinde tutun.
- Kişisel veriyi shared HTML cache'e koymayın; dynamic fragment veya client island kullanın.
- Query provider'ını yalnız query kullanan island sınırında tutun.
- Menu ve shell snapshot'larını immutable bırakın.
- Gateway pool limitini upstream origin sayısı, toplam pod sayısı ve backend kapasitesiyle birlikte
  hesaplayın. Gereksiz veya kullanıcı kontrollü harici proxy origin'lerine izin vermeyin.
- Gateway servis sonucunu request içinde paylaşırken ham response değil parsed promise memoize edin.
- Başarılı access log sampling oranını trafik hacmine göre ayarlayın; hataları örneklemeyin.
- Metric label'larına raw URL/query/user verisi koymayın.
- CDN deploy'unda `.br`/`.gz` asset kardeşlerini ve doğru encoding metadata'sını birlikte yayınlayın.
- Değişiklikten sonra `pnpm build`, `pnpm test`, `pnpm capacity:quick` ve gerektiğinde
  `pnpm capacity:profile` çalıştırın.

Kapasite sonucu ve kabul baseline'ı için [capacity.md](./capacity.md) ile
[performance-acceptance.md](./performance-acceptance.md) dokümanlarına bakın.
