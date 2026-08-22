# @originloom/core

## 0.7.24

### Patch Changes

- Remove fixed per-request cost from the warm cache path. `cacheTopology()` resolved
  `process.env.CACHE_BACKEND`/`REDIS_URL` on every `read()` — including the L1 fast path — at roughly
  16x the cost of a plain property read; the topology is now resolved once per cache lifetime and
  invalidated by `initCache()`/`closeCache()`. A fresh L1 hit measures 570ns -> 352ns, and a typed
  cached-resource hit 815ns -> 624ns.
- `materializeCachedHtmlDynamicValues` no longer performs two full-document passes that almost never
  match. The unknown-slot regex sweep and the defensive CSP-nonce pass are gated on an exact
  substring check, and a body carrying no slot marker at all returns immediately. Output is
  byte-identical for every input; a marker-free body measures 16.1us -> 3.4us and a stitched fragment
  371ns -> 121ns.
- `CacheStore.peek()` is renamed `CacheStore.readSync()`. It was never a peek: it reorders MRU and
  evicts an expired entry, exactly as `read()` does. The old name invited callers to use it for
  non-disturbing inspection, which would have corrupted L1 recency ordering.
- The untraced L1 fast path now increments `ssr_cache_operations_total{operation="read"}` alongside
  the new `ssr_cache_fast_path_reads_total`, so cache read volume no longer collapses to near-zero
  once the cache is warm. **Metric semantics change:**
  `ssr_cache_operation_duration_milliseconds{operation="read"}` now covers only misses, stale hits
  and L2 reads — its p50 will step up on upgrade, because the cheapest population deliberately left
  it.
- `Histogram.observe` no longer allocates a closure per observation (`findIndex` callback) or
  re-`set`s an already-present map entry.
- `MemoryStore.readSync` no longer allocates two throwaway object literals per read.
- `resolveHandleRequest` reuses the URL `prepareRequest` already parsed instead of performing a third
  `new URL(request.url)` per request.

## 0.7.19

### Patch Changes

- Coordinate development full reloads with the ready SSR process generation, migrate generated Vite
  path allowlists, and prevent no-op icon codegen from causing watcher restart storms.
- Updated dependencies
  - @originloom/shared@0.7.19

## 0.7.18

### Patch Changes

- Improve client telemetry and local development reliability: accept market-stream reports, expose
  PII-free support references for fatal island failures, stabilize pageRequestId in structured logs,
  keep the global SSR fallback active when a route boundary fails, automate 0.7.17 source
  migrations, and rebuild media assets while the dev server is running.
- Updated dependencies
  - @originloom/shared@0.7.18
