import { closeCache, initCache } from "@originloom/core/cache";
import { fetchRouteDomains, isKnownRecoursePage } from "@server/services/route-domains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("route domains service", () => {
  beforeEach(async () => {
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await closeCache();
  });

  it("loads business route values from the gateway registry", async () => {
    const domains = await fetchRouteDomains();

    expect(domains.recoursePages).toContain("kredi");
    await expect(isKnownRecoursePage("random-unique-page")).resolves.toBe(false);
  });

  it("reuses the validated snapshot instead of calling the gateway per request", async () => {
    await fetchRouteDomains();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(isKnownRecoursePage("kredi")).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid registry payloads instead of treating them as domain data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ recoursePages: ["Kredi"] })));

    await expect(fetchRouteDomains()).rejects.toThrow(
      "Route domains gateway returned an invalid payload",
    );
  });

  it("propagates registry outages instead of silently falling back to env", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(fetchRouteDomains()).rejects.toThrow("Route domains gateway returned 503");
  });
});
