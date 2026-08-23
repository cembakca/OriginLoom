# @originloom/tooling

## 0.7.29

## 0.7.28

## 0.7.26

### Patch Changes

- Move to Node 24 and pin the published API surface — the two things a stable major has to get right
  before it is cut.

  - **Node 24 (Active LTS) replaces Node 22 everywhere, floored at `>=24.18.1`.** Node 22 has been in
    maintenance since 2025-10-21 — critical fixes only — while Node 24 is Active LTS until
    2028-04-30. The repo also carried three different floors (`>=22.12.0` in the published packages,
    `>=22.19.0` in generated apps, `>=22.22.2` at the root), the highest of which was already two Node
    security releases behind. One floor now covers the packages, the root, the showroom, the
    scaffolded app, its Dockerfile, `.nvmrc`, both CI workflows and the compatibility matrix, and the
    SSR build target moves from `node22` to `node24` so nothing is down-levelled for a runtime that is
    no longer supported.
  - **`@types/node` is unified on the same major as the runtime (`^24.13.3`).** The workspace was
    building against `@types/node@26` while declaring a Node 22 floor — types four majors ahead of the
    runtime, so an API that does not exist on the supported Node compiles clean and fails in
    production. `@originloom/react` never declared the types its Vite peer needs, which let a second
    copy into the graph and instantiated Vite twice; a root override now keeps exactly one. The
    `0.7.26-node-24` migration carries both the floor and the types into existing apps.
  - **The published API surface is pinned** (`tests/package-surface.manifest.mjs`). Each package
    exposes its modules through a wildcard in `exports` with internals closed by `null` — a deny-list,
    where a new source file becomes public the moment it is written and nobody finds out until a
    consumer imports it and the next refactor is a breaking change. The manifest does not change what
    is exported; it records the 144 subpaths that are, so growing the surface is a deliberate edit.

- Carry four patterns proven in a production consumer app into the generated project.

  - **`server/product/csp.ts`** — the content security policy moves out of `product/analytics.ts`
    into its own module. It now covers `connectSrc` and `imgSrc` as well as `scriptSrc`, so the
    beacons a GTM container actually sends are no longer blocked, adds an `IMAGE_CDN_URL` origin,
    and parses env URLs defensively: a malformed `EFILLI_SCRIPT_URL` used to throw at import time
    and take the process down on boot.
  - **`server/lib/bff-auth.ts` + `bff-http.ts`** — the private response helpers in
    `server/api/session.ts` become a shared layer (`requireBffAuth`, `resolveBffGatewayContext`,
    `bffJson`, `bffSignedOut`, `bffSessionUnavailable`), so the second BFF route is a call rather
    than a copy-paste of the `no-store` headers and auth-cookie plumbing.
  - **`server/diagnostics/`** — an opt-in request tracer behind `SSR_DIAGNOSTICS=1`. Services now
    import the gateway from `@server/diagnostics/gateway`, a transparent pass-through that times
    each upstream call and logs a breakdown for failed or slow requests only. Inert when off.
  - **`src/lib/shell-context.tsx` + `device-shell.ts`** — `RootLayout` provides the shell through
    context, so page content rendered as `children` can reach it with `useShell()` instead of
    being threaded props. A `tailwind.config.js` skeleton ships alongside for JS-side design tokens.

  Follow-up hardening in the same area:

  - **`eslint-rules/no-direct-gateway-import.mjs`** — an app-owned lint rule (with tests) that keeps
    services on the diagnostics adapter. A direct `@originloom/core/adapters/gateway` import still
    works, which is the problem: it silently drops out of every trace. Autofixable, and it covers
    `import`, `export … from`, `export *` and dynamic `import()`.
  - The diagnostics tracer now resolves the request id from the platform's async request context
    (`activeRequestId`) rather than an inbound `x-request-id` header, and `logSsrOutcome` is wired
    into the fetch handler. Previously nothing called it: traces accumulated and were never emitted
    or released, so the mode produced no output at all.
  - `productCsp` also allows the consent script's own origin in `connect-src`, so the mock gateway
    standing in for the vendor in development can be called back.
  - `projectMenu` sorts the menu — every list and nested submenu — once per menu snapshot instead of
    on every render, memoized on the snapshot object.

## 0.7.25

## 0.7.24

### Patch Changes

- Fix a long-standing measurement error in the generated capacity/performance suite. autocannon
  reports the `hdr-histogram-percentiles-obj` set, which goes 90 -> 97.5 and contains **no p95**:
  `result.latency.p95` was always `undefined` and fell through to `p97_5`, so every number reported
  and gated as "p95" was really p97.5. The metric is now captured and reported under its real name
  (`latencyP97_5Median`), and the `0.7.24-warm-path-performance` migration renames
  `regression.latencyP95IncreasePercent` to `latencyP97_5IncreasePercent` in an existing app's
  `performance-policy.json`. The threshold value is preserved — this corrects what the gate is
  called, never what it enforces.

## 0.7.19

### Patch Changes

- Coordinate development full reloads with the ready SSR process generation, migrate generated Vite
  path allowlists, and prevent no-op icon codegen from causing watcher restart storms.

## 0.7.18

### Patch Changes

- Improve client telemetry and local development reliability: accept market-stream reports, expose
  PII-free support references for fatal island failures, stabilize pageRequestId in structured logs,
  keep the global SSR fallback active when a route boundary fails, automate 0.7.17 source
  migrations, and rebuild media assets while the dev server is running.
