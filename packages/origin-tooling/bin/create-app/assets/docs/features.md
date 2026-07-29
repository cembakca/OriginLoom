# OriginLoom özellik rehberi

Bu proje yalnız çalışan bir ana sayfa değil, OriginLoom'un production kontratlarını gösteren bir
referans uygulamadır. Örnekleri ürün kodunu kopyalamak için değil, sahiplik sınırlarını koruyarak
uyarlamak için kullanın.

| Konu                                  | Çalışan örnek                                            | Ayrıntı                                                  |
| ------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| SSR route, loader ve boundary         | `server/routes/`                                         | `README.md`                                              |
| L1/L2 HTML cache, SWR ve purge        | `src/lib/cache-keys.ts`                                  | [caching.md](./caching.md)                               |
| Cache'siz HTML + API data cache       | `/data-cache`, `server/services/featured-items.ts`       | [caching.md](./caching.md)                               |
| Kademeli kapasite ve cache provası    | `pnpm capacity`, `load-test/`                            | [capacity.md](./capacity.md)                             |
| Performans kabulü ve profiling        | `performance-policy.json`, `pnpm capacity:profile`       | [performance-acceptance.md](./performance-acceptance.md) |
| Sıcak yol ve cold-start optimizasyonu | Platform request/cache/build runtime'ı                   | [runtime-performance.md](./runtime-performance.md)       |
| Hydrate/defer island ve BFF auth      | `src/islands/account-panel.tsx`                          | [auth.md](./auth.md)                                     |
| Client server-state ve query cache    | `src/lib/query/`, `account-panel.tsx`                    | [react-query.md](./react-query.md)                       |
| Progressive HTML ve güvenli SSE       | `server/routes/live.tsx`, `server/api/live-stream/`      | [streaming.md](./streaming.md)                           |
| Fragment stitching                    | `server/product/fragments.tsx`                           | [caching.md](./caching.md)                               |
| Metadata, JSON-LD, robots ve sitemap  | `server/seo.ts`, route metadata                          | [seo.md](./seo.md)                                       |
| Metrics, tracing ve client errors     | `server/metrics/`, `server/index.ts`                     | [observability.md](./observability.md)                   |
| Cached dynamic menu ve degradation    | `server/services/menu.ts`, `shell-data.ts`               | [caching.md](./caching.md)                               |
| Bounded background worker             | `OriginRuntime.onBotVisit` extension point               | [background-workers.md](./background-workers.md)         |
| Responsive media ve ikon üretimi      | `server/media.config.json`, `src/assets/`                | `pnpm media`, `pnpm icons`                               |
| Redirect, rewrite, proxy ve CMS gone  | `src/routing/rules.ts`, `mock-gateway/server.mjs`        | [routing.md](./routing.md)                               |
| Deployment                            | `Dockerfile`; `--with-ops` kullanıldıysa `OPERATIONS.md` | Ortam değişkenleri `.env.*`                              |
| Ortam değişkenleri                    | `.env.development`, `.env.production`                    | [configuration.md](./configuration.md)                   |
| Test stratejisi                       | `tests/`                                                 | [testing.md](./testing.md)                               |
| Upgrade ve migration                  | `.originloom/project.json`, `origin-doctor`              | [upgrading.md](./upgrading.md)                           |

## Platform ve ürün sınırı

Cache motoru, middleware, auth primitives, SSR dispatch ve metadata çözümleyici
`@originloom/*` paketlerindedir. Bu uygulama route tablosunu, cache kimliklerini, gateway
kontratlarını, ürün metriklerini ve UI'ı sahiplenir. Platform kodunu uygulamaya kopyalamayın.

## Production'a çıkmadan önce

`pnpm ci` çalıştırın; gerçek gateway kontratlarını ve limitlerini tanımlayın; production secret'larını
secret manager'dan verin; Redis/readiness davranışını test edin; SSE kullanıyorsanız connection
limitlerini kapasite testinden sonra ayarlayın; metrics portunu public ingress'e açmayın.
