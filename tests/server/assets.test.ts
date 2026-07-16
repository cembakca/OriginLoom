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

  it("uses source modules and Vite runtime instead of the manifest in development", async () => {
    process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5174/";
    vi.resetModules();
    const { readAssets } = await import("@server/assets");

    const assets = readAssets();
    expect(assets).toMatchObject({
      js: "http://127.0.0.1:5174/src/entry.client.tsx",
      css: ["http://127.0.0.1:5174/src/styles/globals.css"],
      development: {
        client: "http://127.0.0.1:5174/@vite/client",
        reactRefresh: "http://127.0.0.1:5174/@react-refresh",
      },
    });
    expect(assets.fonts).toHaveLength(2);
    expect(assets.fonts[0]?.href).toMatch(/^\/assets\/media\/inter-latin\.[a-f0-9]+\.woff2$/);
  });
});
