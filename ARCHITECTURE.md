# SSR-Kit — Mimari Analiz

## Projenin Özü

Bu proje, **Next.js veya Remix kullanmadan sıfırdan yazılmış bir SSR (Server-Side Rendering) framework'üdür.** Bir ürün değil, bir altyapı katmanıdır. Vite client island bundle'ını ve production Node.js server entrypoint'ini ayrı çıktılar olarak üretir.

Ana karar: **İsland Architecture** + **Shared HTML Cache** kombinasyonu. Vite, client island bundle'ının yanında production Node.js server entrypoint'ini de üretir. Sayfanın tamamı sunucuda render edilir, tarayıcıya statik HTML gider. Etkileşim gerektiren parçalar ("island") kendi JS chunk'ını lazy-load eder ve bağımsız olarak hydrate olur ya da client'ta mount edilir.

---

## Katmanlar ve Sorumluluklar

### 1. HTTP Katmanı — `server/index.ts`

Hono üzerinde çalışır, `@hono/node-server` ile Node.js HTTP server'a bağlanır. Şu endpoint'leri doğrudan yakalar:

| Path              | Açıklama                                                  |
| ----------------- | --------------------------------------------------------- |
| `/assets/*`       | Statik dosyalar, `dist/client` klasöründen sunulur        |
| `/healthz`        | Liveness check                                            |
| `/readyz`         | Readiness check (cache backend ping'i içerir)             |
| `/api/*`          | Gateway'e proxy — pipeline çalışmaz                       |
| `/api/internal/*` | BFF endpoint'leri — gereken auth handler içinde uygulanır |
| `*`               | SSR pipeline → handler                                    |

Graceful shutdown uygulanmış: SIGTERM/SIGINT alınca önce HTTP server kapatılır, ardından cache bağlantısı temizlenir. Force-exit için `SHUTDOWN_TIMEOUT_MS` (default 10s) var.

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

| Cookie          | httpOnly | Amaç                                  |
| --------------- | -------- | ------------------------------------- |
| `access_token`  | evet     | JWT, loader'lar tarafından kullanılır |
| `refresh_token` | evet     | Token yenileme                        |
| `signed_in`     | hayır    | UI ("Hesabım" / "Giriş Yap")          |
| `account_text`  | hayır    | Display name island'ları için         |

**Akış:**

1. `access_token` cookie'sini oku
2. Expire olmak üzere mi? (`exp * 1000 < now + 30s`) → `refresh_token` ile gateway'e POST
3. Refresh başarılıysa: yeni token'ları `httpOnly` cookie'lere yaz, `Authorization: Bearer ...` header'ı request'e inject et
4. Refresh başarısızsa (production): tüm auth cookie'leri sil (`Max-Age=0`), anonim devam et
5. Refresh başarısızsa (dev/test): mock JWT türet, devam et

**Kritik detay — in-flight deduplication:** Aynı `refresh_token` için eş zamanlı birden fazla refresh isteği gelse (`refreshesInFlight` Map'i) ikinci çağrı aynı Promise'i bekler, gateway'e iki istek gitmez. Aynı pattern handler'daki SWR revalidation için de geçerlidir.

---

### 4. SSR Handler — `server/handler.ts`

Tek bir `handle()` fonksiyonu. Yukarıdan aşağıya okunabilir, yan yol yok:

```
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

Global bypass check'ler kaydedilir. Default olarak `isAuthenticated` aktif:

```
access_token cookie | refresh_token cookie | Authorization header
  → CachePolicy { kind: "none" }  (authenticated kullanıcı asla cached HTML almaz)
```

Yeni bypass kuralı eklemek için:

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
  generateMetadata?: (data: T, ctx: Ctx) => PageMetadata;
  pageMeta?: (data: T, ctx: Ctx) => PageAnalyticsMeta;
  minimalChrome?: boolean;
};
```

Loader'dan Component'e giden `T` tipi boyunca type-safe. `defineRoute<T>()` helper'ı inference için kullanılır.

#### Rewrite/Redirect Kuralları — `src/routing/rules.ts`

Next.js `rewrites()` / `redirects()` ekvivalenti, statik dizi olarak tanımlanmış:

```typescript
rewrites: [
  { source: "/api/:path*", destination: "${gatewayUrl}/:path*" }, // proxy
  { source: "/emekli-bankaciligi", destination: "/retirement-banking" }, // internal rewrite
  { source: "/basvuru/:page/yonlendirme", destination: "/recourse/:page/redirect" },
];
```

Redirect'ler rewrite'lardan önce çalışır. Dış URL (`http://...`) varsa proxy, iç URL varsa rewrite.

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

Render edilen HTML'de `<div data-island="mobile-menu" data-mode="hydrate" data-props='{"items":[...]}'>` olarak çıkar.

| mode      | Server                 | Client                                                 |
| --------- | ---------------------- | ------------------------------------------------------ |
| `hydrate` | Full render (SEO-safe) | `hydrateRoot` — DOM'u yakalar                          |
| `defer`   | Sadece fallback render | `createRoot` — fresh mount, kendi data'sını fetch eder |

`defer` mode'u cache güvenliğini sağlar: account dashboard veya kişiselleştirilmiş içerik cache'deki HTML'e dokunmaz, client mount olunca `/api/internal/account/summary` çağırır.

#### Client Tarafı

Vite `import.meta.glob("./islands/*.tsx")` ile tüm island'ları code-split eder. Her island kendi chunk'ı. `IntersectionObserver` (rootMargin: 200px) viewport'a yaklaşınca chunk indirir. `eager` attribute olan island'lar anında yüklenir (layout, analytics).

---

### 8. BFF API Katmanı — `server/api/internal/`

Client-side TanStack Query hook'ları bu endpoint'leri çağırır:

| Endpoint                            | Açıklama                                        |
| ----------------------------------- | ----------------------------------------------- |
| `GET /api/internal/auth/session`    | `signed_in` + `account_text` cookie'lerini okur |
| `POST /api/internal/refresh`        | Client 401 sonrası token refresh                |
| `GET /api/internal/account/summary` | Auth gerektirir, gateway'den profil + stats     |
| `POST /api/internal/cache/purge`    | Cache purge, secret token ile korunur           |

Auth gerektiren endpoint'ler için `authenticateBffRequest()` helper'ı kullanılır — pipeline'daki auth mantığını tekrar çalıştırır, gerekiyorsa refresh eder, Authorization inject eder.

**401 retry pattern:** `src/lib/client/api-fetch.ts` client fetch'leri wrap'ler. 401 alınca `/api/internal/refresh` çağırır ve isteği tekrarlar.

---

### 9. Build ve Runtime

```
Dev:   vite build --watch  +  tsx watch server/index.ts   (concurrently)
Prod:  vite build (client) + vite build --config vite.server.config.ts
       node dist/server/index.js
```

Development'ta hızlı reload için `tsx` kullanılır. Production'da server TypeScript'i çalıştırılmaz; Vite `server/index.ts` entrypoint'ini `dist/server/index.js` olarak bundle eder. Docker runtime katmanı yalnızca production bağımlılıklarını ve `dist/` çıktılarını içerir.

Client build `src/entry.client.tsx` başlangıç noktasıyla `dist/client/` altına island bundle'ları + CSS üretir. Manifest (`manifest.json`) sunucu tarafından okunarak HTML'e doğru asset URL'leri enjekte edilir. CDN varsa `ASSET_CDN_URL` env ile asset base URL değiştirilir.

---

## Stabilite Değerlendirmesi

### Güçlü Taraflar

**Mimari bütünlük yüksek.** Her parçanın tek bir sorumluluğu var ve sınırlar net çizilmiş. Accumulator pattern, Island'ların cache-safe tasarımı, bypass check registry gibi extension point'ler düşünülmüş.

**Test kapsamı kritik path'leri kaplıyor.** Handler'da SWR davranışı, stale cache korunması, concurrent revalidation deduplication, auth'da in-flight deduplication, production'da fail-closed davranışı — bunların hepsi test edilmiş.

**Auth güvenli tasarlanmış.** httpOnly token cookie'leri, 30 saniye önceden refresh, production'da mock'suz fail-closed.

---

### Çözülen Riskler

**Horizontal scale cache tutarlılığı:** Production'da memory backend yasaktır. Redis başlangıçta veya çalışma sırasında erişilemezse uygulama pod-local cache'e düşmez; cache işlemleri fail-open miss olarak devam eder ve Redis bağlantısı arka planda yeniden kurulur. Bu sayede replica'lar arasında bağımsız HTML cache ve purge tutarsızlığı oluşmaz.

**SWR fire-and-forget yaşam döngüsü:** Revalidation işleri process ve Redis seviyesinde deduplicate edilir, başarısızlıkta üstel backoff ile tekrar denenir ve graceful shutdown sırasında drain edilir. Varsayılan sayfa SWR penceresi 24 saatten 1 saate indirilmiştir. Ayarlar:

- `SWR_REVALIDATION_ATTEMPTS` — toplam deneme sayısı, varsayılan `3`
- `SWR_REVALIDATION_BACKOFF_MS` — ilk retry gecikmesi, varsayılan `250`
- `SWR_DRAIN_TIMEOUT_MS` — shutdown sırasında bekleme süresi, varsayılan `5000`

### Açık Riskler ve Eksikler

**1. Repository teslim durumu**

Servis ve route taşımaları çalışma ağacında henüz stage/commit edilmemiş olabilir. Release veya PR öncesinde eski `src/services/*` ve `src/routes/*/index.tsx` silmeleriyle yeni `server/services/*` ve `server/routes/*` dosyalarının aynı commit'e girdiği doğrulanmalıdır. Bu runtime mimari riski değil, eksik commit oluşturabilecek bir teslim riskidir.

**2. `@ts-expect-error` — streaming Request `duplex` tipi**

Node.js fetch streaming body için runtime'da `duplex: "half"` ister; mevcut DOM `RequestInit` tipi bu alanı taşımadığı için request clone ve proxy kodunda suppression kullanılır. `/api/*` gövdeleri limitlidir ve stream buffer edilmeden aktarılır. Bu düşük seviyeli bir tip uyumluluğu borcudur; body kaybı veya sınırsız upload davranışı değildir.

**3. Token expiry sadece heuristic**

`isAccessTokenExpired()` JWT payload'unu decode eder ama imzayı doğrulamaz. Manipüle edilmiş `exp` veya display name yalnızca lokal refresh/UI kararını etkileyebilir; korunan veri için nihai otorite gateway'dir ve geçersiz token'ı reddeder. Yine de UI oturum göstergeleri güvenlik kararı için kullanılmamalıdır.

**4. Deployment girdileri dış sistemlere bağlıdır**

Kubernetes image digest'i, gateway/site adresleri, Redis URL'i ve secret değerleri CI/CD veya secret manager tarafından gerçek değerlerle doldurulmalıdır. Dependency audit de release pipeline'ında `npm run audit:prod` ile çalıştırılmalıdır.

---

## Genel Sonuç

Mimari olarak iyi düşünülmüş, tutarlı bir sistem. Next.js gibi bir framework'ün getirdiği overhead ve kısıtlamalar olmadan SSR + caching + auth'un nasıl el ile inşa edildiğini gösteren nadir örneklerden biri. Tasarım kararları savunulabilir ve birbiriyle çelişmiyor.

**Şu an stabil mi?** Temel işlevsellik (SSR, shared cache, SWR retry/drain, auth ve production bundle) test edilmiş ve çalışıyor. Production'a çıkış için kalan koşullar kod mimarisinden çok release operasyonlarıdır: değişikliklerin eksiksiz commit edilmesi, gerçek deployment değerlerinin sağlanması ve dependency audit'in CI'da başarılı olması.
