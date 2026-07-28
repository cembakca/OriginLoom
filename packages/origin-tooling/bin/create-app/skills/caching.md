---
name: caching
description: Use when deciding how a page is cached in this OriginLoom app, or when adding or changing cache keys, TTL/SWR, or bypass rules. The cache engine belongs to the platform; this app drives it entirely through the registry in src/lib/cache-keys.ts.
---

# Caching

The platform caches whole rendered HTML pages (L1 memory, optional L2 Redis). This
app decides **what** is cached and **under which key** through one file:
`src/lib/cache-keys.ts`. Route files call `pageCachePolicy(id, ctx)` and nothing
else.

## The registry is the single source of truth

```ts
[PageCacheId.home]: {
  id: PageCacheId.home,
  description: "Ana sayfa",
  path: "/",
  strategy: "shared",     // "shared" | "never"
  ttl: 3600,              // seconds fresh
  swr: 3600,              // seconds it may be served stale while revalidating
  buildKey: (ctx) => ["home", locale(ctx.request), layoutCacheFragment(ctx)],
},
```

`pageCachePolicy` turns `strategy: "never"` into `neverCache()` and `"shared"` into
`sharedUnlessBypass(ctx, buildKey(ctx), { ttl, swr })`. Don't call those two
directly in routes — go through the registry.

## What may go in a cache key

Only **normalized values that change the produced HTML**:

- the page id (always the first segment)
- `locale(ctx.request)` for multilingual pages
- `layoutCacheFragment(ctx)` whenever the page renders the header/footer shell (it
  varies per device) — **required** for any page with chrome
- allow-listed query params that change content (e.g. `page`)

**Never** put in a key: auth tokens, session, user id, `signed_in`, or tracking
params (`utm_*`, `gclid`, …). Same `page=1` with different `utm` must be **one**
cache entry.

## Personal / per-user content

Cached HTML is shared across all visitors, so it must not contain anything
per-user. Two options:

1. Make the whole page uncacheable: registry `strategy: "never"` (→ `neverCache()`).
2. Keep the page cacheable and move the personal part into a **defer island** — it
   mounts on the client and fetches its own data, so the cache key never grows a
   session dimension. See the **islands** skill.

## Bypass vs invalidation (don't confuse them)

- **Bypass** — this request skips the cache (`x-cache: BYPASS`). Driven by
  `strategy: "never"` or a registered check (`registerCacheBypassCheck`). Bypass
  checks decide _whether_ to use the cache; they never enter the key.
- **Invalidation** — an existing entry is deleted so the next anonymous request
  MISSes and re-renders. Done via the internal purge API or TTL expiry.

## SWR

Each entry carries `freshUntil` and `staleUntil`. After `freshUntil` the old HTML
is still served (`x-cache: STALE`) while the platform revalidates in the
background — the TTL boundary is not a hard cliff.

## `x-cache` header

`HIT` fresh · `STALE` stale + revalidating · `MISS` rendered & written ·
`BYPASS` cache skipped · `REDIRECT`/`PROXY` cache not involved.

## Cache'i boşaltmak

Deploy sonrası render çıktısı değiştiyse (bileşen değişikliği, kopya düzeltmesi)
cache'i düşürmek gerekir. Uçlar **operations portunda** durur, sitede değil:

```bash
curl -s "http://127.0.0.1:9010/api/internal/cache/keys?prefix=catalog"
curl -s -X POST http://127.0.0.1:9010/api/internal/cache/purge \
  -H "authorization: Bearer $CACHE_PURGE_SECRET" \
  -H "content-type: application/json" \
  -d '{"mode":"prefix","prefix":"catalog"}'
```

`CACHE_PURGE_SECRET` tanımlıysa bearer token (veya `X-Cache-Purge-Token`) zorunlu;
production'da secret yoksa uçlar 503 döner. Development'ta secret olmadan açıktır —
korunacak bir şey yoktur.

`RELEASE_ID` değiştiğinde Redis namespace'i de değişir, yani yeni release zaten
boş cache ile başlar; purge esas olarak aynı release içinde içerik düzeltmek için.
