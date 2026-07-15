import { afterEach, describe, expect, it, vi } from "vitest";

describe("assetUrl", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.resetModules();
  });

  it("returns origin path when CDN is not set", async () => {
    delete process.env.ASSET_CDN_URL;
    vi.resetModules();
    const { assetUrl } = await import("@server/assets");
    expect(assetUrl("/assets/entry.client.js")).toBe("/assets/entry.client.js");
  });

  it("prefixes CDN base when ASSET_CDN_URL is set", async () => {
    process.env.ASSET_CDN_URL = "https://cdn.hangikredi.com";
    vi.resetModules();
    const { assetUrl, assetCdnOrigin } = await import("@server/assets");
    expect(assetUrl("/assets/entry.client.js")).toBe(
      "https://cdn.hangikredi.com/assets/entry.client.js",
    );
    expect(assetCdnOrigin()).toBe("https://cdn.hangikredi.com");
  });

  it("strips trailing slash from CDN URL", async () => {
    process.env.ASSET_CDN_URL = "https://cdn.hangikredi.com/";
    vi.resetModules();
    const { assetUrl } = await import("@server/assets");
    expect(assetUrl("/assets/entry.css")).toBe("https://cdn.hangikredi.com/assets/entry.css");
  });
});
