import { describe, expect, it } from "vitest";

import {
  cacheProfile,
  type CacheProfileName,
  cacheProfiles,
  resolveCacheLifetime,
} from "../src/lib/cache-profiles.js";

const names = Object.keys(cacheProfiles) as CacheProfileName[];

describe("cache profiles", () => {
  /**
   * Without an SWR window the request that finds an expired entry pays for the
   * refill — and that request arrives exactly when a cold burst does.
   */
  it("gives every profile a stale-while-revalidate window", () => {
    for (const name of names) {
      expect(cacheProfile(name).swr).toBeGreaterThan(0);
      expect(cacheProfile(name).ttl).toBeGreaterThan(0);
    }
  });

  it("describes every profile, because the manifest shows it", () => {
    for (const name of names) {
      expect(cacheProfile(name).description.length).toBeGreaterThan(0);
    }
  });

  it("orders the time-based profiles from shortest to longest", () => {
    const ordered: CacheProfileName[] = ["realtime", "minutes", "hours", "daily", "static"];
    const ttls = ordered.map((name) => cacheProfile(name).ttl);

    expect(ttls).toEqual([...ttls].sort((a, b) => a - b));
  });
});

describe("resolveCacheLifetime", () => {
  it("resolves a profile name", () => {
    expect(resolveCacheLifetime("hours")).toEqual({ ttl: 3_600, swr: 21_600 });
  });

  /** A genuinely unusual lifetime should stay a number, not bend a profile. */
  it("passes an explicit pair straight through", () => {
    expect(resolveCacheLifetime({ ttl: 90, swr: 120 })).toEqual({ ttl: 90, swr: 120 });
  });

  it("defaults a missing explicit swr to none rather than inventing one", () => {
    expect(resolveCacheLifetime({ ttl: 90 })).toEqual({ ttl: 90, swr: 0 });
  });

  it("lets an override replace just the stale window", () => {
    expect(resolveCacheLifetime("hours", { swr: 60 })).toEqual({ ttl: 3_600, swr: 60 });
  });
});
