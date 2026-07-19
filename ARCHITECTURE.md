# SSR-Kit — Mimari Analiz

## Projenin Özü

Bu proje, **Next.js veya Remix kullanmadan sıfırdan yazılmış bir SSR (Server-Side Rendering) framework'üdür.** Bir ürün değil, bir altyapı katmanıdır. Vite client island bundle'ını ve production Node.js server entrypoint'ini ayrı çıktılar olarak üretir.

Ana karar: **İsland Architecture** + **Shared HTML Cache** kombinasyonu. Vite, client island bundle'ının yanında production Node.js server entrypoint'ini de üretir. Sayfanın tamamı sunucuda render edilir, tarayıcıya statik HTML gider. Etkileşim gerektiren parçalar ("island") kendi JS chunk'ını lazy-load eder ve bağımsız olarak hydrate olur ya da client'ta mount edilir.

---

## Katmanlar ve Sorumluluklar

### 1. HTTP Katmanı — `server/index.ts`

Hono üzerinde çalışır, `@hono/node-server` ile Node.js HTTP server'a bağlanır. Şu endpoint'leri doğrudan yakalar:

| Path                            | Açıklama                                                 |
| ------------------------------- | -------------------------------------------------------- |
| `/assets/*`                     | Statik dosyalar, `dist/client` klasöründen sunulur       |
| `/healthz`                      | Liveness check                                           |
| `/readyz`                       | Readiness check (cache backend ping'i içerir)            |
| `/robots.txt`                   | Merkezi crawler policy + sitemap discovery               |
| `/sitemap.xml`                  | Canonical public route envanteri                         |
| `/api/referrals`                | Ürün başvurusunu doğrulayan public BFF + güvenli 303     |
| `/api/finance/loan-calculation` | Public, bounded ve `no-store` hesaplama BFF'i            |
| `/api/markets/stream`           | Bounded, same-origin SSE BFF                             |
| `/api/internal/*`               | Browser BFF'leri — gereken auth handler içinde uygulanır |
| `*`                             | SSR pipeline → handler                                   |

Prometheus `/metrics`, cache purge ve referral operations endpoint'leri public HTTP portunda
bulunmaz. Ayrı `METRICS_PORT` listener'ı (varsayılan `9090`) `ssr-kit-operations` ClusterIP servisi ve
NetworkPolicy arkasındadır; public ingress yalnız `3005` portunu yayınlar. Public porttaki `/metrics`
ve operations path'leri bilinçli `404` döner.

Graceful shutdown uygulanmış: SIGTERM/SIGINT alınca önce HTTP server kapatılır; SWR işleri ve bot
analytics kuyruğu bounded süreyle paralel drain edilir, ardından cache bağlantısı temizlenir.
Force-exit için `SHUTDOWN_TIMEOUT_MS` (default 10s) var.

---

### 2. Middleware Pipeline — `server/middleware/pipeline.ts`

SSR HTML istekleri için çalışır. Sıralı, birikimli (accumulator pattern) çalışır; bir adım terminal response dönerse pipeline durur. Hono'ya doğrudan mount edilen BFF endpoint'leri bu genel pipeline'a girmez; korunan endpoint'ler aynı auth core'u `authenticateBffRequest()` üzerinden açıkça çağırır.

```
Request
  └─► authStep        (token okur, refresh eder, Authorization inject eder)
        └─► sessionStep   (tracking ID, UTM cookie'leri, bot detection)
              └─► redirectionStep  (DB'den redirect kuralı varsa 301/410 döner)
                    └─► handle()  [SSR]
```

**Adım tipi:**

```typescript
type MiddlewareStep = (
  ctx: PipelineContext,
  acc: PipelineResult,
) => Promise<Partial<PipelineResult> | void>;
```

Her adım sadece ne değiştirmek istiyorsa onu döner, geri kalanına dokunmaz. `mergeAcc` fonksiyonu birleştirir. Bu pattern, adımları birbirinden bağımsız test etmeyi doğrudan mümkün kılar.

---

### 3. Auth Akışı — `server/middleware/steps/auth/`

Klasik **cookie-based JWT + server-side refresh** (BFF pattern).

**Cookie şeması:**

| Cookie          | httpOnly | Amaç                                   |
| --------------- | -------- | -------------------------------------- |
| `access_token`  | evet     | JWT, loader'lar tarafından kullanılır  |
| `refresh_token` | evet     | Token yenileme                         |
| `signed_in`     | hayır    | İlk render için doğrulanmamış UI ipucu |
| `account_text`  | hayır    | İlk render için doğrulanmamış ad ipucu |

**Akış:**

1. `access_token` cookie'sini oku
2. Expire olmak üzere mi? (`exp * 1000 < now + 30s`) → `refresh_token` ile gateway'e POST
3. Refresh başarılıysa: yeni token'ları `httpOnly` cookie'lere yaz, `Authorization: Bearer ...` header'ı request'e inject et
4. Gateway `400/401` ile refresh token'ı reddederse auth cookie'lerini sil, anonim devam et
5. Gateway `5xx`, timeout, network veya payload hatası verirse cookie'leri koru ve `unavailable` üret

`signed_in` ve `account_text` yetkilendirme kaynağı değildir; kullanıcı bunları değiştirebilir.
Client ilk render'da yalnızca bu ipuçlarını kullanır; public sayfalarda ek bir session isteği atmaz.
Korumalı bir BFF isteği gerektiğinde HttpOnly credential'lar doğrulanır ve başarılı profil yanıtı
cookie'lerle reaktif kullanıcı store'unu günceller. Gateway'in `401` yanıtı stale access/UI state'ini
temizler fakat refresh token'ı korur; client bir kez refresh edip isteği tekrarlar. Refresh de
başarısızsa tüm auth cookie'leri ve UI state'i temizlenir. Geçici gateway/network hataları (`5xx`)
kullanıcıyı yanlışlıkla çıkış yaptırmaz. `/api/internal/auth/session` endpoint'i gerektiğinde açıkça
oturum doğrulamak isteyen akışlar içindir; global layout tarafından çağrılmaz.

**Kritik detay — iki seviyeli deduplication:** Aynı process'teki refresh'ler `refreshesInFlight`
Promise'ini paylaşır. Replica'lar Redis lock ve kısa ömürlü AES-GCM şifreli sonuç üzerinden aynı token
rotation sonucunu paylaşır; ham refresh token Redis key'ine yazılmaz. `AUTH_REFRESH_COORDINATION_SECRET`
production'da ayrı ve en az 32 karakterli olmak zorundadır.

---

### 4. SSR Handler — `server/handler.ts`

Tek bir `handle()` fonksiyonu. Yukarıdan aşağıya okunabilir, yan yol yok:

```
0. normalizePublicUrl(url)
   ├─ non-canonical → 308
   └─ malformed / encoded separator → 400

1. resolveRoute(url)
   ├─ "redirect"  → Response.redirect()
   ├─ "proxy"     → proxyRequest()
   └─ "internal"  → aşağıya devam

2. match(routes, pathname)
   └─ null → 404

3. route.cache(ctx) → CachePolicy
   ├─ kind: "none"   → cache bypass
   └─ kind: "shared" → cache key üret

4. cache.read(key)
   ├─ "fresh"  → HIT, dön
   └─ "stale"  → STALE, arka planda revalidate başlat, şimdi stale'i dön

5. route.loader(ctx) → data
6. renderDocument(route, data, assets) → HTML string
7. cache.write(key, html, policy)
8. Response (x-cache: MISS)
```

---

### 5. Cache Sistemi — `server/cache/`

#### CachePolicy

Route'un `cache()` metodu iki şey döner:

```typescript
type CachePolicy =
  | { kind: "none" } // her zaman loader çalışır
  | { kind: "shared"; ttl: number; swr?: number; key: string[] }; // paylaşımlı HTML cache
```

`key` array'i cache key'ini belirleyen tek şeydir. Key'de olmayan her şey görmezden gelinir — bu tasarımın kasıtlı bir kısıtlaması.

#### Bypass Mantığı — `src/lib/cache-policy.ts`

Cache bypass, HTML'in gerçekten kişiselleşip kişiselleşmediğine göre route bazında tanımlanır:

```
public cache-safe route + auth token → shared cache
kişiselleştirilmiş SSR route + auth token → CachePolicy { kind: "none" }
account gibi never route → CachePolicy { kind: "none" }
```

`signed_in` cache kararında kullanılmaz; kullanıcı tarafından değiştirilebilen bir UI ipucudur.
Header ve kişisel dashboard defer island olduğu için public HTML route'larında token varlığı tek
başına cache'i bypass etmez. Kişisel `/hesabim` route'u registry'de `never` stratejisi kullanır.

Gerçekten bütün route'ları etkileyen yeni bir bypass kuralı eklemek için:

```typescript
registerCacheBypassCheck(hasPid); // segment bazlı, PID cookie'si varsa bypass
```

#### Backend — `server/cache/memory.ts` ve `server/cache/redis.ts`

Her iki backend de aynı `CacheStore` interface'ini implement eder:

```typescript
interface CacheStore {
  read(key): Promise<{ body: string; state: "fresh" | "stale" } | null>;
  write(key, body, policy): Promise<void>;
  deleteKey;
  deleteKeys;
  deleteByPrefix;
  flushAll;
  listKeys;
  ping;
  close;
  acquireLock;
  releaseLock;
}
```

`MemoryStore`: In-process Map, `maxEntries` aşılınca en eski entry silinir (FIFO). Yalnızca development ve test içindir; production config doğrulaması `CACHE_BACKEND=memory` ile başlamayı reddeder.

`RedisStore`: `ioredis`, release bazlı `ssr:<release-id>:` namespace'i ve `SCAN` tabanlı toplu silme kullanır. Cache varsayılan olarak fail-open'dır: Redis yokken read/write işlemleri cache miss gibi davranır ve SSR isteğini düşürmez. Adapter korunur ve ioredis arka planda yeniden bağlanır; pod-local memory cache'e geçilmediği için replica'lar arasında ayrışmış cache oluşmaz. `CACHE_REQUIRED=true` readiness'i Redis'e sıkı bağlar.

SWR revalidation aynı key için process içinde deduplicate edilir ve Redis `SET NX PX` kilidiyle podlar arasında tekilleştirilir. Başarısız loader/render/write denemeleri üstel backoff ile sınırlı sayıda tekrar edilir. Sunucu kapanırken aktif revalidation işleri `SWR_DRAIN_TIMEOUT_MS` süresince beklenir; böylece işler kontrolsüz fire-and-forget bırakılmaz.

Cold cache miss de ayrı bir fill kontratıdır. Aynı process'teki request'ler key bazlı tek Promise'i
bekler; replica'lar `cold-fill:<key>` namespace'inde token sahipli, kısa TTL'li Redis `SET NX PX`
lock'u kullanır. Lock'u alamayan pod cache'i kısa aralıklarla poll eder; owner yazınca `HIT`/`STALE`
body'yi kullanır, owner başarısız olup lock'u bırakırsa bekleyenlerden biri fill'i devralır. Wait
bütçesi dolarsa erişilebilirliği korumak için response cache'e yazılmadan bir kez render edilir;
`lock_timeout` metriği bu kontrollü stampede riskini görünür kılar. Redis erişilemiyorsa podlar arası
garanti kaybolur fakat process içi coalescing devam eder.

Cold fill loader + render işi `CACHE_FILL_TIMEOUT_MS` ile sınırlıdır ve timeout `AbortSignal` olarak
request-scoped gateway çağrılarına taşınır. `CACHE_FILL_WAIT_MS` distributed waiter bütçesini,
`CACHE_FILL_POLL_MS` polling aralığını belirler. `ssr_cache_fill_*`,
`ssr_cache_coalesced_wait_*` ve `ssr_cache_lock_timeout_total` metrikleri fill sonucu, process/Redis
bekleme süresi ve lock timeout'u kapalı label setleriyle ölçer.

Redis burada **origin içindeki HTML body cache'idir**; HTTP/CDN shared cache değildir. Shared route
body'si Redis'ten `HIT` veya `STALE` gelse bile browser'a gönderilen HTML response'u varsayılan olarak
`Cache-Control: private, no-cache, max-age=0` taşır. Böylece Redis key'inde bulunan device, locale,
theme ve public rewrite path boyutlarının bunlardan habersiz bir downstream CDN tarafından
karıştırılması engellenir. Finalization sırasında response'a herhangi bir `Set-Cookie` eklenirse
policy koşulsuz `private, no-store` olur. Tracking ID request context'inde ve cookie'de kalır;
kullanıcıya özel `x-tracking-id` response header'ı yayınlanmaz. İleride edge HTML cache açılacaksa bu
ayrı, opt-in bir özellik olarak normalized vary header'ları ve cookie stripping kontratıyla
tasarlanmalıdır.

Cache cardinality request input'uyla sınırsız büyüyemez. Public pagination `1..1000` aralığındadır;
eksik `page` canonical page 1, `page=1` ve zero-padded değerler 308 canonical redirect, malformed veya
limit dışı değerler 404 üretir. Redirect/404 kararı cache lookup'tan önce policy'yi `none` yaptığı
için bu URL'ler Redis entry oluşturmaz. `city` ve recourse `page` iş-domain değerleri deployment
env'inden gelmez; gateway/CMS'in `/routing/domains` snapshot'ı otoritedir. Snapshot runtime shape ve
64 karakterlik lowercase slug sınırından geçip Redis'te beş dakika tutulur. Route'un async
`validateParams` kontratı bu registry'yi page cache lookup'tan önce kontrol eder. Gateway katalog
response'u page, pageSize, totalPages, array ve string üst sınırlarıyla doğrulanır; pagination en
fazla dokuz görünür öğe üretir. Pagination SSR çıktısı gerçek `<a href>` linklerinden oluşur; aktif
sayfa link olmayan `aria-current="page"` span'idir. Page 1 query'siz canonical kullanır, page 2+
normalize `?page=N` ile self-canonical'dır. Sitemap query pagination URL'lerini içermez;
indexable katalog pagination'ı `index,follow`, document-level `rel=prev/next` ve semantic page linkleriyle
keşfedilir. Teknik demo route'ları production yüzeyine ve sitemap'e alınmaz.

Finans araçlarının cache politikası iş yüküne göre ayrılır. `/araclar/kredi-hesaplama` tutar, vade ve
faiz kombinasyonları nedeniyle `neverCache()` kullanır; her kullanıcı girdisini Redis key'ine çevirmek
yasaktır. `/karsilastir/kredi-kartlari` en fazla üç ürünü kabul eder, seçim URL'lerini `noindex,follow`
ve sabit base canonical ile yayınlar, HTML cache'e yazmaz. `/bankalar/:slug` ise gateway tarafından
tanınan küçük banka domain'ine sahiptir ve locale/layout boyutlarıyla 15 dakika shared cache kullanır.
UTM/gclid gibi içeriği değiştirmeyen query'ler bu key'lere girmez.

Her başarılı cache write route label'ı kontrollü olacak şekilde body byte, key byte ve process başına
bounded distinct-key observation metriği üretir. `k8s/prometheus-rules.yaml`, 2000 key'lik gözlem
penceresinin %80'i, overflow ve 512 KiB p95 body boyutu için alarm örneklerini içerir. Bu gauge Redis
keyspace'in kesin sayacı değil, pod-local erken uyarıdır; kesin operasyonel envanter purge/list API
veya Redis exporter üzerinden alınır.

Gateway içeriğindeki URL'ler render katmanına ham biçimde geçmez. `src/lib/content-url.ts` merkezi
policy'si navigation için root-relative ve same-origin URL'leri kabul eder; cross-origin hedef ancak
gateway item'ında `external: true` ise ve HTTPS kullanıyorsa geçerlidir. `mailto:` ve `tel:` de yalnız
bu açık external kontratında kabul edilir. `javascript:`, `data:`, `file:`, protocol-relative URL,
backslash/control karakteri, credential ve 2048 karakteri aşan değerler reddedilir.

Gateway JSON cevapları `server/gateway-payload.ts` ortak sınırından geçer. Her endpoint'in byte
bütçesi response okunmadan `Content-Length`, okunduktan sonra gerçek UTF-8 byte boyutuyla uygulanır;
bozuk JSON ile schema ve size ihlalleri ayrı nedenlerdir. Küçük `src/lib/runtime-schema.ts` katmanı
bounded string/array, record ve finite number kontrollerini ortaklaştırır. Offers, blogs, menu,
page/SEO, route-domain, profile, account, auth refresh ve CMS redirect kontratlarının tamamı bu
sınırı kullanır. Menü ayrıca maksimum üç seviye, seviye başına 50 ve payload genelinde 200 item
sınırı uygular. CMS `seoInfo` için `src/lib/metadata/schema.ts` aynı görevi görür. Canonical ve
`og:url` yalnız `SITE_URL` origin'ine resolve edilebilir; dış HTTPS yalnız OG/Twitter image gibi medya
alanlarında kabul edilir. Final metadata merge policy'yi yeniden uyguladığı için eski cache girdisi
veya route-level metadata da bu sınırı aşamaz.

Finans kontratları ayrıca iş alanına özgü limit taşır: hesaplama tutarı `100.000..10.000.000`, vade
kapalı seçenek kümesi ve faiz iki ondalıklı `0,01..20` aralığındadır; ödeme planı satır sayısı vadeyle
aynı olmalıdır. Kart karşılaştırması 2–3 benzersiz bounded slug kabul eder. Banka profilinde HTTPS ve
credentials içermeyen dış URL, bounded müşteri kanalı ve bounded ürün koleksiyonları zorunludur.
Geçersiz payload `finance_tools` metriğinde `json|schema|size` nedeni ile görünür.

Failure politikası kritikliğe göre açıktır: route'un ana içeriği olan offer/blog/page/domain
payload'ı geçersizse route hata yoluna gider. Menü cache'i fresh veya stale doğrulanmış son snapshot'ı
sunabilir; kullanılabilir snapshot yoksa shell boş ve geçerli menu modeliyle degrade olur.
Profile/account/auth doğrulaması geçersiz payload'ı oturum doğrulanmış
saymaz; CMS redirect ise kural yokmuş gibi devam eder. Her red `contract` ve kapalı
`json|schema|size` label'larıyla `ssr_gateway_invalid_payload_total` metriğini, shell fallback'i de
`ssr_shell_degraded_total` metriğini artırır.

Her entry şu yapıdadır:

```typescript
{
  body: string;
  freshUntil: number;
  staleUntil: number;
}
```

TTL dolduğunda entry silinmez, `read()` sırasında kontrol edilir ve silinir (lazy eviction).

---

### 6. Route Sistemi

#### Route Tanımı — `src/lib/types.ts`

```typescript
type Route<T> = {
  path: string;
  cache?: (ctx: Ctx) => CachePolicy;
  loader: (ctx: Ctx) => Promise<LoaderResult<T>>;
  Component: ({ data: T }) => ReactElement;
  NotFoundComponent?: () => ReactElement;
  ErrorComponent?: ({ error: RouteError | null; status: number }) => ReactElement;
  generateMetadata?: (data: T, ctx: Ctx) => PageMetadata;
  pageMeta?: (data: T, ctx: Ctx) => PageAnalyticsMeta;
  minimalChrome?: boolean;
};
```

Loader'dan Component'e giden `T` tipi boyunca type-safe. `defineRoute<T>()` helper'ı inference için kullanılır.

Loader sonucu açık bir terminal kontratıdır:

```typescript
type LoaderResult<T> =
  | { kind?: "data"; data: T; status?: number; headers?: Record<string, string> }
  | { kind: "notFound"; headers?: Record<string, string> }
  | { kind: "redirect"; location: string; status?: 301 | 302 | 303 | 307 | 308 }
  | { kind: "error"; error: { code: string; message: string }; status?: number };
```

`notFound`, `redirect` ve `error` terminaldir; render edilmiş çıktıları shared HTML cache'e yazılmaz.
Eşleşmeyen route ve `notFound` sonucu normal `RootLayout` içinde, `noindex` metadata ile render edilir.
Beklenen domain hataları `ErrorComponent`'e güvenli `{ code, message }` verisiyle ulaşır. Loader veya
route render exception'ında aynı component `error: null` alır; exception mesajı, stack ve üretilen
`errorId` HTML'e taşınmaz. `errorId` yalnız yapılandırılmış server logunda bulunur. Route boundary'nin
kendisinin veya shell'in hata vermesi ayrı global hata sayfasına düşer. Varsayılan retry aksiyonu
`href=""` üretmez; semantic button, client bootstrap'taki `location.reload()` listener'ını tetikler.

SSR route method kontratı `GET, HEAD` ile kapalıdır. Diğer methodlar loader/pipeline çalışmadan `405`
ve `Allow: GET, HEAD` alır; açık Hono BFF handler'ları kendi method kontratına sahiptir. `HEAD`, route
ile aynı auth/session/redirect pipeline'ından geçer. Shared cache hit'inde loader çalışmadan cached GET
metadata'sını döner; miss'te `notFound`, `redirect`, `error`, custom status ve header kararlarını almak
için loader'ı çalıştırır. React render, body üretimi, cache fill ve SWR başlatmaz.

#### Rewrite/Redirect Kuralları — `src/routing/rules.ts`

Next.js `rewrites()` / `redirects()` ekvivalenti, statik dizi olarak tanımlanmış:

```typescript
rewrites: [
  { source: "/konut-kredisi", destination: "/housing-loans" }, // internal rewrite
  { source: "/konut-kredisi/:slug", destination: "/housing-loans/:slug" },
  { source: "/basvuru/:page/yonlendirme", destination: "/recourse/:page/redirect" },
];
```

External rewrite çekirdeği desteklenir fakat uygulama kural tablosunda `/api/:path*` gateway
pass-through'u yoktur. Browser'ın gateway yüzeyi explicit Hono BFF handler'larıyla açılır. Yeni bir
external rewrite gerekiyorsa route, method ve taşınacak header'lar ayrıca incelenir; proxy cookie,
authorization, `Set-Cookie` veya upstream debug header'larını varsayılan olarak taşımaz.

Redirect'ler rewrite'lardan önce çalışır. Dış URL (`http://...`) varsa proxy, iç URL varsa rewrite.
Bu tablodan da önce `normalizePublicUrl()` çalışır. Ardışık slash tek slash'a iner, root dışındaki
trailing slash kaldırılır, segmentler Unicode NFC biçimine normalize edilir ve query byte sırası
korunur. Normal olmayan URL `308` ile tek public kimliğe gider; malformed percent-encoding ile
percent-encoded `/` veya `\` separator `400` alır. Global lowercase uygulanmaz: route case-sensitive
kalır; gerçek bir ürün ihtiyacı varsa `casePolicy: "lowercase"` yalnız ilgili route/prefix policy'sinde
açılabilir.
Routing çözümlemesi bilinçli olarak **tek geçişlidir**: rewrite destination'ı ikinci kez rule tablosuna
sokulmaz, doğrudan uygulama router'ına verilir. Böylece zincir/döngü davranışı konfigürasyon sırasına
gizlenmez.

Incoming query destination query ile birleştirilir; aynı anahtar iki tarafta da varsa açıkça yazılmış
destination değeri kazanır. Internal rewrite sonucu `pathname` ve `search` olarak ayrı taşınır;
query hiçbir zaman pathname içine gömülmez. Aynı `mergeSearchParams()` utility'si statik
redirect/rewrite/proxy ve gateway'den gelen CMS redirect için kullanılır; iki redirect kaynağı farklı
semantik uygulayamaz. Destination fragment'i server redirect/proxy kontratının parçası değildir ve
`Location` üretilmeden önce silinir. Named parametreler tek path segmenti olarak encode edilir, yalnız
`:path*` segment sınırlarını korur.

Server başlamadan önce rule tablosu doğrulanır. Geçersiz pattern/destination, bilinmeyen destination
parametresi, self-rewrite, semantik duplicate ve daha önceki redirect/catch-all tarafından tamamen
gölgelenen kurallar startup hatasıdır. Desteklenen pattern alt kümesi `:param`, final `:param?` ve final
`:path*` biçimleridir. Header/cookie/host koşulları ile `beforeFiles`/`afterFiles`/`fallback` fazları
bilinçli olarak bu kontratın dışında tutulmuştur.

#### Route Matcher — `src/lib/match.ts`

Sıfırdan yazılmış, segment bazlı matcher. `:param` ve `:param?` (optional) destekler. `decodeURIComponent` hatalı olursa `null` döner (404). İlk eşleşme kazanır, sıralama önemlidir.

---

### 7. Island Architecture — `src/lib/island.tsx` + `src/entry.client.tsx`

#### Server Tarafı

```tsx
<Island name="mobile-menu" mode="hydrate" props={{ items }} eager>
  <StaticFallback />
</Island>
```

Her island root'u React'in `onCaughtError`, `onUncaughtError` ve `onRecoverableError` callback'lerini
kullanır. Module import, props parse ve mount hataları da aynı client telemetry hattına gider. Payload
aynı-origin `/api/internal/client-errors` endpointinde boyut ve alan allowlist'iyle doğrulanır; server
loguna `releaseId`, request ID ve client error ID ile yazılır. Endpoint 16 KiB payload sınırı, process
başına fixed-window rate limit ve deterministik sampling uygular; accepted/invalid/sampled/rate-limited
sonuçları bounded metric'tir. Telemetry gönderiminin başarısız olması island mount akışını bozmaz.

Render edilen HTML'de örneğin
`<div data-island="mobile-menu" data-mode="hydrate" data-props='{"items":[{"url":"\/kredi"}]}'>`
olarak çıkar.

#### Embedded JSON ve crawl inventory kontratı

Island prop'ları gerçek link değildir; hydration/mount sırasında client'a taşınan public veridir.
Buna rağmen `/bilgi-merkezi?...` veya `https://...` gibi ham URL-benzeri string'lerin crawler-visible HTML
içinde tekrar görünmesi istenmeyen URL keşfi ve gereksiz crawl denemeleri üretebilir. Gerçek navigasyon
otoritesi yalnız semantik `<a href>`, canonical ve sitemap'tir.

Bu nedenle HTML'e gömülen bütün island JSON'u `serializeEmbeddedJson()` üzerinden geçer:

```text
publicPath: /bilgi-merkezi?page=2
        ↓ serializeEmbeddedJson
HTML:       \/bilgi-merkezi?page=2
        ↓ dataset.props + JSON.parse
Client:     /bilgi-merkezi?page=2
```

`\/` RFC 8259'a göre geçerli solidus escape'idir; client manuel string replacement yapmaz,
`JSON.parse` orijinal değeri geri üretir. Aynı serializer `<`, `>`, `&`, U+2028 ve U+2029
karakterlerini de JSON escape biçimine dönüştürür. Böylece kontrat ileride data attribute'tan inline
JSON/script container'a taşınsa da HTML/script boundary güvenliği korunur.

Kapsam yalnız crawler-visible HTML'e embedded JSON'dur. Gerçek `href`/`src`, API JSON response'ları,
Redis entry'leri ve structured loglar değiştirilmez. ESLint, JSX içinde doğrudan `JSON.stringify()`
gömülmesini engeller; unit ve full-document testleri hem escaped source'u hem client round-trip'ini
korur.

Referanslar: [RFC 8259 JSON string grammar](https://www.rfc-editor.org/rfc/rfc8259),
[Google crawlable link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable),
[Google crawl budget management](https://developers.google.com/crawling/docs/crawl-budget).

| mode      | Server                 | Client                                                 |
| --------- | ---------------------- | ------------------------------------------------------ |
| `hydrate` | Full render (SEO-safe) | `hydrateRoot` — DOM'u yakalar                          |
| `defer`   | Sadece fallback render | `createRoot` — fresh mount, kendi data'sını fetch eder |

`/araclar/kredi-hesaplama`, gerçek `hydrate` kontratının referansıdır. Gateway'in döndürdüğü ilk
hesaplama hem server'da island child'ı olarak render edilir hem `data-props` ile aynı component'e
aktarılır; client `hydrateRoot` ile aynı DOM'u devralır. Form submit sonrasında formül client'ta tekrar
yazılmaz, same-origin BFF gateway'e gider. Fetch başarısız olursa son doğrulanmış SSR sonucu görünür
kalır ve hata `aria-live` alanında gösterilir. JavaScript yoksa standart GET formu aynı sonucu full
document olarak üretir.

`defer` mode'u cache güvenliğini sağlar: account dashboard veya kişiselleştirilmiş içerik cache'deki HTML'e dokunmaz, client mount olunca `/api/internal/account/summary` çağırır.

#### Client Tarafı

Vite `import.meta.glob("./islands/*.tsx")` ile tüm island'ları code-split eder. Her island kendi
chunk'ıdır. `eager` root'lar (layout, analytics) observer kurulmadan önce başlatılır; diğerleri
`IntersectionObserver` (`rootMargin: 200px`) ile viewport'a yaklaşınca yüklenir. API yoksa,
constructor override edilmişse veya `observe()` hata verirse bütün lazy island'lar doğrudan mount
edilerek client bootstrap fail-open kalır.

`eager` çalışma kararı ile network preload kararı ayrı kontratlardır. Production document,
`layout-client` ve `page-analytics` chunk'larını Vite manifestinden bulur; bunlarla ana entry'nin
recursive static `imports` grafiğini tekilleştirerek `<link rel="modulepreload">` üretir. Böylece
browser bu modülleri entry çalışıp DOM'daki `data-eager` root'ları keşfetmeden önce indirmeye
başlayabilir. Route'a özgü kritik island'lar `Route.preloadIslands` ile opt-in eklenir. Viewport/deferred
island'lar listeye otomatik girmez ve kullanılmayacak JS'nin ilk yükte indirilmemesi korunur.

Island module yüklemesi toplam 10 saniyelik bütçe, React root ise gerçek effect commit'ine kadar ayrı
10 saniyelik watchdog taşır. Yalnız browser online, document visible ve hata transient module-fetch
sınıfındaysa 250ms sonra tek retry yapılır. Missing module, chunk load, timeout, props parse, mount ve
React root hataları ayrı telemetry source'larıdır. Inline GTM EventQueue, `page-analytics` chunk'ı hiç
yüklenemese bile 5 saniye sonra `gtm.dom`/`gtm.load` kuyruğunu serbest bırakır; analytics arızası
lifecycle event'lerini sonsuza kadar tutmaz.

---

### 8. BFF API Katmanı — `server/api/internal/`

Client-side TanStack Query hook'ları bu endpoint'leri çağırır:

| Endpoint                            | Açıklama                                       |
| ----------------------------------- | ---------------------------------------------- |
| `GET /api/internal/auth/session`    | HttpOnly oturumu gateway profiliyle doğrular   |
| `POST /api/internal/refresh`        | Client 401 sonrası token refresh               |
| `GET /api/internal/account/summary` | Auth gerektirir, gateway'den profil + stats    |
| `POST /api/referrals`               | Ürünü doğrular, güvenli HTTPS hedefe 303 verir |

Auth gerektiren endpoint'ler için `authenticateBffRequest()` helper'ı kullanılır — pipeline'daki auth mantığını tekrar çalıştırır, gerekiyorsa refresh eder, Authorization inject eder.

**401 retry pattern:** `src/lib/client/api-fetch.ts` client fetch'leri wrap'ler. 401 alınca `/api/internal/refresh` çağırır ve isteği tekrarlar.

### Bağımsız Mock Gateway — `mock-gw/`

Uygulama process'i mock veri veya gateway fallback'i içermez. Local geliştirmede 4002 portunda
çalışan dependency'siz Node.js `mock-gw` servisine normal HTTP üzerinden bağlanır. Menü, sayfa/SEO,
redirect, teklifler, bloglar, finansal ürünler, Bilgi Merkezi, piyasa verileri, başvuru yönlendirme,
profil, hesap özeti, token refresh ve bot analytics sözleşmeleri bu servistedir. Bot analytics
endpoint'i tek request/tek event yerine üst sınırı doğrulanan batch kabul eder. Test suite de aynı
server'ı rastgele bir portta başlatır. Gerçek gateway'e geçişte UI bileşenlerine dokunulmaz; endpoint
servisleri aynı kontratı korur ve yalnızca `GATEWAY_URL` değiştirilir.

Yeni örnek sayfalar da aynı route kontratını izler: `server/routes` loader/cache/metadata kararlarını,
`server/services` gateway ve runtime payload sınırını, `src/features` SSR-safe sunumu taşır. Konut
kredisi, kredi kartı, Bilgi Merkezi ve BIST 100 filtreleri semantic GET formudur; liste ve pagination
linkleri JavaScript olmadan çalışır. Serbest metin aramaları sınırsız cache cardinality üretmemesi için
shared HTML cache dışındadır. Başvuru formu ise gateway hedefini browser'a açmadan önce BFF üzerinden
yeniden doğrular.

### Referral ölçüm kontratı

Banka yönlendirmesi bir client analytics olayı veya doğrudan dış hedefe giden `<a>` değildir. SSR
sayfası `/api/referrals` adresine semantic bir `POST` formu üretir; BFF ürün tipini merkezi registry
üzerinden doğrular, gateway'den kısa ömürlü hedef alır ve güvenli HTTPS adrese `303` döner. Banka URL'si
HTML'e girmez; crawler, prefetch veya tekrar hydration referral sayısını artırmaz.

Gateway'e gönderilen `referral_session` rastgele, kişisel veri içermeyen ve `HttpOnly` bir cookie'dir.
Bu kimlik toplam yönlendirme ile yaklaşık benzersiz browser/session sayısını ayırır; yetkilendirme
amacıyla kullanılmaz. Konut kredisi ve kredi kartı yalnız registry kayıtlarıdır; taşıt ve ihtiyaç
kredisi aynı kontrata yeni kayıt eklenerek bağlanır.

Prometheus tarafında `ssr_referral_redirects_total`, BFF toplam süresini ölçen
`ssr_referral_redirect_duration_milliseconds` ve gateway ticket süresini ölçen
`ssr_referral_gateway_processing_milliseconds` yayınlanır. Operasyon özeti
operations listener'daki `GET /api/internal/referrals/stats` üzerinden `REFERRAL_STATS_SECRET` ve
NetworkPolicy ile korunur. Sayılar bilinçli
olarak **redirect-issued** semantiğindedir: sistem bankaya yönlendirme kararını kesin ölçer; bankanın
landing sayfasının açıldığını veya başvurunun tamamlandığını ancak banka callback/postback'i varsa
ölçebilir.

### Canlı piyasa: hızlı snapshot + güvenli SSE island

BIST sayfası iki ayrı freshness kontratı kullanır. İlk HTML, Redis'teki 30 saniyelik SSR snapshot'tan
anında gelir ve JavaScript/socket çalışmasa bile kullanılabilir tablo sunar. Above-the-fold
`market-live` island hydrate olduktan sonra aynı-origin `GET /api/markets/stream` SSE kanalına bağlanır;
yalnız fiyat, değişim, gün içi aralık ve zaman alanları yerinde güncellenir. Canlı olaylar HTML cache
key'i veya Redis write üretmez.

Akış tek yönlü olduğu için WebSocket yerine SSE seçilmiştir. Browser gateway credential'ı veya upstream
URL'si görmez; BFF gateway'e server-only `MARKET_STREAM_TOKEN` taşır. BFF katmanı `Origin` /
`Sec-Fetch-Site` kontrolü, zorunlu `Accept: text/event-stream`, kapalı sembol formatı, en fazla 25 sembol,
IP ve process başına aktif bağlantı kotası, beş dakikalık connection rotation, `no-store/no-transform`
ve proxy buffering yasağı uygular. Upstream event'leri hem server hem client tarafında runtime schema,
finite sayılar, timestamp ve monotonic sequence ile doğrulanır.

Bir Node process'indeki browser bağlantıları tek upstream gateway stream'ini paylaşır; yavaş client için
queue büyütülmez, yalnız en yeni batch tutulur. Sekme arka plana geçtiğinde client bağlantıyı kapatır;
online/visible olduğunda jitter'lı exponential backoff ile yeniden bağlanır. Stream yoksa SSR snapshot
ekranda kalır. Limitler process başınadır; çok podlu production'da load balancer/WAF seviyesinde ayrıca
cluster ve IP connection limiti uygulanmalıdır.

---

### 9. Build ve Runtime

```
Dev:   Vite dev server (HMR/Fast Refresh) + tsx watch (Hono) + mock-gw
       scripts/dev.mjs · .env.development (memory cache)
       npm run dev:redis → .env.development.redis overlay + Docker Redis
Prod:  scripts/build.mjs · .env.production
       npm run start / start:staging
       node dist/server/index.js
```

Ortam dosyaları: `.env.development` (memory), `.env.staging`, `.env.production`. Kişisel
override: `.env.local`. Yükleme: `scripts/load-env.mjs`; npm script'leri `scripts/run-with-env.mjs`
üzerinden doğru dosyayı seçer.

Development'ta server restart için `tsx`, client HMR için Vite dev server kullanılır. Production'da
server TypeScript'i çalıştırılmaz; Vite `server/index.ts` entrypoint'ini `dist/server/index.js` olarak
bundle eder. Docker runtime katmanı yalnızca production bağımlılıklarını ve `dist/` çıktılarını içerir.

Production client build `src/entry.client.tsx` başlangıç noktasıyla `dist/client/` altına island
bundle'ları + CSS üretir. Manifest (`manifest.json`) sunucu tarafından okunarak HTML'e doğru hashed
asset URL'leri enjekte edilir. `server/assets.ts`, `isEntry`, `isDynamicEntry`, `src`, `file` ve
recursive `imports` alanlarını kullanarak global ve route-scoped island preload grafiğini çıkarır.
Ortak dependency URL'leri document başına tek linke indirilir. CDN varsa `ASSET_CDN_URL` env ile asset
base URL değiştirilir.

Development bu manifest yolunu kullanmaz. `scripts/dev.mjs` Hono, mock gateway, Vite dev server ve
`tsx watch` süreçlerini tek lifecycle altında çalıştırır. Hono document'i Vite `/@vite/client`, React
Refresh preamble ve source `src/entry.client.tsx` modülünü enjekte eder. Island/client değişiklikleri
Fast Refresh ile uygulanır. SSR üreten `server/`, `src/features/` ve paylaşılan component değişiklikleri
Hono restartından sonra Vite websocket üzerinden bilinçli full document reload üretir. Böylece client
değişikliğinde gereksiz reload yapılmaz, SSR değişikliğinde eski HTML ile yeni client ağacı karışmaz.
`VITE_DEV_SERVER_URL` production config doğrulamasında reddedilir; production manifest davranışı dev
runtime'dan bağımsız kalır.

### 10. Instrumentation, Tracing ve Metrikler

`server/instrumentation.ts`, framework convention'ına bağlı olmayan process lifecycle noktasıdır.
Server request kabul etmeden önce OpenTelemetry SDK'yı kaydeder; graceful shutdown exporter kuyruğunu
flush eder. `OTEL_EXPORTER_OTLP_ENDPOINT` tanımlı değilse tracing no-op kalır ve local geliştirme bir
collector zorunluluğu taşımaz.

```text
HTTP server span
  ├─ cache.read / cache.write       (memory veya Redis)
  ├─ route.loader
  │    └─ gateway METHOD /path      (W3C trace context + correlationid)
  ├─ ssr.render
  └─ cache.revalidate
       ├─ cache lock
       ├─ route.loader
       └─ ssr.render
```

Inbound `traceparent`/`tracestate` extract edilir, aktif context bütün async request zincirinde
korunur ve gateway'e inject edilir. Üretilen request ID tracing kapalıyken de AsyncLocalStorage ile
gateway'e taşınır. Structured loglar `releaseId`, `traceId` ve `spanId` ile trace-log korelasyonu
sağlar; release aynı zamanda OTel resource `service.version` değeridir.

Cluster-only metrics listener'ındaki `/metrics` request, gateway, gateway payload rejection, shell degradation, cache operation, SWR
revalidation ve bot analytics dispatcher için bounded-label counter, gauge ve histogram üretir.
Gateway outcome label'ları `success`, `client_error`, `server_error`, `timeout` ve `network_error` ile
dashboard/alert tarafında hata oranının hesaplanmasını sağlar. Bot kuyruğunda enqueue sonucu, drop
nedeni, batch sonucu/süresi/boyutu, queue depth, in-flight batch ve shutdown drain sonucu izlenir.
Event-loop p50/p95/p99 lag, CPU, RSS/heap, uptime ve release info process metrikleri de aynı
endpoint'tedir. Request ID, raw URL, cache key ve kullanıcı kimliği metric label'ı değildir.

### 10.1 Merkezi SEO, Structured Data, Robots ve Sitemap

Gateway/CMS, her gerçek sayfa payload'ında bounded `seoInfo` döndürür. Parser title/description,
friendly/canonical URL, OG image boyut/alt bilgisi, index/follow kararı ve Article tarih/yazar/tag
alanlarını doğrular. Merge katmanı canonical ve `og:url` değerlerini `SITE_URL` origin'ine sabitler;
her indexable graph'a `Organization`, `WebSite` ve `WebPage` kimliği ekler. Route'lar görünür içeriğe
göre `BreadcrumbList`, `ItemList`, `Article`, `FAQPage`, `LoanOrCredit`, `CreditCard` veya piyasa
listesi düğümleri ekler. Gerçek review/rating/offer verisi yoksa sentetik rich-result alanı üretilmez.
JSON-LD tek `@graph` olarak, embedded JSON escaping ve production CSP nonce'u ile yazılır.

`server/seo.ts`, root seviyesinde `robots.txt` ve XML sitemap üretir. Sitemap yalnız canonical public
URL'leri içerir; internal rewrite destination'ları, account/noindex/teknik demo route'ları, filtreler
ve query pagination sayfaları dışarıda kalır. Ürün, kredi kartı ve makale detay envanteri
`/seo/sitemap` gateway kontratından gelir; gerçek makale güncelleme tarihi `lastmod` olur. Gateway
kesilirse statik kategori sitemap'i yine `200` döner ve dynamic entries kontrollü degrade olur.
Opsiyonel Google/Bing/Yandex doğrulama token'ları config'ten tüm document head'lerine eklenir.

Config startup'ta `GTM_CONTAINER_ID` için kapalı `GTM-*` formatını; `SITE_URL` ve `GATEWAY_URL` için
origin/credential/query/hash politikasını; `ASSET_CDN_URL` için HTTP(S), credential ve query/hash
sınırını doğrular. Production dış originleri varsayılan HTTPS'tir. In-cluster HTTP gateway yalnız
deploy tarafından açıkça `ALLOW_INSECURE_GATEWAY=true` seçilirse kabul edilir.

### 11. Responsive Image ve Self-host Font Pipeline

Image optimizasyonu request sırasında Node process'inde yapılmaz. `scripts/build-media.mjs`, client
build'inden sonra `server/media.config.json` kaynaklarını Sharp ile işler:

```text
src/assets/images/*
       │
       └─ Sharp build step ─┬─ AVIF  480/768/1200/1600
                            ├─ WebP  480/768/1200/1600
                            ├─ JPEG  480/768/1200/1600
                            └─ asset-pipeline.json

Fontsource WOFF2 subsets ───── hashed latin + latin-ext + OFL license
```

`ResponsiveImageData` intrinsic width/height, format source'ları ve srcset bilgisini tek kontratta
taşır. `ResponsiveImage` bu boyutları daima DOM'a yazar; `sizes` zorunludur, normal görsel native lazy
loading kullanır. LCP adayında route `preloadImages` tanımlar ve aynı srcset/sizes hem document head
preload'unda hem `<picture>` içinde kullanılır. Böylece preload ile gerçek request ayrışmaz.

`IMAGE_CDN_URL` doğrudan dosya CDN prefix'idir. Build edilmiş responsive varyantlar ve original source
bu prefix altında yayınlanabilir; prefix'in `/images` gibi path bölümü korunur. `UnoptimizedImage`,
manifestteki original source'u tek `src` ile kullanır: encode, `srcset` ve runtime image proxy yoktur;
intrinsic dimensions ve native lazy/eager davranışı yine kontratın parçasıdır.

`IMAGE_TRANSFORM_URL` ayrıca tanımlanırsa local manifest kaynak boyut ve width allowlist otoritesi
olmaya devam eder, fakat responsive URL'ler `url`, `w`, `q`, `format` query kontratına sahip transformer
üzerinden üretilir. Transformer yoksa production runtime Sharp taşımaz; build edilmiş immutable
dosyalar origin, `IMAGE_CDN_URL` veya genel `ASSET_CDN_URL` üzerinden servis edilir.

Fontlar browser'da Google'a veya başka bir üçüncü tarafa istek atmaz. Latin/Latin-Extended Inter
variable WOFF2 dosyaları manifest'ten preload edilir, `font-display: swap`, unicode-range ve
`@font-face` document head'e yazılır. Hash'li font/image dosyaları mevcut `/assets/*` immutable cache
kontratını kullanır.

`/medya-pipeline` route'u responsive LCP preload, unoptimized CDN prefix ve variable font weight/
subset davranışlarını aynı SSR document içinde görünür kılan executable documentation'dır.

---

## Stabilite Değerlendirmesi

### Güçlü Taraflar

**Mimari bütünlük yüksek.** Her parçanın tek bir sorumluluğu var ve sınırlar net çizilmiş. Accumulator pattern, Island'ların cache-safe tasarımı, bypass check registry gibi extension point'ler düşünülmüş.

**Test kapsamı kritik path'leri kaplıyor.** Handler'da SWR davranışı, stale cache korunması,
concurrent revalidation, auth refresh sonuç sınıfları, public API guard ve operations/public listener
ayrımı test edilmiştir.

**Auth güvenli tasarlanmış.** HttpOnly token cookie'leri, 30 saniye önceden refresh, authoritative
`400/401` ile transient `5xx/network` ayrımı ve replica-safe refresh coordination uygulanır. Local auth
cevapları ayrı `mock-gw` process'inden gelir.

---

### Çözülen Riskler

**Horizontal scale cache tutarlılığı:** Production'da memory backend yasaktır. Redis başlangıçta veya çalışma sırasında erişilemezse uygulama pod-local cache'e düşmez; cache işlemleri fail-open miss olarak devam eder ve Redis bağlantısı arka planda yeniden kurulur. Bu sayede replica'lar arasında bağımsız HTML cache ve purge tutarsızlığı oluşmaz.

**SWR fire-and-forget yaşam döngüsü:** Revalidation işleri process ve Redis seviyesinde deduplicate edilir, başarısızlıkta üstel backoff ile tekrar denenir ve graceful shutdown sırasında drain edilir. Varsayılan sayfa SWR penceresi 24 saatten 1 saate indirilmiştir. Ayarlar:

- `SWR_REVALIDATION_ATTEMPTS` — toplam deneme sayısı, varsayılan `3`
- `SWR_REVALIDATION_BACKOFF_MS` — ilk retry gecikmesi, varsayılan `250`
- `SWR_DRAIN_TIMEOUT_MS` — shutdown sırasında bekleme süresi, varsayılan `5000`

**Bot analytics bounded dispatch:** Bot request'i gateway I/O'sunu request lifecycle'ı dışında
doğrudan başlatmaz; yalnızca senkron olarak sınırlı process kuyruğuna event bırakır. Aynı bot/path
kombinasyonu kısa TTL ile pod içinde deduplicate edilir, sampling uygulanabilir ve event'ler bounded
batch worker'larıyla gönderilir. Queue dolu veya dispatcher kapanmışsa event drop metriğine yazılır;
kullanıcı request'i bekletilmez. Shutdown kısmi batch'i hemen flush eder, belirlenen sürede drain
olmazsa bekleyen event'leri drop edip aktif çağrıları abort eder. Ayarlar:

- `BOT_ANALYTICS_QUEUE_CAPACITY` — bekleyen event üst sınırı, varsayılan `1000`
- `BOT_ANALYTICS_CONCURRENCY` — aynı anda açık gateway batch çağrısı, varsayılan `2`
- `BOT_ANALYTICS_BATCH_SIZE` — request başına event üst sınırı, varsayılan `25`
- `BOT_ANALYTICS_FLUSH_MS` — eksik batch'in en uzun bekleme süresi, varsayılan `250`
- `BOT_ANALYTICS_DEDUP_TTL_MS` — bot/path pod-local dedup penceresi, varsayılan `60000`
- `BOT_ANALYTICS_SAMPLE_RATE` — kabul oranı, `0..1`; varsayılan `1`
- `BOT_ANALYTICS_DRAIN_TIMEOUT_MS` — shutdown drain bütçesi, varsayılan `3000`

**Cold cache miss stampede:** İlk fill aynı process'te Promise coalescing, podlar arasında token-safe
Redis lock ile tekilleştirilir. Lock waiter cache polling yapar ve lock erken boşalırsa fill'i devralır;
wait timeout'unda yalnız uncached fallback render çalışır. Loader/render bütçesi gateway request
signal'ına kadar taşınır. Ayarlar:

- `CACHE_FILL_TIMEOUT_MS` — loader + render bütçesi, varsayılan `2 × gateway timeout + 2000ms`
- `CACHE_FILL_WAIT_MS` — başka pod fill'ini bekleme bütçesi, varsayılan fill timeout + `500ms`
- `CACHE_FILL_POLL_MS` — cache/lock polling aralığı, varsayılan `100ms`

**Production telemetry:** Request loglarının ötesinde OpenTelemetry lifecycle, distributed trace
propagation, SSR/gateway/cache/loader/render span'leri, latency histogramları ve process metrikleri
vardır. Collector, dashboard, alert ve retention politikası deployment platformunun sorumluluğudur.

**Gateway payload güven sınırı:** Bütün gateway JSON consumer'ları endpoint byte bütçesi ve runtime
schema ile korunur. String/collection/depth/numeric sınırlar render veya cache'e ulaşmadan uygulanır;
`NaN`/`Infinity` ve aşırı `totalPages` kabul edilmez. Contract fixture'ları, malformed JSON, size
testleri ve deterministik mutation-fuzz corpus'u CI'da çalışır. `k8s/prometheus-rules.yaml` geçersiz
payload metriği için provider drift alarmı içerir.

### Açık Riskler ve Eksikler

**1. `@ts-expect-error` — streaming Request `duplex` tipi**

Node.js fetch streaming body için runtime'da `duplex: "half"` ister; mevcut DOM `RequestInit` tipi bu
alanı taşımadığı için external rewrite proxy kodunda suppression kullanılır. Gövdeler limitlidir ve
stream buffer edilmeden aktarılır. Bu düşük seviyeli bir tip uyumluluğu borcudur.

**2. Token expiry sadece heuristic**

`isAccessTokenExpired()` JWT payload'unu decode eder ama imzayı doğrulamaz. Manipüle edilmiş `exp` veya display name yalnızca lokal refresh/UI kararını etkileyebilir; korunan veri için nihai otorite gateway'dir ve geçersiz token'ı reddeder. Yine de UI oturum göstergeleri güvenlik kararı için kullanılmamalıdır.

**3. Deployment ve güvenlik kabulü dış sistemlere bağlıdır**

Kubernetes image digest'i, TLS secret'ı, gerçek ingress/monitoring/operations namespace adları,
gateway/site adresleri, `rediss` credential'ı ve secret değerleri CI/CD veya secret manager tarafından
doldurulmalıdır. CI dependency audit, Trivy ve CodeQL çalıştırır; gerçek gateway bağlandıktan sonra
staging DAST, bağımsız pentest, secret rotation tatbikatı ve incident rollback testi release gate'idir.
Ayrıntılı kabul listesi ve olay kararları [`docs/production-security.md`](docs/production-security.md)
belgesindedir.

---

## Genel Sonuç

Mimari olarak iyi düşünülmüş, tutarlı bir sistem. Next.js gibi bir framework'ün getirdiği overhead ve kısıtlamalar olmadan SSR + caching + auth'un nasıl el ile inşa edildiğini gösteren nadir örneklerden biri. Tasarım kararları savunulabilir ve birbiriyle çelişmiyor.

**Şu an stabil mi?** SSR, shared cache, SWR retry/drain, auth, public API guard ve production bundle
test edilmiştir. Production'a çıkış için kalan koşullar gerçek deployment değerleri, WAF/ingress
uyarlaması, gerçek gateway contract testleri ve bağımsız güvenlik kabulüdür.
