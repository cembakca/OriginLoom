/**
 * Reusable microbenchmark suite for the generic cache primitives
 * (`cache/index.ts` read/write, `cache/resource.ts` typed resources). Run
 * with `pnpm --filter @originloom/core bench`.
 *
 * These measure the in-process cost of the cache layer itself — key
 * encoding, L1 lookup, telemetry, (de)serialization — isolated from network
 * I/O, rendering, and the OS scheduler noise a real HTTP load test carries.
 * They are the right tool for answering "did this change make the cache
 * primitive itself faster or slower", not for reproducing end-to-end RPS
 * numbers; use `OriginLoomSigorta/load-test/insurance-benchmark.mjs` against
 * a running server for that.
 *
 * Caveat: this process never registers an OpenTelemetry SDK, so
 * `@opentelemetry/api`'s global tracer is the no-op default. The
 * "span-wrapped" case below therefore measures the *irreducible* cost of
 * going through `withSpan` (context propagation, try/finally, span object
 * churn) with zero exporter/processor work on top — a production deployment
 * with real span processors will see a *larger* gap than what this reports,
 * not a smaller one. Treat every number here as a floor, not a ceiling.
 */
import { afterAll, beforeAll, bench, describe } from "vitest";

import { closeCache, getCache, initCache, read, write } from "../src/cache/index.js";
import {
  type CachedResource,
  cachedResourceValue,
  defineCachedResource,
} from "../src/cache/resource.js";
import { SpanKind, withSpan } from "../src/observability.js";

async function freshReadOldShape(key: string) {
  return withSpan(
    "cache.read",
    { kind: SpanKind.INTERNAL, attributes: { "cache.backend": "memory" } },
    async (span) => {
      const result = await getCache().read(key);
      span.setAttribute("cache.result", result?.state ?? "miss");
      return result;
    },
  );
}

let coldMissCounter = 0;
let dynamicKeyCounter = 0;
const DYNAMIC_KEY_POOL_SIZE = 20;

let staticResource: CachedResource<{ value: number }>;
let dynamicResource: CachedResource<{ value: number }>;
let coldFillResource: CachedResource<{ value: number }>;

// One shared cache instance for the whole file — nesting a beforeAll/afterAll
// pair inside each describe below raced (`vitest bench` does not guarantee
// per-describe setup/teardown ordering the way `vitest run` does), so
// lifecycle is hoisted to file scope instead.
beforeAll(async () => {
  await initCache();
  await write("bench:fresh-hit", '{"ok":true}', { kind: "shared", ttl: 3_600, key: ["k"] });

  staticResource = defineCachedResource<{ value: number }>({
    namespace: "bench-static",
    version: 1,
    ttl: 3_600,
    parse: (value) => value as { value: number },
  });
  await staticResource.get([], async () => cachedResourceValue({ value: 1 }));

  dynamicResource = defineCachedResource<{ value: number }>({
    namespace: "bench-dynamic",
    version: 1,
    ttl: 3_600,
    parse: (value) => value as { value: number },
  });
  for (let i = 0; i < DYNAMIC_KEY_POOL_SIZE; i++) {
    await dynamicResource.get([`part-${i}`], async () => cachedResourceValue({ value: i }));
  }

  coldFillResource = defineCachedResource<{ value: number }>({
    namespace: "bench-cold-fill",
    version: 1,
    ttl: 3_600,
    parse: (value) => value as { value: number },
  });
});
afterAll(async () => {
  await closeCache();
});

describe("cache/index.ts — read()", () => {
  bench("fresh L1 hit — read() with the fast path (current)", async () => {
    await read("bench:fresh-hit");
  });

  bench("fresh L1 hit — span-wrapped (shape before the fast path existed)", async () => {
    await freshReadOldShape("bench:fresh-hit");
  });

  bench("fresh L1 hit — readSync() raw sync lookup (lower bound, no async wrapper)", () => {
    getCache().readSync?.("bench:fresh-hit");
  });

  bench("miss — read() for a key that was never written", async () => {
    await read("bench:never-written");
  });
});

describe("cache/resource.ts — defineCachedResource().get()", () => {
  bench("fresh hit — static key (parts: [])", async () => {
    await staticResource.get([], async () => cachedResourceValue({ value: 1 }));
  });

  bench("fresh hit — dynamic key, bounded rotating pool", async () => {
    dynamicKeyCounter = (dynamicKeyCounter + 1) % DYNAMIC_KEY_POOL_SIZE;
    await dynamicResource.get([`part-${dynamicKeyCounter}`], async () =>
      cachedResourceValue({ value: dynamicKeyCounter }),
    );
  });

  bench("cold miss + fill — unique key every call (populate cost)", async () => {
    coldMissCounter++;
    await coldFillResource.get([`unique-${coldMissCounter}`], async () =>
      cachedResourceValue({ value: coldMissCounter }),
    );
  });

  bench("key(parts) — static key encode (precomputed)", () => {
    staticResource.key([]);
  });

  bench("key(parts) — dynamic key encode (first-time, uncached parts)", () => {
    dynamicKeyCounter++;
    dynamicResource.key([`uncached-${dynamicKeyCounter}`]);
  });
});
