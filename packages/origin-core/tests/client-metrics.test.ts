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

  it.each([
    { kind: "web-vital", name: "FCP", value: 10, rating: "good", path: "/" },
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
