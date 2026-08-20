import { describe, expect, it } from "vitest";

import { createRouteContext } from "../src/ssr/context.js";

describe("createRouteContext", () => {
  it("embeds the SSR request id as pageRequestId for client telemetry", () => {
    const request = new Request("http://127.0.0.1:3010/catalog?page=2");
    const routeCtx = createRouteContext(
      request,
      new URL("http://127.0.0.1:3010/internal/catalog?page=2"),
      "/catalog",
      { category: "cards" },
      { requestId: "1ee4a9e7-4502-436c-8518-40cdbe1b1171" },
    );

    expect(routeCtx.pageRequestId).toBe("1ee4a9e7-4502-436c-8518-40cdbe1b1171");
  });

  it("ignores unsafe request ids", () => {
    const routeCtx = createRouteContext(
      new Request("http://127.0.0.1:3010/"),
      new URL("http://127.0.0.1:3010/"),
      "/",
      {},
      { requestId: "bad id" },
    );

    expect(routeCtx.pageRequestId).toBeUndefined();
  });
});
