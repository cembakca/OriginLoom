import { cacheKey, closeCache, initCache, write } from "@originloom/core/cache";
import { closeGatewayTransport } from "@originloom/core/gateway-transport";
import { withRequestSpan } from "@originloom/core/observability";
import { fetchMenuList } from "@server/services/menu";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("menu service", () => {
  beforeEach(async () => {
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeGatewayTransport();
    await closeCache();
  });

  it("serves the last validated stale menu without calling a failing gateway", async () => {
    vi.useFakeTimers();
    const policy = { kind: "shared" as const, ttl: 1, swr: 60, key: ["menu:Desktop"] };
    const key = cacheKey(policy);
    if (!key) throw new Error("menu cache key missing");
    await write(key, JSON.stringify(menuPayload()), policy);
    await vi.advanceTimersByTimeAsync(1_500);
    const gateway = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", gateway);

    const menu = await fetchMenuList(new Request("http://localhost/"), "Desktop");

    expect(menu.headerItems[0]?.name).toBe("Kredi");
    expect(gateway).not.toHaveBeenCalled();
  });

  it("reuses one immutable parsed snapshot while the cached body is unchanged", async () => {
    const policy = { kind: "shared" as const, ttl: 60, key: ["menu:Desktop"] };
    const key = cacheKey(policy);
    if (!key) throw new Error("menu cache key missing");
    await write(key, JSON.stringify(menuPayload()), policy);

    const first = await fetchMenuList(new Request("http://localhost/"), "Desktop");
    const second = await fetchMenuList(new Request("http://localhost/"), "Desktop");

    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.headerItems)).toBe(true);
    expect(Object.isFrozen(first.headerItems[0])).toBe(true);
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

  it("deduplicates the same parsed menu work inside one inbound request", async () => {
    const gateway = vi.fn().mockResolvedValue(Response.json(menuPayload()));
    vi.stubGlobal("fetch", gateway);
    const request = new Request("http://localhost/");

    const [first, second] = await withRequestSpan(request, "menu-request", () =>
      Promise.all([fetchMenuList(request, "Desktop"), fetchMenuList(request, "Desktop")]),
    );

    expect(gateway).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("rejects unsafe and implicit external navigation URLs", async () => {
    for (const url of ["javascript:alert(1)", "//evil.example/path", "https://evil.example/path"]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(menuPayload({ url }))));

      await expect(fetchMenuList(new Request("http://localhost/"), "Desktop")).rejects.toThrow(
        "Menu gateway returned an invalid payload",
      );
      vi.unstubAllGlobals();
    }
  });

  it("accepts an explicitly external HTTPS navigation target", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(menuPayload({ url: "https://partner.example/offer", external: true })),
        ),
    );

    const menu = await fetchMenuList(new Request("http://localhost/"), "Desktop");

    expect(menu.headerItems[0]?.url).toBe("https://partner.example/offer");
    expect(menu.headerItems[0]?.external).toBe(true);
  });

  it("rejects excessive menu depth and item count", async () => {
    const nested = menuItem({ id: 4, url: "/four" });
    const depthThree = menuItem({ id: 3, url: "/three", subMenuItemList: [nested] });
    const depthTwo = menuItem({ id: 2, url: "/two", subMenuItemList: [depthThree] });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(menuPayload({ id: 1, url: "/one", subMenuItemList: [depthTwo] })),
        ),
    );
    await expect(fetchMenuList(new Request("http://localhost/"), "Desktop")).rejects.toThrow(
      "Menu gateway returned an invalid payload",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          headerItems: Array.from({ length: 50 }, (_, index) =>
            menuItem({
              id: index,
              url: `/item-${index}`,
              subMenuItemList: Array.from({ length: 4 }, (_, child) =>
                menuItem({ id: 1_000 + index * 4 + child, url: `/child-${index}-${child}` }),
              ),
            }),
          ),
        }),
      ),
    );
    await expect(fetchMenuList(new Request("http://localhost/"), "Desktop")).rejects.toThrow(
      "Menu gateway returned an invalid payload",
    );
  });
});

function menuPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { headerItems: [menuItem(overrides)] };
}

function menuItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: "Kredi",
    url: "/kredi",
    displayOrder: 1,
    mobileDisplayOrder: 1,
    itemType: 4,
    ...overrides,
  };
}
