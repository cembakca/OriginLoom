# ssr-kit Konvansiyonları

Bu belge projede kod yazarken uyulması gereken yapı, isimlendirme ve operasyon kurallarını açıklar.

---

## Klasör yapısı

| Dizin                   | Amaç                                                            |
| ----------------------- | --------------------------------------------------------------- |
| `server/routes/`        | Loader, cache, metadata ve route tablosu                        |
| `src/routes/{name}/`    | Route'a özel SSR-safe sunum/shell bileşenleri                   |
| `src/islands/`          | Yalnızca client widget'ları — Vite glob ile otomatik keşfedilir |
| `src/components/`       | Paylaşılan SSR-güvenli UI (hook yok)                            |
| `src/assets/svg/`       | SVG kaynakları — `npm run icons` ile TSX'e dönüşür              |
| `src/components/icons/` | Otomatik üretilen icon bileşenleri (elle düzenlenmez)           |
| `src/lib/`              | Saf yardımcılar, kontratlar ve request helper'ları              |
| `server/adapters/`      | Gateway ve dış sistem adapter'ları                              |
| `server/services/`      | Cache/gateway kullanan server-only veri orkestrasyonu           |
| `server/`               | HTTP runtime — production'da Vite ile Node.js bundle'ı olur     |
| `tests/`                | `server/` ve `src/lib/` yapısını yansıtır                       |

## İsimlendirme

- Route klasörü: kebab-case (`loan-compare`)
- Island dosyası: kebab-case, `<Island name="..." />` ile aynı olmalı
- Bileşen export: PascalCase, dosya adı kebab-case
- Servis fonksiyonları: camelCase (`getOffers`, `getMe`)

## Yeni sayfa (route) ekleme

1. `server/routes/{feature}.tsx` oluştur — `defineRoute()` kullan
2. Sunum bileşenlerini `src/routes/{feature}/components.tsx` içinde tut
3. Veri erişimini `server/services/` üzerinden yap
4. `server/routes/index.ts`'e kaydet — sıra önemli (ilk eşleşen kazanır)
5. Etkileşim için: `src/islands/{name}.tsx` + route içinde `<Island />`

Loader normal içerikte `{ data }` döner. Terminal durumları exception yerine açık sonuçtur:

```ts
return notFound();
return redirect("/yeni-adres", 308);
return routeError({ code: "OFFER_UNAVAILABLE", message: "Teklif kullanılamıyor." }, 422);
```

- `notFound`: uygulama 404 sayfasını veya route `NotFoundComponent`'ini shell içinde render eder.
- `redirect`: render ve cache adımlarını çalıştırmadan `Location` response'u döner.
- `routeError`: güvenli domain mesajını `ErrorComponent`'e verir.
- Loader/render exception: `ErrorComponent` `error: null` alır; gerçek hata yalnız server logundadır.
- Terminal sonuçlar shared HTML cache'e yazılmaz ve `cache-control: private, no-store` kullanır.

## Yeni island ekleme

1. `src/islands/{kebab-name}.tsx` — default export
2. Route'ta: `<Island name="kebab-name" mode="hydrate|defer" />`
3. `entry.client.tsx`'i düzenleme — Vite glob yeni dosyayı otomatik bulur
4. Kullanıcıya özel veri: SSR loader + `gatewayFetch`; kişisel alanı cached HTML'e koyma

### `eager` — ne zaman JS hemen indirilir?

`entry.client.tsx` island chunk'larını varsayılan olarak **lazy** yükler: `IntersectionObserver` viewport'a 200px kala tetiklenir. `eager` prop'u bu gecikmeyi kaldırır — sayfa açılır açılmaz chunk indirilir.

| Island              | `eager` | Neden                                              |
| ------------------- | ------- | -------------------------------------------------- |
| `layout-client`     | Evet    | Store seed + chrome state erken gerekli            |
| `page-analytics`    | Evet    | Pageview EventQueue sırası                         |
| `user-chrome`       | Hayır   | Dropdown viewport'ta; ilk paint JS'siz fallback OK |
| `mobile-menu`       | Hayır   | Hamburger tıklanana kadar Sheet JS gereksiz        |
| `footer-accordion`  | Hayır   | Footer fold altında                                |
| `blog-explorer`     | Hayır   | Sıralama etkileşimi; SSR liste yeterli             |
| `account-dashboard` | Hayır   | Kişisel panel; defer + TanStack zaten lazy mount   |

**Kural:** Yeni island'larda `eager` ekleme — yalnızca analytics veya global store seed gibi erken client state gerekiyorsa kullan.

## Paylaşılan bileşen ekleme

1. `src/components/{category}/{name}.tsx` oluştur
2. SSR-güvenli olmalı — `useState`, `useEffect`, browser API yok
3. Route'lardan: `import { Header } from "~/components/layout/header"`

## API endpoint ekleme

1. `server/api/{name}.ts` — handler fonksiyonu
2. `server/api/index.ts` içinde mount et
3. Server-side orkestrasyon gerekiyorsa `server/services/` çağır

## Servis ekleme

1. Paylaşılan kontratları `src/lib/contracts/` altında tut
2. Tüm servis implementasyonlarını `server/services/` altında tut
3. Client/island kodu yalnızca kontratları kullanır; server servisi import etmez

---

## Redis ve cache altyapısı

### Redis bu projede ne yapıyor?

Redis **oturum deposu veya mesaj kuyruğu değildir**. Tek görevi: uygulama cache'inin **paylaşımlı backend'i** olmak.

```
İstek gelir
    ↓
handler → route.cache() → cache key üretilir
    ↓
cache.read(key)  ──→  Redis'te var mı?  ──→  HIT / STALE → HTML döner
    ↓ (MISS)
loader + renderDocument → cache.write(key, html)
```

Aynı Redis instance (veya geliştirmede bellek store) **iki ayrı cache katmanını** tutar:

| Katman             | Ne cache'lenir                      | Key örneği                                              | TTL (varsayılan)                     |
| ------------------ | ----------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| **HTML cache**     | SSR ile üretilmiş tam sayfa HTML'i  | `home\0tr\0desktop` (route parçaları `\0` ile birleşir) | Route başına (ör. 300s – 3600s)      |
| **Menü API cache** | Gateway'den gelen `IMenuItems` JSON | `menu:Desktop` / `menu:Tablet` / `menu:Mobile`          | `MENU_CACHE_TTL` (varsayılan 4 saat) |

