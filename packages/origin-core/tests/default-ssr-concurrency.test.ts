import { availableParallelism } from "node:os";

import { describe, expect, it } from "vitest";

import { defaultSsrMaxConcurrency } from "../src/config.js";

describe("defaultSsrMaxConcurrency", () => {
  it("keeps a 32-slot floor and scales with CPU count up to 256", () => {
    const cpus = availableParallelism();
    const expected = Math.min(256, Math.max(32, cpus * 4));

    expect(defaultSsrMaxConcurrency()).toBe(expected);
  });
});
