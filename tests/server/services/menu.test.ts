import { closeCache, initCache } from "@server/cache";
import { fetchMenuList } from "@server/services/menu";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;

describe("menu service", () => {
  beforeEach(async () => {
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.unstubAllGlobals();
    await closeCache();
  });

  it("does not serve mock navigation after a production gateway failure", async () => {
    process.env.NODE_ENV = "production";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(fetchMenuList(new Request("http://localhost/"), "Desktop")).rejects.toThrow(
      "Menu gateway returned 503",
    );
  });
});