Redis'teki fiziksel key'ler release bazlı `ssr:<release-id>:` namespace'i ile saklanır (`server/cache/redis.ts`):

```
ssr:<release-id>:home\0tr\0desktop     → HTML gövdesi + freshUntil / staleUntil
ssr:<release-id>:menu:Desktop          → menü JSON
```

### Bellek vs Redis

| Ortam            | `CACHE_BACKEND`       | Davranış                                                       |
| ---------------- | --------------------- | -------------------------------------------------------------- |
| Yerel geliştirme | `memory` (varsayılan) | Tek Node process içi `Map`; restart'ta sıfırlanır              |
| Docker / prod    | `redis`               | Tüm app instance'ları aynı cache'i paylaşır; restart'ta kalıcı |

İlgili env değişkenleri:

```bash
CACHE_BACKEND=redis          # memory | redis
REDIS_URL=redis://redis:6379 # redis seçiliyken zorunlu
CACHE_MAX_ENTRIES=2000       # yalnızca memory backend
CACHE_REQUIRED=false         # true ise Redis readiness için zorunlu
CACHE_PURGE_SECRET=...       # prod'da purge API için zorunlu
MENU_CACHE_TTL=14400         # menü cache süresi (saniye)
MENU_CACHE_SWR=86400         # menü stale-while-revalidate (saniye)
SWR_REVALIDATION_ATTEMPTS=3
SWR_REVALIDATION_BACKOFF_MS=250
SWR_DRAIN_TIMEOUT_MS=5000
```

Docker Compose (`docker-compose.yml`) Redis'i ayağa kaldırır; app servisi `REDIS_URL=redis://redis:6379` ile bağlanır. Sağlık kontrolü: `GET /readyz` cache ping'i yapar (`pingCache()`).

### Bellek mi Redis mi? (route bazlı değil)

`CACHE_BACKEND` **tüm uygulama için tek** bir ayardır — HTML cache ve menü cache aynı store'u kullanır. Route bazında “bu sayfa memory, şu sayfa redis” ayrımı yoktur.

Production config `memory` backend'i reddeder. Redis erişilemezse adapter memory store'a düşmez; read/write fail-open davranıp cache miss üretirken ioredis yeniden bağlanmayı sürdürür. Böylece birden fazla pod bağımsız cache üretmez. SWR işleri Redis lock ile podlar arasında tekilleştirilir, retry/backoff uygular ve graceful shutdown sırasında drain edilir.

| Soru                                    | Cevap                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Geliştirmede neden az key görüyorum?    | Varsayılan `memory`; process restart'ta sıfırlanır                                                          |
| Prod'da hepsini Redis'e taşımalı mıyız? | Evet — `CACHE_BACKEND=redis` yeterli; ekstra migration gerekmez                                             |
| Key listesinde tüm route'lar neden yok? | Key yalnızca **anonim GET + cache MISS sonrası write** ile oluşur; ziyaret edilmemiş sayfa listede görünmez |
| `/hesabim` neden yok?                   | `neverCache()` — HTML cache'e hiç yazılmaz                                                                  |

Menü key'leri (`menu:Desktop` vb.) layout render sırasında oluşur; sayfa HTML key'leri ise o URL'e anonim istek gelince oluşur.

### Cache key registry

Tüm mantıksal cache key tanımları merkezi config'te tutulur: [`src/lib/cache-keys.ts`](../src/lib/cache-keys.ts)

**Mimari:**

