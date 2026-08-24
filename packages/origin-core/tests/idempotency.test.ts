import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeCache, initCache } from "../src/cache/index.js";
import { boundedIdempotencyKey, newIdempotencyKey, runOnce } from "../src/idempotency.js";

type Receipt = { id: number };

beforeEach(async () => {
  await closeCache();
  await initCache();
});

afterEach(async () => {
  await closeCache();
});

function subscribe(key: string, work: () => Promise<Receipt>) {
  return runOnce<Receipt>({
    namespace: "newsletter",
    key,
    work,
    serialize: (value) => JSON.stringify(value),
    parse: (raw) => JSON.parse(raw) as Receipt,
  });
}

describe("runOnce", () => {
  it("runs the work the first time it sees a key", async () => {
    let calls = 0;
    const result = await subscribe(newIdempotencyKey(), async () => ({ id: ++calls }));

    expect(result).toEqual({ kind: "fresh", value: { id: 1 } });
    expect(calls).toBe(1);
  });

  /**
   * The submission PRG never sees: the impatient second click, the retry after a
   * connection drops. Both arrive as separate POSTs carrying the same key.
   */
  it("replays the first outcome instead of running the work again", async () => {
    const key = newIdempotencyKey();
    let calls = 0;
    const work = async () => ({ id: ++calls });

    const first = await subscribe(key, work);
    const second = await subscribe(key, work);

    expect(first.kind).toBe("fresh");
    expect(second).toEqual({ kind: "replayed", value: { id: 1 } });
    expect(calls).toBe(1);
  });

  it("keeps two different keys apart, and two namespaces apart on one key", async () => {
    const shared = newIdempotencyKey();
    let calls = 0;
    const work = async () => ({ id: ++calls });

    await subscribe(shared, work);
    await subscribe(newIdempotencyKey(), work);
    const other = await runOnce<Receipt>({
      namespace: "recourse",
      key: shared,
      work,
      serialize: (value) => JSON.stringify(value),
      parse: (raw) => JSON.parse(raw) as Receipt,
    });

    expect(calls).toBe(3);
    expect(other.kind).toBe("fresh");
  });

  /**
   * A rejected submission is not an outcome worth remembering — the visitor has
   * to be able to fix their input and send the same form again.
   */
  it("does not record an outcome the caller refuses to serialize", async () => {
    const key = newIdempotencyKey();
    let calls = 0;
    const run = () =>
      runOnce<Receipt>({
        namespace: "newsletter",
        key,
        work: async () => ({ id: ++calls }),
        serialize: () => null,
        parse: (raw) => JSON.parse(raw) as Receipt,
      });

    expect((await run()).kind).toBe("fresh");
    expect((await run()).kind).toBe("fresh");
    expect(calls).toBe(2);
  });

  /**
   * Two concurrent submissions, one key, one store: only one may do the work.
   *
   * Deliberately not labelled "two pods" — everything in this file shares a
   * single `MemoryStore`, which is precisely the scope of the guarantee. Two
   * real pods on the default memory topology hold two stores and each accepts
   * the key once; what covers them is a shared L2, and the warning below is how
   * a deployment that has neither finds out.
   */
  it("refuses a second attempt while the first is still running", async () => {
    const key = newIdempotencyKey();
    let calls = 0;
    let release: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slow = subscribe(key, async () => {
      calls += 1;
      await started;
      return { id: calls };
    });
    // Give the first run time to take the lock before the second arrives.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const concurrent = await subscribe(key, async () => ({ id: ++calls }));

    expect(concurrent).toEqual({ kind: "in-flight" });
    release();
    expect((await slow).kind).toBe("fresh");
    expect(calls).toBe(1);
  });

  /** A record this release cannot read is a record from another one. */
  it("re-runs rather than guessing when a stored record cannot be parsed", async () => {
    const key = newIdempotencyKey();
    let calls = 0;

    await runOnce<Receipt>({
      namespace: "newsletter",
      key,
      work: async () => ({ id: ++calls }),
      serialize: () => "not json",
      parse: (raw) => JSON.parse(raw) as Receipt,
    });
    const second = await subscribe(key, async () => ({ id: ++calls }));

    expect(second.kind).toBe("fresh");
    expect(calls).toBe(2);
  });
});

describe("boundedIdempotencyKey", () => {
  it("accepts a key that could be a storage key", () => {
    expect(boundedIdempotencyKey(newIdempotencyKey())).not.toBeNull();
    expect(boundedIdempotencyKey("a".repeat(16))).toBe("a".repeat(16));
  });

  // The value ends up in a storage key, so its shape is checked, not escaped.
  it.each([undefined, null, "", "short", "a".repeat(129), "has spaces", "colon:separated"])(
    "refuses %p",
    (value) => {
      expect(boundedIdempotencyKey(value)).toBeNull();
    },
  );
});
