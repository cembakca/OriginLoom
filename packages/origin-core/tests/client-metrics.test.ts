import { describe, expect, it } from "vitest";

import { parseClientMetricPayload } from "../src/api/client-metrics";

describe("client performance metric contract", () => {
  it("accepts a bounded Core Web Vital and strips query values from the path", async () => {
    const metric = await parseClientMetricPayload(
      request({
        kind: "web-vital",
        name: "LCP",
        value: 1_250,
        rating: "good",
        path: "/catalog?customer=secret",
      }),
    );

    expect(metric).toEqual({
      kind: "web-vital",
      name: "LCP",
      value: 1_250,
      rating: "good",
      path: "/catalog",
    });
  });

  it("accepts a bounded island mount duration", async () => {
    await expect(
      parseClientMetricPayload(
        request({
          kind: "island-mount",
          name: "account-panel",
          value: 42.5,
          path: "/account",
        }),
      ),
    ).resolves.toMatchObject({ kind: "island-mount", name: "account-panel", value: 42.5 });
  });

  /**
   * The reason string comes from the browser and becomes a metric label, so it
   * is shape-checked rather than trusted — and dropped rather than sanitised,
   * because a mangled label looks like a real reason nobody can find.
   */
  it("accepts a back/forward cache outcome and its reason code", async () => {
    await expect(
      parseClientMetricPayload(
        request({
          kind: "bfcache",
          outcome: "blocked",
          reason: "response-cache-control-no-store",
          value: 1,
          path: "/kasko?utm_source=x",
        }),
      ),
    ).resolves.toEqual({
      kind: "bfcache",
      outcome: "blocked",
      reason: "response-cache-control-no-store",
      path: "/kasko",
    });
  });

  it.each([
    { kind: "web-vital", name: "FCP", value: 10, rating: "good", path: "/" },
    { kind: "bfcache", outcome: "maybe", reason: "unload-handler", value: 1, path: "/" },
    { kind: "bfcache", outcome: "blocked", reason: "Injected {label}", value: 1, path: "/" },
    { kind: "web-vital", name: "CLS", value: -1, rating: "poor", path: "/" },
    { kind: "island-mount", name: "../../token", value: 10, path: "/" },
  ])("rejects an unbounded or unknown metric: $name", async (payload) => {
    await expect(parseClientMetricPayload(request(payload))).resolves.toBeNull();
  });
});

function request(payload: unknown): Request {
  return new Request("http://app.test/api/internal/client-metrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