- **`pageCacheRegistry`** — sayfa HTML cache tanımları (key parçaları, TTL, strateji)
- **`pageCachePolicy(id, ctx)`** — route `cache` handler'ının tek giriş noktası
- **`menuCacheKey(device)`** — menü API cache (HTML'den bağımsız)
- **`listPageCachePrefixes()`** — purge / operasyon için prefix listesi

Route dosyaları key parçalarını **tekrar tanımlamaz**; registry'den türetir:

```ts
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";

export default defineRoute({
  path: "/retirement-banking",
  cache: (ctx) => pageCachePolicy(PageCacheId.retirementBanking, ctx),
  // ...
});
```

Yeni sayfa eklerken:

1. `PageCacheId` enum'una kimlik ekle
2. `pageCacheRegistry`'ye `buildKey`, `strategy`, `ttl` tanımla
3. Route'ta `pageCachePolicy(PageCacheId.yeniSayfa, ctx)` kullan
4. Purge için ilk key segment'ini (`id`) prefix olarak kullan

#### Sayfa HTML cache tablosu

| `PageCacheId`            | Path                       | Strateji  | Key parçaları (sırayla)                                             | TTL   |
| ------------------------ | -------------------------- | --------- | ------------------------------------------------------------------- | ----- |
| `home`                   | `/`                        | shared    | `home`, locale, layout                                              | 3600s |
| `loan`                   | `/ihtiyac-kredisi/:city?`  | shared    | `loan`, city, **`page=…` allowlist**, device, locale, theme, layout | 300s  |
| `blogs-paginated`        | `/blogs/paginated`         | shared    | `blogs-paginated`, publicPath, **`page=…`**, locale, layout         | 300s  |
| `retirement-banking`     | `/retirement-banking`      | shared    | `retirement-banking`, publicPath, locale, layout                    | 3600s |
| `remote-customer-obtain` | `/remote-customer-obtain`  | shared    | `remote-customer-obtain`, publicPath, layout                        | 300s  |
| `recourse-redirect`      | `/recourse/:page/redirect` | shared    | `recourse-redirect`, page, publicPath                               | 300s  |
| `account`                | `/hesabim`                 | **never** | — (cache'e yazılmaz)                                                | —     |

Mantıksal key = escape edilmiş parçaların `\0` (null) ile birleşimi. Örnek ana sayfa: `home\0tr\0desktop`. Redis fiziksel key: `ssr:<release-id>:home\0tr\0desktop`.

#### Menü cache

| Key            | Ne cache'ler                         | TTL env          |
| -------------- | ------------------------------------ | ---------------- |
| `menu:Desktop` | GW menü JSON (desktop header sırası) | `MENU_CACHE_TTL` |
| `menu:Tablet`  | GW menü JSON (tablet)                | `MENU_CACHE_TTL` |
| `menu:Mobile`  | GW menü JSON (mobile)                | `MENU_CACHE_TTL` |

Menü fetch: [`server/services/menu.ts`](../server/services/menu.ts) — `menuCacheKey()` import eder, key tanımını tekrarlamaz.

#### Key parçası kuralları

| Parça                              | Ne zaman ekle                 | Fonksiyon                                                                                    |
| ---------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| Sayfa kimliği                      | Her zaman (ilk segment)       | registry `id` veya sabit string                                                              |
| `ctx.publicPath`                   | Canonical / rewrite farklıysa | route ctx                                                                                    |
| `locale(ctx.request)`              | Çok dilli sayfa               | `~/lib/request`                                                                              |
| `layoutCacheFragment(ctx)`         | Header/footer shell farklıysa | `~/lib/device` — **layout'lu sayfalarda zorunlu**                                            |
| `deviceCacheFragment(ctx.request)` | Cihaza göre farklı HTML       | loan compare gibi                                                                            |
| Query param                        | URL varyantı (page, amount…)  | `contentQueryParams` allowlist — [`cache-query-params.ts`](../src/lib/cache-query-params.ts) |
| Cookie (theme vb.)                 | Tema/layout etkisi            | `cookie(ctx, Cookie.theme)`                                                                  |

Kişisel veya oturumlu içerik key'e **girmez** — bypass registry ile cache atlanır.

**Query param kuralı:** Yalnızca SSR HTML'i değiştiren param'lar allowlist'e girer. `utm_*`, `gclid`, `fbclid` vb. tracking param'ları **asla** cache key'e yazılmaz — middleware cookie'ye yazar, GTM client-side okur. Aynı `page=1` + farklı utm → **tek cache entry**.

Registry'de route başına:

```ts
contentQueryParams: ["page"],
contentQueryDefaults: { page: "1" },
```

Tam URL (`ctx.url.search`) veya tüm query string key'e **eklenmez**.

### stale-while-revalidate (SWR)

Her cache entry iki zaman damgası taşır:

- **freshUntil** — bu süreye kadar `x-cache: HIT`
- **staleUntil** — bu süreye kadar eski içerik servis edilir (`x-cache: STALE`) ve arka planda `revalidate()` yeni HTML üretir

Yani TTL dolunca cache anında “kırılmaz”; önce stale servis, arka planda yenileme yapılır.

### Dosyalar

| Dosya                     | Rol                                                            |
| ------------------------- | -------------------------------------------------------------- |
| `server/cache/index.ts`   | Store seçimi (memory / redis), read / write / cacheKey         |
| `server/cache/redis.ts`   | ioredis adapter, release bazlı `ssr:<release-id>:` namespace'i |
| `server/cache/memory.ts`  | Geliştirme için in-memory adapter                              |
| `src/lib/cache-keys.ts`   | Merkezi cache key registry + `pageCachePolicy`                 |
| `src/lib/cache-policy.ts` | Bypass kuralları (`sharedUnlessBypass`, `neverCache`)          |
| `server/services/menu.ts` | Menü fetch + aynı cache store kullanımı                        |
| `server/handler.ts`       | Cache okuma, SWR revalidate, MISS'te render                    |

---

## Cache kırma ve invalidation

Projede iki farklı kavram vardır; karıştırılmamalı:

| Kavram           | Ne zaman                                              | Sonuç                                                        |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| **Bypass**       | Kişisel SSR, `neverCache()` route, özel bypass kuralı | Bu istek cache'e **bakmaz/yazmaz** (`x-cache: BYPASS`)       |
| **Invalidation** | İçerik değişti, eski HTML'i silmek istiyorsun         | Cache'teki **entry silinir**; sonraki anonim istek MISS alır |

### 1. İstek bazlı bypass (cache'e hiç girme)

Cache-safe public HTML, oturum cookie'leri bulunsa da shared cache kullanır:

```ts
// src/lib/cache-keys.ts — merkezi registry
cache: (ctx) => pageCachePolicy(PageCacheId.home, ctx),
```

SSR çıktısı oturuma göre değişen registry kayıtlarında `bypassAuth: true` kullanılır. Bu route'larda
token veya `Authorization` header'ı → `x-cache: BYPASS` üretir. `signed_in` hiçbir zaman cache
kararına katılmaz.

Kişisel sayfalar tamamen cache dışı:

```ts
cache: (ctx) => pageCachePolicy(PageCacheId.account, ctx),  // → neverCache()
```

Ek bypass kuralı (global):

```ts
// server/index.ts — bootstrap'ta
import { registerCacheBypassCheck, hasPid } from "~/lib/cache-policy";
registerCacheBypassCheck(hasPid);
```

### 2. TTL ile doğal sona erme

Key yazılırken `ttl` + `swr` süresi Redis'te `EX` olarak ayarlanır. Süre dolunca entry silinir veya stale aşamasına geçer. Acil yayın gerekmiyorsa en güvenli yol budur.

Route'ta TTL kısalt — registry entry'sinde `ttl` / `swr` alanlarını güncelle veya `pageCacheRegistry` içinde override et.

Menü için: `MENU_CACHE_TTL` env'ini düşür.

### 3. Manuel invalidation — Redis CLI

Docker ortamında:

```bash
# Redis container'a bağlan
docker compose exec redis redis-cli

# Tüm ssr cache'ini sil (dikkat: menü + tüm sayfa HTML)
KEYS ssr:<release-id>:*
# veya production'da SCAN kullan:
SCAN 0 MATCH ssr:<release-id>:* COUNT 100

# Tek key sil (key içinde \0 karakteri olabilir — KEYS çıktısından kopyala)
DEL "ssr:<release-id>:menu:Desktop"

# Geliştirme ortamında her şeyi sıfırla
FLUSHDB
```

Bellek backend'de (`CACHE_BACKEND=memory`): uygulamayı restart etmek cache'i sıfırlar.

### 4. Belirli sayfa HTML'ini kırmak

HTML cache key tanımı [`src/lib/cache-keys.ts`](../src/lib/cache-keys.ts) içindeki `pageCacheRegistry`'dedir. Örneğin ana sayfa:

```ts
// pageCacheRegistry[PageCacheId.home].buildKey
["home", locale(ctx.request), layoutCacheFragment(ctx)];
// → mantıksal key ≈ "home\0tr\0desktop"
```

Yayın sonrası o sayfayı hemen tazelemek için purge API ile prefix veya tam key kullan. Prefix için ilk segment (`home`, `loan`, `menu:` …) yeterlidir; [`listPageCachePrefixes()`](../src/lib/cache-keys.ts) operasyon referansıdır.

```bash
docker compose exec redis redis-cli DEL "ssr:docker-compose:menu:Desktop" "ssr:docker-compose:menu:Tablet" "ssr:docker-compose:menu:Mobile"
```

Menü ve layout değiştiyse hem menü key'lerini hem ilgili HTML key'lerini silmek gerekir.

### 5. Purge API (önerilen)

Dahili HTTP endpoint'ler ile cache yönetimi:

| Endpoint                         | Açıklama                        |
| -------------------------------- | ------------------------------- |
| `GET /api/internal/cache/keys`   | Key listele (prefix, sayfalama) |
| `POST /api/internal/cache/purge` | Key / prefix / tümünü sil       |

```bash
# Menü cache temizle
curl -X POST -H "Authorization: Bearer $CACHE_PURGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "menu:"}' \
  http://localhost:3005/api/internal/cache/purge
```

Detaylı kullanım, örnekler ve operasyon senaryoları: **[`docs/cache-purge.md`](./cache-purge.md)**

### 6. Operasyon akışı (prod)

1. CMS / deploy webhook → purge API çağır (menü prefix veya ilgili HTML key'leri)
2. Anonim istek ile doğrula → `x-cache: MISS`
3. Ağ seviyesinde `/api/internal/*` erişimini kısıtla + `CACHE_PURGE_SECRET` kullan

### x-cache header özeti

| Değer                | Anlam                                                    |
| -------------------- | -------------------------------------------------------- |
| `HIT`                | Fresh cache'ten servis edildi                            |
| `STALE`              | Eski cache servis edildi, arka planda revalidate başladı |
| `MISS`               | Cache yoktu, render edildi ve yazıldı                    |
| `BYPASS`             | Cache atlandı; 404 veya kontrollü terminal response      |
| `NONE`               | HTML handler dışındaki/etiketsiz response                |
| `REDIRECT` / `PROXY` | SSR cache devreye girmedi                                |

---

## HTML cache — `pageCachePolicy`

Detay: [`src/lib/cache-keys.ts`](../src/lib/cache-keys.ts) (registry) + [`src/lib/cache-policy.ts`](../src/lib/cache-policy.ts) (bypass)

```ts
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";

// Kişiselleştirilmiş SSR — registry'de bypassAuth: true
cache: (ctx) => pageCachePolicy(PageCacheId.retirementBanking, ctx),

// Kişisel sayfa — registry'de strategy: "never"
cache: (ctx) => pageCachePolicy(PageCacheId.account, ctx),
```

**Kurallar:**

- Key parçalarını route dosyasında **inline yazma** — registry'ye ekle
- Bypass check'ler cache **key'e girmez** — yalnızca cache'e girip girmeme kararı verir
- Kişisel veri cached HTML'de olmamalı; SSR kişiselleşiyorsa `bypassAuth: true`, değilse defer island kullan
- Cookie isimleri: [`src/lib/cookies.ts`](../src/lib/cookies.ts)

---

## UI — Tailwind + Radix

| Katman     | Teknoloji                             | Not                                                         |
| ---------- | ------------------------------------- | ----------------------------------------------------------- |
| Stil       | Tailwind CSS v4 (`@tailwindcss/vite`) | `src/styles/globals.css` — Vite build → SSR HTML class'ları |
| Primitives | Radix UI                              | Sheet, Accordion, DropdownMenu                              |
| UI kit     | `src/components/ui/`                  | Button, Card, Badge, Sheet, Accordion, DropdownMenu         |
| Utils      | `cn()` — `src/lib/utils.ts`           | clsx + tailwind-merge                                       |

**Radix nerede?** Interaktif chrome island'larda: `mobile-menu` (Sheet), `footer-accordion` (Accordion), `user-chrome` (DropdownMenu). Header/Footer gövdesi SSR + Tailwind.

**Yeni UI bileşeni:** `src/components/ui/` altına ekle; Radix primitive + Tailwind + `cn()`.

---

## SVG ikonları — otomatik TSX codegen

Next.js'teki `@svgr/webpack` yerine build-time codegen kullanılır. Üretilen bileşenler hem **SSR** (`tsx` + `react-dom/server`) hem **client island** tarafında çalışır — Vite transform gerekmez.

### Akış

```
src/assets/svg/brand-mark.svg     ← yalnızca bunu ekle / güncelle
        ↓  npm run icons  (dev & build otomatik çalıştırır)
src/components/icons/brand-mark.tsx
src/components/icons/index.ts     ← barrel export (BrandMark)
```

| Kural       | Detay                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| Kaynak      | `src/assets/svg/{kebab-name}.svg` — elle TSX yazma                          |
| Çıktı       | `src/components/icons/{kebab-name}.tsx` — generated banner, commit et       |
| Import      | `import { BrandMark } from "~/components/icons"`                            |
| Renk        | SVGR `currentColor` — `className="text-brand-600"` ile boya                 |
| UI ikonları | Chevron, menu vb. için `lucide-react` yeterli; marka/logo için SVG pipeline |
| Silme       | SVG silinince codegen eski `.tsx`'i de temizler                             |

### Komutlar

```bash
npm run icons          # manuel regenerate
npm run dev            # icons → Vite HMR + tsx watch + mock gateway
npm run build          # icons → vite build
```

`npm run dev` build-watch değildir. Vite 5173'te source modülleri, HMR websocket'i ve React Refresh
runtime'ını servis eder; Hono 3005'te SSR HTML/API sunar. Browser her zaman Hono URL'inde açılır.
Island/client değişiklikleri Fast Refresh olur. SSR dosyaları `tsx watch` ile restart edilir ve Hono
hazır olduğunda yalnız bu değişiklikler full document reload tetikler. Production asset manifest'i bu
akışta okunmaz veya yeniden yazılmaz.

Config: `.svgrrc.cjs` (TypeScript, `icon: true`, SVGO + `currentColor`).

---

## Header, Footer ve MenuList

Next.js root layout menü fetch karşılığı: **`buildShellData`** — tek istek, Header + Footer SSR.

### Veri akışı

```
UA → getDeviceType → "Desktop" | "Tablet" | "Mobile"
       ↓
GET /pages/menuitem/list   (header: device, CorrelationId)
       ↓
IMenuItems → RootLayout → Header + Footer (SSR)
             layout-client → auth store seed
             user-chrome island → Giriş / MO initials
```

| Kural        | Detay                                                              |
| ------------ | ------------------------------------------------------------------ |
| Tek fetch    | Layout/document menüyü çeker; Header/Footer ayrı endpoint çağırmaz |
| Tek nav tree | `headerItems` — desktop bar = hamburger içeriği                    |
| Footer ayrı  | `footerItems` + `itemType: 16`                                     |
| Auth chrome  | Menü API'den gelmez — `user-chrome` island `signed_in` cookie okur |
| Device       | API header + shell seçimi + sıra alanı; ikinci menü listesi yok    |

### Device kırılımı

| Katman              | Desktop                                  | Tablet                   | Mobile                   |
| ------------------- | ---------------------------------------- | ------------------------ | ------------------------ |
| API `device` header | Desktop                                  | Tablet                   | Mobile                   |
| Header shell        | DesktopHeader + yatay nav                | MobileHeader + accordion | MobileHeader + accordion |
| Nav sıra            | `displayOrder`                           | `mobileDisplayOrder`     | `mobileDisplayOrder`     |
| Footer layout       | kolon grid                               | grid                     | accordion                |
| HTML cache key      | `layoutCacheFragment(ctx)` — **zorunlu** |                          |                          |

Tablet → mobile shell; API'ye yine `Tablet` gider.

### MenuItem modeli

`src/lib/menu/types.ts` — `MenuItem`, `IMenuItems`.

### İlgili dosyalar

| Dosya                           | Rol                                                      |
| ------------------------------- | -------------------------------------------------------- |
| `server/services/menu.ts`       | GW fetch + menü API cache                                |
| `src/lib/device.ts`             | `getDeviceType`, `getDeviceShell`, `layoutCacheFragment` |
| `src/lib/menu/utils.ts`         | sort, filter, label                                      |
| `src/components/layout/header/` | Desktop / Mobile shell                                   |
| `src/components/layout/footer/` | Grid / accordion                                         |
| `src/islands/user-chrome.tsx`   | Auth dropdown (defer, lazy chunk)                        |

---

## Metadata / head — iki kanal

Next.js'teki **Metadata API** + **manuel `<head>`** ayrımının karşılığı.

### Kanal 1 — Metadata API (`generateMetadata`)

| Katman         | Dosya                                   | Ne                                                          |
| -------------- | --------------------------------------- | ----------------------------------------------------------- |
| Site defaults  | `src/lib/metadata/site-defaults.ts`     | title template, description, OG/Twitter site, icons, robots |
| Route override | `route.generateMetadata(data, ctx)`     | title, description, canonical, robots, OG/Twitter sayfa     |
| Merge          | `src/lib/metadata/merge.ts`             | layout ⊎ page — page ezer                                   |
| HTML           | `src/components/head/metadata-head.tsx` | `<title>`, meta, canonical, OG, Twitter                     |

```ts
loader: async (ctx) => {
  const page = await fetchRetirementBankingPage(ctx.request);
  return { data: { ...page } };
},

generateMetadata: (data, ctx) =>
  data.seoInfo
    ? generateMetaDataForPageWithSeoInfo(data.seoInfo, ctx)
    : generateMetaDataForPageWithDummySeoInfo("/retirement-banking", ctx),
```

### Kanal 2 — Manuel head (teknik bootstrap)

| Bileşen                            | Sorumluluk                                       |
| ---------------------------------- | ------------------------------------------------ |
| `HeadClient`                       | dns-prefetch, preconnect (GTM, üçüncü parti CDN) |
| `GtmBootstrap`                     | dataLayer, EventQueue, hk.tracking, gtm.js       |
| `layout-client` / `page-analytics` | Store + pageview (metadata dışı)                 |

**SEO meta ≠ GTM.** Analytics script'leri `generateMetadata`'ya girmez.

### Env

```bash
SITE_URL=https://www.hangikredi.com   # canonical / OG url tabanı
```

---

## Sayfa açılış pipeline — Layout + GTM + PageAnalytics

Next.js `layout.tsx` + `page.client.tsx` karşılığı.

### Zaman sırası

```
1. Middleware          auth → session/tracking → CMS redirect
2. handler             rules.ts → cache → loader → renderDocument
3. document (SSR)      head: dataLayer=[] → EventQueue → hk.tracking → GTM
                       body: layout-client → main → page-analytics
4. entry.client        layout-client (store seed) → page-analytics (pageview)
5. EventQueue          originalLocation → GAVirtual → signalReactReady → gtm.dom/load
```

### Dosya haritası

| Next.js             | ssr-kit                                | Sorumluluk                   |
| ------------------- | -------------------------------------- | ---------------------------- |
| `app/layout.tsx`    | `server/document.tsx` + `RootLayout`   | HTML shell, GTM bootstrap    |
| `layout.client.tsx` | `src/islands/layout-client.tsx`        | Chrome + store seed          |
| `page.tsx`          | `server/routes/*.tsx` + `src/routes/*` | Loader/metadata + SSR UI     |
| `page.client.tsx`   | `src/islands/page-analytics.tsx`       | Yalnızca page-view dataLayer |
| Container           | route `Component` + `<Island />`       | UI + etkileşim               |

### Cache + analytics

| Veri                 | SSR HTML'de?        | Neden                                            |
| -------------------- | ------------------- | ------------------------------------------------ |
| GTM container ID     | Evet                | Herkes aynı                                      |
| `user_tracking_id`   | **Hayır**           | Cookie'den client okur                           |
| `isSignedIn` / token | **Hayır**           | layout-client cookie okur                        |
| `pageMeta`           | Evet (island props) | Yalnızca içerik alanları; utm/search client-side |
| Kişisel user adı     | Tercihen hayır      | Defer island; SSR gerekiyorsa auth-bypass route  |

### HTML'e embedded JSON ve crawler-visible URL'ler

HTML içine hydration, analytics veya bootstrap verisi gömülüyorsa doğrudan `JSON.stringify()`
kullanmak yasaktır. Tek otorite `src/lib/embedded-json.ts` içindeki `serializeEmbeddedJson()`
fonksiyonudur.

```tsx
// Yanlış
data-props={JSON.stringify(props)}

// Doğru — Island zaten merkezi olarak uygular
data-props={serializeEmbeddedJson(props)}
```

Kurallar:

1. `/path` ve `https://host/path` gibi JSON stringlerindeki bütün solidus karakterleri HTML source'ta
   `\/` olmalıdır.
2. Client manuel `replace()` yapmaz; `parseEmbeddedJson()`/`JSON.parse()` standard JSON escape'lerini
   geri açar.
3. `<`, `>`, `&`, U+2028 ve U+2029 aynı serializer tarafından escape edilir.
4. Gerçek navigasyon linkleri (`<a href>`), asset URL'leri (`src`, `srcset`), canonical ve sitemap
   kesinlikle dönüştürülmez.
5. API response, gateway request, Redis cache ve log JSON'u bu serializer'ı kullanmaz; crawler-visible
   HTML değildir.
6. Yeni bir `data-*`, `<script type="application/json">` veya inline bootstrap payload'ı eklenirse
   `serializeEmbeddedJson()` zorunludur ve source-output + round-trip testi yazılmalıdır.
7. Island prop'ları public, küçük ve JSON-serializable olmalıdır; token veya kişisel veri escape
   edilerek güvenli hale gelmez.

ESLint JSX attribute içinde doğrudan `JSON.stringify()` kullanımını build sırasında reddeder.
Solidus escape'in JSON standardındaki karşılığı için
[RFC 8259](https://www.rfc-editor.org/rfc/rfc8259), URL inventory yaklaşımı için
[Google crawl budget rehberi](https://developers.google.com/crawling/docs/crawl-budget) referanstır.

### Env

```bash
GTM_CONTAINER_ID=GTM-XXXXXX   # boş = GTM devre dışı
```

### Yeni route checklist

1. `defineRoute()` + `pageCachePolicy(PageCacheId.*, ctx)` — registry entry + `contentQueryParams` allowlist
2. `pageMeta` — pageview kategorisi
3. `Component` — yalnızca sayfa içeriği (header/footer yok)
4. Etkileşim → `src/islands/` + `<Island mode="hydrate" />`

---

## Client data fetching — TanStack Query

Sunucu verisi **loader + `gatewayFetch`** ile kalır. Client-side dinamik veri (sıralama, kişisel panel) için **TanStack Query v5** kullanılır.

### Katmanlar

| Katman       | Dosya                            | Rol                                                        |
| ------------ | -------------------------------- | ---------------------------------------------------------- |
| Query client | `src/lib/query/client.ts`        | Singleton `QueryClient` (island'lar arası paylaşımlı)      |
| Provider     | `src/lib/query/provider.tsx`     | `AppQueryProvider` — `entry.client.tsx` her island'ı sarar |
| Query keys   | `src/lib/query/keys.ts`          | Merkezi key factory                                        |
| Hooks        | `src/lib/query/hooks/*`          | `useBlogs`, `useAccountSummary`                            |
| Client fetch | `src/lib/client/api-fetch.ts`    | `credentials: "include"` ile BFF çağrısı                   |
| BFF (public) | `server/api/blogs.ts`            | `GET /api/blogs` — anonim, pipeline dışı                   |
| BFF (auth)   | `server/api/internal/account.ts` | `GET /api/internal/account/summary` — cookie auth          |

### Ne zaman hangi mod?

| Senaryo                         | Pattern                                       |
| ------------------------------- | --------------------------------------------- |
| SEO + cache'lenen ilk içerik    | Route `loader` (SSR)                          |
| URL ile değişen içerik (`page`) | SSR + `contentQueryParams` cache key          |
| Client-only filtre (`orderBy`)  | `defer` island + TanStack Query + BFF         |
| Kişisel / oturumlu veri         | `defer` island + TanStack + `/api/internal/*` |

### Örnekler

**Blog sıralama** — `src/islands/blog-explorer.tsx`

- SSR: varsayılan sıralama (`date-desc`) loader'da, HTML cache'te
- Client: `orderBy` değişince `useBlogs` → `GET /api/blogs?page=&orderBy=`
- `orderBy` cache key'de **yok** (doğru)

**Hesabım paneli** — `src/islands/account-dashboard.tsx`

- SSR: yalnızca fallback shell (`defer`)
- Client: `useAccountSummary` → `GET /api/internal/account/summary`
- 401 → giriş gerekli mesajı (island içinde)

### Yeni client query eklerken

1. `src/lib/query/keys.ts` — key factory ekle
2. `src/lib/query/hooks/use-*.ts` — hook yaz
3. Gerekirse `server/api/*` BFF endpoint
4. `src/islands/*.tsx` — `defer` veya `hydrate` island
5. Route'ta `<Island mode="defer" props={…}>` + SSR fallback

Loader'ı React Query ile değiştirme — HTML cache mimarisi bozulur.

---

## Middleware pipeline

Next.js `middleware.ts` karşılığı: [`server/middleware/pipeline.ts`](../server/middleware/pipeline.ts)

**Sıra:** auth → session/tracking → CMS redirect → (handler) static rules.ts → SSR

| Adım           | Dosya                                  | Ne yapar                                             |
| -------------- | -------------------------------------- | ---------------------------------------------------- |
| Auth           | `server/middleware/steps/auth/`        | Token oku/yenile, `Authorization` inject, cookie yaz |
| Session        | `server/middleware/steps/session/`     | gclid/utm/theme → cookie, tracking UUID              |
| CMS redirect   | `server/middleware/steps/redirection/` | GW redirect map, 410/301                             |
| Static routing | `src/routing/rules.ts`                 | Config redirect/rewrite/proxy                        |
| SSR loader     | `server/services/*` + gateway adapter  | GW'ye token ile istek                                |

### Matcher (2 seviye)

1. **Hono mount** — `/assets/*`, `/healthz`, `/api/*` (internal hariç) pipeline'a girmez
2. **`shouldRunPipeline(pathname)`** — static extension skip; `/api/internal/*` çalışır

### Loader + gateway

Middleware `Authorization` header inject eder:

```ts
import { fetchUserProfile } from "@server/services/user";

loader: async (ctx) => {
  const user = await fetchUserProfile(ctx.request);
  return { data: { user } };
};
```

### Internal BFF

| Endpoint                            | Açıklama                                            |
| ----------------------------------- | --------------------------------------------------- |
| `POST /api/internal/refresh`        | `refresh_token` → yeni access + session cookie'leri |
| `GET /api/internal/auth/session`    | İsteğe bağlı authoritative oturum doğrulaması       |
| `GET /api/internal/account/summary` | Auth + auto-refresh + hesap özeti                   |

### Auth cookie modeli

| Cookie          | httpOnly | Kim okur                 | Rol                            |
| --------------- | -------- | ------------------------ | ------------------------------ |
| `access_token`  | Evet     | Sunucu (middleware, BFF) | GW `Authorization`             |
| `refresh_token` | Evet     | Sunucu                   | Access süresi dolunca yenileme |
| `signed_in`     | Hayır    | Client island            | UI oturum göstergesi (`1`)     |
| `account_text`  | Hayır    | Client island            | Header'da görünen isim         |

**Neden client access token görmüyor?** Güvenlik için token'lar httpOnly. `user-chrome` ve `layout-client` **`signed_in`** cookie'sini okur — `access_token` değil.

**Refresh akışı:**

1. **Sayfa isteği** → middleware `runAuthCore`: access expire + refresh varsa yeniler, `Set-Cookie` döner
2. **Client BFF (TanStack)** → `clientApiFetch` 401 alırsa `POST /api/internal/refresh` çağırır, isteği tekrarlar
3. **BFF handler** → `authenticateBffRequest` aynı refresh mantığını uygular

Local fixture'lar uygulama servislerine gömülmez. `mock-gw/` 4002 portunda ayrı process olarak
çalışır ve gerçek gateway ile aynı HTTP sınırından çağrılır. Yeni geçici backend cevabı gerekiyorsa
uygulama service dosyasına fallback ekleme; endpoint ve fixture'ı `mock-gw/server.js` içine ekle.

---

## Routing — rewrite, redirect, proxy

Next.js `rewrites()` / `redirects()` karşılığı: [`src/routing/rules.ts`](../src/routing/rules.ts)

| Next.js                 | ssr-kit                             | Davranış                            |
| ----------------------- | ----------------------------------- | ----------------------------------- |
| `redirects()`           | `redirects[]`                       | Tarayıcı URL değişir (301/308)      |
| `rewrites()` (internal) | `rewrites[]` + internal destination | URL aynı, route internal path görür |
| `rewrites()` (external) | `rewrites[]` + external URL         | Proxy — istek backend'e iletilir    |

**Pipeline sırası:** redirect → rewrite/proxy → route match → SSR

Routing rule'ları tek geçişte çözülür; destination tekrar rule tablosundan geçirilmez. Incoming query
korunur ve destination query ile birleştirilir, çakışmada destination değeri kazanır. Internal rewrite
`pathname` ve `search` alanlarını ayrı taşır. Parametreler URL-safe encode edilir; yalnız `:path*`
birden fazla segmenti koruyabilir.

Uygulama bootstrap sırasında rule tablosunu doğrular. Duplicate veya gölgelenmiş rule, bilinmeyen
destination parametresi, geçersiz pattern ve self-rewrite server'ın başlamasını engeller. Desteklenen
alt küme `:param`, final `:param?` ve final `:path*` biçimleridir; koşullu ve fazlı rewrite semantiği
ürün ihtiyacı oluşana kadar kapsam dışıdır.

### Public URL vs internal path

- Route dosyasında **internal path**: `path: "/retirement-banking"`
- Türkçe public URL için **rewrite**: `{ source: "/emekli-bankaciligi", destination: "/retirement-banking" }`
- Cache key ve canonical için `ctx.publicPath` kullan (tarayıcıdaki path)

Pattern syntax: `:param` (tek segment), `:path*` (kalan path).

---

## Tooling — TS / ESLint / Prettier

Katı TypeScript, ESLint 9 (flat config), Prettier ve EditorConfig. CI'da hepsi zorunlu.

### TypeScript

| Dosya                 | Amaç                                          |
| --------------------- | --------------------------------------------- |
| `tsconfig.base.json`  | Paylaşılan `compilerOptions` (sıkı bayraklar) |
| `tsconfig.json`       | Uygulama kodu — `src`, `server`, `tests`      |
| `tsconfig.node.json`  | Vite / Vitest / ESLint config dosyaları       |
| `tests/tsconfig.json` | Vitest globals                                |

### Path alias

| Alias       | Hedef      | Kullanım                |
| ----------- | ---------- | ----------------------- |
| `~/*`       | `src/*`    | Uygulama kodu, testler  |
| `@server/*` | `server/*` | Server runtime, testler |

**Kural:** `../` ile üst dizine çıkan import **yasak**. Aynı klasör içi `./` serbest.

```ts
import { defineRoute } from "~/lib/types";
import { handle } from "@server/handler";
```

### Import sırası

1. Node builtins
2. Harici paketler
3. `~` alias
4. `@server` alias
5. `./` (aynı klasör)

### Mimari sınırlar (ESLint)

| Kaynak                                  | Yasak hedef      | Gerekçe                          |
| --------------------------------------- | ---------------- | -------------------------------- |
| `server/**`                             | `src/islands/**` | Server client bundle'a girmemeli |
| `src/components/**`, `server/routes/**` | `src/islands/**` | Island wrapper üzerinden kullan  |
| `src/lib/**`                            | `server/**`      | Katman sınırı                    |
| `src/islands/**`                        | `server/**`      | Client server kodu okumaz        |

Uygulama runtime env'i `server/config.ts` tarafından okunur; yalnız OpenTelemetry'nin standart
`OTEL_*` bootstrap değişkenleri `server/instrumentation.ts` tarafından doğrudan okunur. Public origin
gibi gerekli değerler saf `src/lib` fonksiyonlarına context üzerinden aktarılır.

---

## Observability kontratı

- Yeni server I/O sınırları `server/observability.ts` içindeki `withSpan()` ile ölçülür.
- Span adı bounded olmalıdır; token, kullanıcı ID'si, cache key veya kontrolsüz query içermez.
- Gateway çağrısında `injectActiveTrace()` korunur; request ID `correlationid` olarak iletilir.
- Yeni metric label değerleri sınırlı bir enum olmalıdır. Raw path/request ID metric label'ı değildir.
- Release kimliği deploy sırasında `RELEASE_ID` ile sağlanır; log, trace resource ve
  `ssr_release_info` metriğinde aynı değer görünür.
- OpenTelemetry SDK yalnız `server/instrumentation.ts` tarafından başlatılır ve kapatılır. Service,
  route veya adapter içinde SDK/provider oluşturulmaz.

Tracing için local collector zorunlu değildir. `OTEL_EXPORTER_OTLP_ENDPOINT` yoksa span API no-op
çalışır; request ID context'i ve `/metrics` davranışı devam eder.

---

## Statik asset CDN

Vite build çıktısı (`dist/client/assets/*`) hash'li dosyalardır — uzun süre cache'lenebilir. Prod'da bu dosyaları ayrı bir CDN origin'inden servis etmek için `ASSET_CDN_URL` kullanılır.

### Akış

```
npm run build → dist/client/.vite/manifest.json
       ↓
readAssets() → assetUrl() ile JS/CSS URL'leri
       ↓
renderDocument → <link>/<script> href'leri CDN veya origin
       ↓
CDN (veya origin /assets/*) → Cache-Control: immutable, max-age=31536000
```

| Dosya                                | Rol                                              |
| ------------------------------------ | ------------------------------------------------ |
| `server/assets.ts`                   | `readAssets()`, `assetUrl()`, `assetCdnOrigin()` |
| `server/document.tsx`                | CDN `preconnect` + manifest URL'leri             |
| `server/middleware/static-assets.ts` | Origin `/assets/*` için immutable header         |
| `server/config.ts`                   | `ASSET_CDN_URL`                                  |

### Env

```bash
# Boş = aynı origin (/assets/entry.*.js)
ASSET_CDN_URL=https://cdn.hangikredi.com
```

- Trailing slash otomatik kesilir.
- Path yapısı korunur: `https://cdn…/assets/entry.client-abc123.js`
- HTML hâlâ uygulama sunucusundan gelir; yalnızca JS/CSS CDN'e yönlendirilir.
- `assetCdnOrigin()` → `<link rel="preconnect">` (document head)

**Deploy notu:** CDN bucket'ına `dist/client/assets/` içeriğini build sonrası sync et; manifest ile eşleşen hash'li dosyalar gerekli.

### Responsive image ekleme

1. Orijinal dosyayı `src/assets/images/` altına koy.
2. Intrinsic `width`, `height`, responsive width allowlist ve kaliteyi `server/media.config.json`
   içine ekle.
3. `npm run media` çalıştır; source metadata config boyutuyla uyuşmazsa build fail eder.
4. Server route loader'ında `responsiveImage(id)` ile manifest kaydını al.
5. UI'da `ResponsiveImage` kullan ve gerçek layout'a uygun `sizes` ver.
6. Yalnız gerçek LCP adayı için `priority` ve route `preloadImages` tanımla.

Raw `<img>` kullanma. İstisna ancak compile-time sabit SVG ikon gibi responsive raster pipeline'ın
anlamsız olduğu varlıklardır. Gateway/CDN görsellerinde dahi intrinsic width ve height zorunludur.
Kullanıcıdan gelen URL doğrudan image transformation endpoint'ine eklenmez; `buildImageCdnUrl()` URL
encoding yapar ve width/quality değerlerini doğrular. Transformer kullanımı `IMAGE_TRANSFORM_URL` ile
açılır.

### Unoptimized CDN image ekleme

1. Dönüşüm istemeyen kaynak için `unoptimizedImage(id)` + `UnoptimizedImage` kullan.
2. `width`/`height` manifestten gelir; unoptimized olmak layout shift kontratını kaldırmaz.
3. `IMAGE_CDN_URL` bir dosya prefix'idir. `/images` gibi path segmentleri korunarak relative asset
   path'inin önüne eklenir.
4. Absolute vendor URL'lerini `createUnoptimizedImage()` ile ver; mevcut absolute URL tekrar prefix
   edilmez.
5. CDN prefix ile transformer'ı aynı kavram yapma. Responsive runtime dönüşümü gerekiyorsa ayrı
   `IMAGE_TRANSFORM_URL` kullan.

Local container testinde bare `localhost[:port]` prefix'i `http://` ile normalize edilir. Bu kolaylık
uzak hostlara uygulanmaz; production CDN ve transformer URL'leri HTTPS olmalıdır.

### Font ekleme

Font kaynağı local WOFF2 olmalı ve lisansı bilinmelidir. Gerekli dil subsetlerini
`server/media.config.json` içinde ayrı unicode-range ile tanımla. Bütün weight dosyalarını preload
etmek yerine variable font veya gerçekten kullanılan weight'leri seç. Font preload, `@font-face` ve
asset URL'si elle kopyalanmaz; `asset-pipeline.json` tek otoritedir.

### SSR vs island

| Alan                                                     | Browser API        |
| -------------------------------------------------------- | ------------------ |
| `server/routes/**`, `src/routes/**`, `src/components/**` | **Yasak** (ESLint) |
| `src/islands/**`, `entry.client.tsx`                     | Serbest            |

### Komutlar

```bash
npm run typecheck
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run ci    # typecheck → lint → format:check → test → build → smoke
```
