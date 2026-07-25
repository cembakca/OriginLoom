---
name: testing
description: Use when writing or running tests in this OriginLoom app. Covers the Vitest setup, how to mock the platform packages, what to test (loaders, cache keys, islands), and the commands.
---

# Testing

Tests run on **Vitest**: `pnpm test` (which is `vitest run`).

## Setup — `vitest.config.ts`

The generated config resolves the app aliases (`~`, `@server`) and, importantly:

```ts
test: {
  server: { deps: { inline: [/@originloom\//] } },
}
```

The `@originloom/*` packages are inlined so `vi.mock` substitutions (e.g. faking a
gateway fetch or `ioredis`) reach their internals. Keep this when adding config.

## What to test

- **Loaders / services** — the highest-value tests. Mock the gateway `fetch`,
  assert the shaped `data`, and cover the terminal results (`notFound()`,
  `redirect()`, `routeError()`). For a cacheable route, also assert that
  concurrent loads for the same key run the loader once.
- **Cache keys** — `buildKey` produces the expected, normalized segments and that
  tracking params never change the key.
- **Islands** — render and assert behavior; keep props JSON-serializable.
- **Metadata** — `generateMetadata` yields the expected canonical/robots/OG.

## Conventions

- Mirror the source layout under `tests/` (`tests/server/...`, `tests/src/...`).
- Import from the app via the `~/` and `@server/` aliases, same as source.
- Prefer testing behavior at the service/loader boundary over deep internals.

```bash
pnpm test          # run once
pnpm test --watch  # watch mode
```
