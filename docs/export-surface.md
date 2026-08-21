# Export yüzeyi (dondurulmuş)

Bu belge `@originloom/*` paketlerinin **tüketici taahhüdünü** tanımlar. `origin-create-app` şablonunun
import ettiği yollar **Tier 1 (template contract)** olarak kabul edilir; semver kuralları buna göre
uygulanır.

Machine-readable liste: `packages/origin-tooling/tests/export-surface.manifest.mjs`  
CI doğrulaması: `packages/origin-tooling/tests/export-surface.test.mjs`

Son güncelleme: platform **0.7.18** (template sürümü `.originloom/project.json` ile ayrı izlenir).

---

## Semver politikası

| Değişiklik                                        | Sürüm                               | Örnek                               |
| ------------------------------------------------- | ----------------------------------- | ----------------------------------- |
| Tier 1 subpath kaldırma veya imza breaking        | **Major**                           | `@originloom/core/seo` kaldırıldı   |
| Tier 1'e yeni subpath ekleme                      | **Minor**                           | `@originloom/core/webhooks` eklendi |
| Davranış düzeltmesi, Tier 1 API aynı              | **Patch**                           | cache TTL bugfix                    |
| `null` blocked internal path değişikliği          | **Patch** (dışarı açık değilse)     | pipeline refactor                   |
| Wildcard ile erişilen ama dokümante edilmemiş yol | **Risk** — Tier 1'e alın veya kapat | —                                   |

**1.0.0 öncesi:** Tier 1 listesi genişletilebilir; daraltmak major sayılır. Internal (`null`) yüzey
değişebilir.

**1.0.0 sonrası:** Tier 1 tablosu semver taahhüdüdür; `public-api.test.ts` blocked sızıntıyı,
`export-surface.test.mjs` şablon contract'ını korur.

---

## @originloom/core

### Tier 1 — `create-app` şablon contract'ı

| Subpath                       | Kullanım                                     |
| ----------------------------- | -------------------------------------------- |
| `adapters/gateway`            | Gateway fetch, identity, release             |
| `api/cache-purge`             | Operations port purge mount                  |
| `api/client-errors`           | Client error ingestion                       |
| `api/client-metrics`          | Client metrics ingestion                     |
| `app`                         | `createApp`                                  |
| `assets`                      | Manifest, `readAssets`, preload              |
| `auth/bff`                    | Session BFF, refresh                         |
| `cache`                       | L1/L2 init, topology, read/write             |
| `cache/key-codec`             | Cache key registry, purge API                |
| `cache/resource`              | Typed data-cache resource tanımları          |
| `config`                      | Env config, validation hook                  |
| `config-validation`           | Product config helpers                       |
| `gateway-payload`             | Contract budgets, JSON guards                |
| `gateway-transport`           | Shared fetch pool shutdown                   |
| `handler`                     | SSR handler, revalidation drain              |
| `instrumentation`             | OpenTelemetry register/shutdown              |
| `logger`                      | Structured logging                           |
| `media`                       | Responsive/unoptimized image helpers         |
| `metrics-server`              | Operations listener app                      |
| `metrics/primitives`          | Product metric lines                         |
| `middleware`                  | `defineMiddleware`, product rules            |
| `middleware/cookie-jar`       | BFF `Set-Cookie` jar, referral session       |
| `middleware/request-deadline` | API deadline, `contextRequest`               |
| `middleware/request-id`       | `AppVariables` typing                        |
| `middleware/sanitize`         | UUID sanitization for cookies                |
| `middleware/security`         | CSP script hash registration                 |
| `observability`               | `memoizeRequestValue`, spans                 |
| `runtime`                     | `installRuntime`, `OriginRuntime`, fragments |
| `security/public-api-guard`   | BFF rate limit, same-origin                  |
| `seo`                         | `mountSeoRoutes`, robots/sitemap             |

### Explicitly blocked (internal)

Bu subpath'ler `exports: null` ile kapalıdır; dışarıdan import **desteklenmez**:

