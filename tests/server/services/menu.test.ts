import { closeCache, initCache } from "@server/cache";
import { fetchMenuList } from "@server/services/menu";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("menu service", () => {
  beforeEach(async () => {
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await closeCache();
  });

  it("propagates a gateway failure instead of hiding it with an in-app fixture", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(fetchMenuList(new Request("http://localhost/"), "Desktop")).rejects.toThrow(
      "Menu gateway returned 503",
    );
  });

  it("loads navigation from the external mock gateway", async () => {
    const menu = await fetchMenuList(new Request("http://localhost/"), "Desktop");

    expect(menu.headerItems.length).toBeGreaterThan(0);
  });
});
