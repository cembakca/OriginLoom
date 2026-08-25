import { clearTaintRegistryForTests, taintValue } from "@originloom/shared/lib/taint";
import type { CachePolicy } from "@originloom/shared/lib/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeCache, initCache, read, write } from "../src/cache/index.js";

const POLICY: CachePolicy = { kind: "shared", ttl: 60, key: ["taint"] };

describe("a shared cache entry cannot carry a marked value", () => {
  beforeEach(async () => {
    clearTaintRegistryForTests();
    await initCache();
  });

  afterEach(async () => {
    clearTaintRegistryForTests();
    await closeCache();
    vi.restoreAllMocks();
  });

  /**
   * The route the embedded-JSON guard cannot see: rendered as text, into HTML a
   * shared cache is about to serve to everyone.
   */
  it("refuses to store HTML containing a tainted value", async () => {
    const lifetime = {};
    const token = "refresh-token-abcdef123456";
    taintValue("refresh token", lifetime, token);

    const written = await write("page:/hesabim", `<p>Merhaba ${token}</p>`, POLICY);

    expect(written).toBe(false);
    expect(await read("page:/hesabim")).toBeNull();
  });

  it("stores an entry that carries none", async () => {
    const lifetime = {};
    taintValue("refresh token", lifetime, "refresh-token-abcdef123456");

    const written = await write("page:/", "<p>Merhaba</p>", POLICY);

    expect(written).toBe(true);
  });

  /**
   * The guard walks the marked values, not the document, so an app that marks
   * nothing pays nothing — and that is the common case.
   */
  it("does nothing when nothing is marked", async () => {
    expect(await write("page:/liste", "<p>refresh-token-abcdef123456</p>", POLICY)).toBe(true);
  });
});