| Pattern                                | İçerik                                    |
| -------------------------------------- | ----------------------------------------- |
| `ssr/*`                                | SSR pipeline, route execution, response   |
| `document/*`                           | Document orchestration internals          |
| `middleware/pipeline`                  | Middleware pipeline wiring                |
| `middleware/context`                   | Pipeline context                          |
| `middleware/product`                   | Product middleware merge internals        |
| `middleware/static-assets`             | Static asset middleware                   |
| `cache/cold-fill`                      | Distributed cold fill                     |
| `cache/revalidation`                   | SWR revalidation engine                   |
| `shell-resolution`                     | Shell dependency orchestration internals  |
| `metrics/cache-label`                  | Internal metric labels                    |
| `metrics/runtime`                      | Internal runtime metrics                  |
| `middleware/steps/auth/refresh-result` | Refresh result type (internal)            |
| `middleware/steps/redirection/gone`    | Gone handler internal                     |
| `public-url`                           | Public URL helper (internal)              |
| `app/*`                                | `createApp` alt modülleri (`app.ts` dışı) |

Showroom testleri ek yollar kullanabilir (ör. `cache/memory`, `middleware/sequential`); bunlar
wildcard `"./*"` ile açıktır ama **Tier 1 değildir** — yalnızca platform monorepo'sunda desteklenir.
Tüketici uygulamalar Tier 1 tablosuna yaslanmalıdır.

Doğrulama: `packages/origin-core/tests/public-api.test.ts`

---

## @originloom/react

Explicit export listesi — wildcard yok ( `./lib/*` hariç).

### Tier 1 — şablon contract'ı

| Subpath                      | Kullanım                           |
| ---------------------------- | ---------------------------------- |
| `server`                     | `createReactRenderer`              |
| `vite`                       | Client + SSR Vite preset           |
| `lib/types`                  | `defineRoute`, `Route`, boundaries |
| `lib/island`                 | `<Island />`                       |
| `lib/link`                   | `<Link />`                         |
| `lib/request-context`        | `useRequestContext`                |
| `lib/query/provider`         | TanStack Query wrapper             |
| `lib/client/island-mount`    | `createIslandMounter`              |
| `lib/metadata/metadata-head` | `<MetadataHead />`                 |

Diğer explicit export'lar (`lib/utils` vb.) Tier 2 — dokümante, şablonda zorunlu değil.

---

## @originloom/shared

Geniş wildcard: `./lib/*`, `./routing`, `./routing/*`, `./*`

### Tier 1 — şablon contract'ı

| Subpath                  | Kullanım                                |
| ------------------------ | --------------------------------------- |
| `routing`                | `configureRouting`                      |
| `routing/validate`       | Rule validation                         |
| `routing/resolve`        | Route resolution tests                  |
| `routing/types`          | Redirect/rewrite types                  |
| `head-scripts`           | `sequencedScript`                       |
| `lib/types`              | `Route`, `Ctx`, `defineRoute` (neutral) |
| `lib/cache-policy`       | `neverCache`, shared cache helpers      |
| `lib/cache-query-params` | Query normalization for cache keys      |
| `lib/content-values`     | Pagination, slug bounds                 |
| `lib/content-url`        | Navigation URL normalization            |
| `lib/cookies`            | Cookie constants                        |
| `lib/device`             | Device shell, cache fragments           |
| `lib/request`            | `cookie()` helper                       |
| `lib/media`              | Image types, preload                    |
| `lib/runtime-schema`     | Gateway payload guards                  |
| `lib/strip-undefined`    | Metadata merge                          |
| `lib/menu/types`         | Menu types                              |
| `lib/metadata/*`         | SEO, JSON-LD, site config               |
| `lib/analytics/*`        | GTM/dataLayer bootstrap                 |
| `lib/client/*`           | Island bootstrap, telemetry, api-fetch  |

---

## @originloom/tooling

Library export yok — yalnız CLI bin'leri (`origin-*`). Tüketici `devDependency` olarak kurar;
şablon `package.json` script'leri üzerinden çağırır.

---

## Yüzey değişikliği workflow

1. Platform kodu + şablon (`templates.mjs`) güncelle
2. `export-surface.manifest.mjs` Tier 1 listesini güncelle
3. `docs/export-surface.md` tablolarını güncelle
4. İlgili paket `README.md` export tablosunu güncelle
5. Breaking ise `docs/migrations/<sürüm>.md` + changeset
6. `pnpm exec vitest run packages/origin-tooling/tests/export-surface.test.mjs`
7. `pnpm release:verify`

---

## İlgili belgeler

- [platform-contributor.md](./platform-contributor.md) — katman kuralları, dual export
- [template-changes.md](./template-changes.md) — şablon PR checklist
- [releasing.md](./releasing.md) — publish ve prova
- [compatibility.md](./compatibility.md) — template ↔ platform matrix
