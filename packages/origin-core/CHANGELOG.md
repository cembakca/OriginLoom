# @originloom/core

## 0.7.28

### Patch Changes

- Three items from `docs/framework-research-2026.md`.

  - **`after()` (8.1)** — post-response work that survives a deploy. The pattern it
    replaces is `void doIt()`, which is invisible to shutdown and whose rejection
    surfaces as an unhandled rejection with no request attached. Tasks park on the
    request, start once the handler has produced its response, are drained on
    shutdown against a budget, and log their own failures. Bounded in flight, so a
    runaway scheduler is refused loudly instead of growing until the pod dies.
  - **Taint (5.2)** — a runtime guard for the rule the cache architecture rests on:
    shared HTML must not carry one visitor's data. `taintObject` and `taintValue`
    mark server-only data, and `serializeEmbeddedJson` refuses to write it into
    island props or JSON-LD. The check rides on the walk `JSON.stringify` already
    does and is not installed at all when nothing is marked. Access and refresh
    tokens are marked automatically where they are read, so no app has to
    remember. Registry entries are released with their lifetime object and capped,
    so a leak guard cannot become a leak.
  - **Hono RPC (4.1)** — the generated app's BFF is now typed from its own routes.
    Route groups are chained and exported as `AppType`; `src/lib/api-client.ts`
    builds an `hc` client from it. The hand-written `SessionResponse` this replaces
    had already drifted — it was missing `signedIn`. Short-circuits go through
    `halt()`, because one bare `Response` branch collapses Hono's inferred body to
    `{}` and silently untypes every call site; a type-level test guards that.

- @originloom/shared@0.7.27

## 0.7.26

### Patch Changes

- Security review fixes across the request trust boundary.

  - **`gatewayFetch` no longer follows upstream redirects** (`redirect: "manual"`). It did, so anything
    answering a gateway call could steer that _server-side_ request at a host the app never named —
    cloud metadata, an internal service — using the pod's network position, and hand the body back to
    a caller that may write it into shared HTML. `proxyRequest` already did this; the path every
    service actually uses did not. A 3xx is now surfaced so `requireGatewayOk` rejects it.
  - **`resolveTrustedClientIp` distrusts a malformed `X-Forwarded-For` again.** The guard that was
    meant to discard a header containing an unparseable entry could never fire: the entries were
    filtered to valid addresses first, so the check ran against a list that by construction had none.
    A forged chain was silently repaired and then had its hops counted.
  - **`CookieJar` validates cookie names and paths.** The value was percent-encoded but the name and
    path were written verbatim, so either could append attributes — a `Domain=` that widens the
    cookie, or a second `Path=` — to a cookie the app believed it had scoped. Invalid input now
    throws instead of emitting an unsafe `Set-Cookie`.
  - **`displayNameFromAccess` no longer falls back to a slice of the access token.** That value is
    written to `account_text`, which is script-readable by design, so the fallback put credential
    material on the far side of the HttpOnly boundary the module exists to hold.

  Each fix ships with a regression test.

- @originloom/shared@0.7.26

## 0.7.25

### Patch Changes

- Refresh dependencies: `ioredis` 5.11, `undici` 8.10, and `@cyclonedx/cyclonedx-npm` 6 for the
  tooling SBOM generator. Toolchain moves to ESLint 10 with `@eslint-react/eslint-plugin` replacing
  the unmaintained-for-React-19 `eslint-plugin-react`, and the showroom's Radix wrappers drop
  `forwardRef` in favour of React 19 ref-as-prop. No public API changes.
- @originloom/shared@0.7.25

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
