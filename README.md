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

Uygulama varsayılan olarak `http://localhost:3005` adresinde çalışır.

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

## Ortam değişkenleri

Temel değişkenler:

- `PORT` — HTTP portu, varsayılan `3005`
- `GATEWAY_URL` — backend gateway adresi
- `CACHE_BACKEND` — `memory` veya `redis`; production yalnızca `redis` kabul eder
- `CACHE_REQUIRED` — `true` ise Redis problemi readiness'i başarısız yapar; varsayılan fail-open
- `REDIS_URL` — Redis seçildiğinde zorunlu
- `CACHE_MAX_ENTRIES` — memory cache kapasitesi
- `CACHE_PURGE_SECRET` — production purge endpoint yetkilendirmesi
- `MENU_CACHE_TTL` / `MENU_CACHE_SWR` — menü cache süreleri
- `SITE_URL` — canonical URL tabanı
- `RELEASE_ID` — release/Git SHA; Redis HTML cache namespace'i
- `GATEWAY_TIMEOUT_MS` — gateway/proxy timeout'u
- `PROXY_BODY_LIMIT_BYTES` — `/api/*` istek gövdesi üst sınırı
- `TRUST_PROXY` — yalnızca güvenilir ingress arkasında forwarded IP header'larını etkinleştirir
- `REDIRECT_ALLOWED_HOSTS` — virgülle ayrılmış harici redirect host allowlist'i
- `REDIRECT_CACHE_MAX_ENTRIES` — redirect lookup cache üst sınırı
- `SWR_REVALIDATION_ATTEMPTS` — background revalidation toplam deneme sayısı
- `SWR_REVALIDATION_BACKOFF_MS` — retry için başlangıç backoff süresi
- `SWR_DRAIN_TIMEOUT_MS` — shutdown sırasında aktif revalidation bekleme süresi
- `ASSET_CDN_URL` — opsiyonel asset CDN origin'i

Runtime mock'ları yalnızca `development` ve `test` ortamlarında çalışır. Production gateway hataları mock içerik veya sahte oturum üretmez.

Detaylı cache ve geliştirme kuralları için [docs/conventions.md](docs/conventions.md) belgesine bakın.
