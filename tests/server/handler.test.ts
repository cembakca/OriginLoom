import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handle } from "../../server/handler";
import { closeCache, initCache } from "../../server/cache";
import home from "../../src/routes/home";
import account from "../../src/routes/account";

const assets = { js: "/assets/entry.client.js", css: [] };

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
    const res = await handle(new Request("http://localhost/unknown"), [home], assets);
    expect(res.status).toBe(404);
  });

  it("serves cached pages with HIT on second request", async () => {
    const req = new Request("http://localhost/");
    const first = await handle(req, [home], assets);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-cache")).toBe("MISS");

    const second = await handle(req, [home], assets);
    expect(second.status).toBe(200);
    expect(second.headers.get("x-cache")).toBe("HIT");
  });

  it("bypasses cache for uncached routes", async () => {
    const req = new Request("http://localhost/hesabim", {
      headers: { cookie: "sid=test-session" },
    });
    const res = await handle(req, [account], assets);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-cache")).toBe("BYPASS");
  });

  it("returns 401 for account without session", async () => {
    const res = await handle(new Request("http://localhost/hesabim"), [account], assets);
    expect(res.status).toBe(401);
  });

  it("sets x-request-id when provided", async () => {
    const res = await handle(new Request("http://localhost/"), [home], assets, {
      requestId: "req-123",
    });
    expect(res.headers.get("x-request-id")).toBe("req-123");
  });
});
