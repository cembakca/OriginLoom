import { closeCache, initCache } from "@server/cache";
import { handle } from "@server/handler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Route } from "~/lib/types";
import account from "~/routes/account";
import home from "~/routes/home";

const assets = { js: "/assets/entry.client.js", css: [] };
const homeRoute = home as Route;
const accountRoute = account as Route;

describe("handler", () => {
  beforeEach(async () => {
    process.env.CACHE_BACKEND = "memory";
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    await closeCache();
  });

  it("returns 404 for unknown paths", async () => {
    const res = await handle(new Request("http://localhost/unknown"), [homeRoute], assets);
    expect(res.status).toBe(404);
  });

  it("serves cached pages with HIT on second request", async () => {
    const req = new Request("http://localhost/");
    const first = await handle(req, [homeRoute], assets);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-cache")).toBe("MISS");

    const second = await handle(req, [homeRoute], assets);
    expect(second.status).toBe(200);
    expect(second.headers.get("x-cache")).toBe("HIT");
  });

  it("bypasses cache for uncached routes", async () => {
    const req = new Request("http://localhost/hesabim", {
      headers: { Authorization: "Bearer test-token-1234" },
    });
    const res = await handle(req, [accountRoute], assets);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-cache")).toBe("BYPASS");
  });

  it("serves account page shell without auth (client island handles 401)", async () => {
    const res = await handle(new Request("http://localhost/hesabim"), [accountRoute], assets);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-cache")).toBe("BYPASS");
    const html = await res.text();
    expect(html).toContain("Hesabım");
    expect(html).toContain('data-island="account-dashboard"');
  });

  it("sets x-request-id when provided", async () => {
    const res = await handle(new Request("http://localhost/"), [homeRoute], assets, {
      requestId: "req-123",
    });
    expect(res.headers.get("x-request-id")).toBe("req-123");
  });
});
