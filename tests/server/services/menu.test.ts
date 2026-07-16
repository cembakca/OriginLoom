import { closeCache, initCache } from "@server/cache";
import { fetchMenuList } from "@server/services/menu";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;
const originalRuntimeMocks = process.env.ENABLE_RUNTIME_MOCKS;

describe("menu service", () => {
  beforeEach(async () => {
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalRuntimeMocks === undefined) delete process.env.ENABLE_RUNTIME_MOCKS;
    else process.env.ENABLE_RUNTIME_MOCKS = originalRuntimeMocks;
    vi.unstubAllGlobals();
    await closeCache();
  });

  it("does not serve mock navigation after a production gateway failure", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ENABLE_RUNTIME_MOCKS;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(fetchMenuList(new Request("http://localhost/"), "Desktop")).rejects.toThrow(
      "Menu gateway returned 503",
    );
  });

  it("serves mock navigation when production runtime mocks are explicitly enabled", async () => {
    process.env.NODE_ENV = "production";
    process.env.ENABLE_RUNTIME_MOCKS = "true";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const menu = await fetchMenuList(new Request("http://localhost/"), "Desktop");

    expect(menu.headerItems.length).toBeGreaterThan(0);
  });
});
