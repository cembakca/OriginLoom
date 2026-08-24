import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeCache, initCache } from "../src/cache/index.js";
import { newIdempotencyKey, runOnce } from "../src/idempotency.js";
import { logger } from "../src/logger.js";

type Receipt = { id: number };

/**
 * Its own file because the warning is said once per process, and a file that
 * already ran a guard would have spent it before the assertion.
 */
beforeEach(async () => {
  await closeCache();
  await initCache();
});

afterEach(async () => {
  await closeCache();
  vi.restoreAllMocks();
});

function subscribe(work: () => Promise<Receipt>) {
  return runOnce<Receipt>({
    namespace: "newsletter",
    key: newIdempotencyKey(),
    work,
    serialize: (value) => JSON.stringify(value),
    parse: (raw) => JSON.parse(raw) as Receipt,
  });
}

describe("the scope of the idempotency guarantee", () => {
  /**
   * A guard that quietly does less than its caller believes is the failure this
   * module exists to avoid. `unavailable` covers the store that cannot record at
   * all; this covers the store that records perfectly well and is only one pod
   * wide — which is what the generated `.env.production` ships.
   */
  it("says so, once, when the records are process-local", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await subscribe(async () => ({ id: 1 }));
    await subscribe(async () => ({ id: 2 }));

    const said = warn.mock.calls.filter(([message]) => String(message).includes("process-local"));
    expect(said).toHaveLength(1);
    // The remedy is half the point: a warning that names no way out is noise.
    expect(String((said[0]?.[1] as { remedy?: unknown } | undefined)?.remedy)).toContain(
      "REDIS_URL",
    );
  });
});
