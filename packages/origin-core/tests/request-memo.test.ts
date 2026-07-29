import { describe, expect, it, vi } from "vitest";

import { memoizeRequestValue, withRequestSpan } from "../src/observability.js";

describe("request-scoped service memoization", () => {
  it("shares parsed work inside one request and never across requests", async () => {
    const load = vi.fn(async () => ({ value: load.mock.calls.length }));

    const first = await withRequestSpan(new Request("http://localhost/one"), "request-one", () =>
      Promise.all([
        memoizeRequestValue("gateway:menu", load),
        memoizeRequestValue("gateway:menu", load),
      ]),
    );
    const second = await withRequestSpan(new Request("http://localhost/two"), "request-two", () =>
      memoizeRequestValue("gateway:menu", load),
    );

    expect(load).toHaveBeenCalledTimes(2);
    expect(first[0]).toBe(first[1]);
    expect(second).not.toBe(first[0]);
  });

  it("evicts rejected work so a controlled retry can run", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce("ok");

    await withRequestSpan(new Request("http://localhost/"), "request-retry", async () => {
      await expect(memoizeRequestValue("gateway:profile", load)).rejects.toThrow("temporary");
      await expect(memoizeRequestValue("gateway:profile", load)).resolves.toBe("ok");
    });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
