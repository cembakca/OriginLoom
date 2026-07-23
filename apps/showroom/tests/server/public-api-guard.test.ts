import { closeCache, initCache } from "@originloom/core/cache";
import {
  guardPublicApi,
  isSameOriginBrowserRequest,
  type PublicApiPolicy,
} from "@originloom/core/security/public-api-guard";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const policy: PublicApiPolicy = {
  name: "guard-test",
  windowMs: 60_000,
  globalLimit: 10,
  ipLimit: 1,
};

beforeEach(async () => {
  await initCache();
});

afterEach(async () => {
  await closeCache();
});

describe("public API guard", () => {
  it("enforces the shared per-IP budget without storing the raw address in its key", async () => {
    const request = new Request("http://localhost/api/test");
    expect(await guardPublicApi(request, "203.0.113.10", policy)).toBeNull();
    const limited = await guardPublicApi(request, "203.0.113.10", policy);
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBeTruthy();
    expect(await guardPublicApi(request, "203.0.113.11", policy)).toBeNull();
  });

  it("accepts same-origin metadata and rejects missing or sibling-origin metadata", () => {
    expect(
      isSameOriginBrowserRequest(
        new Request("http://localhost/api/test", {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin" },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOriginBrowserRequest(new Request("http://localhost/api/test", { method: "POST" })),
    ).toBe(false);
    expect(
      isSameOriginBrowserRequest(
        new Request("http://localhost/api/test", {
          method: "POST",
          headers: { origin: "http://sub.localhost:3005", "sec-fetch-site": "same-site" },
        }),
      ),
    ).toBe(false);
  });
});
