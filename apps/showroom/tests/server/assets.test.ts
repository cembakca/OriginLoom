import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

describe("assetUrl", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns origin path when CDN is not set", async () => {
    delete process.env.ASSET_CDN_URL;
    vi.resetModules();
    const { assetUrl } = await import("@originloom/core/assets");
    expect(assetUrl("/assets/entry.client.js")).toBe("/assets/entry.client.js");
  });

  it("prefixes CDN base when ASSET_CDN_URL is set", async () => {
    process.env.ASSET_CDN_URL = "https://cdn.hangikredi.com";
    vi.resetModules();
    const { assetUrl, assetCdnOrigin } = await import("@originloom/core/assets");
    expect(assetUrl("/assets/entry.client.js")).toBe(
      "https://cdn.hangikredi.com/assets/entry.client.js",
    );
    expect(assetCdnOrigin()).toBe("https://cdn.hangikredi.com");
  });

  it("strips trailing slash from CDN URL", async () => {
    process.env.ASSET_CDN_URL = "https://cdn.hangikredi.com/";
    vi.resetModules();
    const { assetUrl } = await import("@originloom/core/assets");
    expect(assetUrl("/assets/entry.css")).toBe("https://cdn.hangikredi.com/assets/entry.css");
  });

  it("uses source modules and Vite runtime instead of the manifest in development", async () => {
    process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5174/";
    vi.resetModules();
    const { readAssets } = await import("@originloom/core/assets");

    const assets = readAssets();
    expect(assets).toMatchObject({
      js: "http://127.0.0.1:5174/src/entry.client.tsx",
      css: ["http://127.0.0.1:5174/src/styles/globals.css"],
      development: { client: "http://127.0.0.1:5174/@vite/client" },
    });
    expect(assets.fonts).toHaveLength(2);
    expect(assets.fonts[0]?.href).toMatch(/^\/assets\/media\/inter-latin\.[a-f0-9]+\.woff2$/);
  });

  it("refuses to boot dev against a client entry that does not exist", async () => {
    process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5174/";
    // The server runs from the app root in dev; the runner does not.
    vi.spyOn(process, "cwd").mockReturnValue(resolve(import.meta.dirname, "../.."));
    vi.resetModules();
    const { readAssets } = await import("@originloom/core/assets");

    // Vite would 404 this module and the page would never boot its islands.
    expect(() => readAssets({ clientEntry: "/src/entry.client.ts" })).toThrow(
      /Client entry not found: \/src\/entry\.client\.ts/,
    );
    expect(() => readAssets({ clientEntry: "/src/entry.client.tsx" })).not.toThrow();
  });

  it("collects only global eager islands and their recursive static imports", async () => {
    const { resolveManifestPreloads } = await import("@originloom/core/assets");
    const resolved = resolveManifestPreloads(
      {
        "src/entry.client.tsx": {
          file: "assets/entry.js",
          isEntry: true,
          imports: ["_entry-shared.js"],
        },
        "_entry-shared.js": { file: "assets/entry-shared.js" },
        "_island-shared.js": { file: "assets/island-shared.js" },
        "src/islands/layout-client.tsx": {
          file: "assets/layout-client.js",
          src: "src/islands/layout-client.tsx",
          isDynamicEntry: true,
          imports: ["src/entry.client.tsx", "_island-shared.js"],
        },
        "src/islands/page-analytics.tsx": {
          file: "assets/page-analytics.js",
          src: "src/islands/page-analytics.tsx",
          isDynamicEntry: true,
          imports: ["src/entry.client.tsx", "_island-shared.js"],
        },
        "src/islands/mobile-menu.tsx": {
          file: "assets/mobile-menu.js",
          src: "src/islands/mobile-menu.tsx",
          isDynamicEntry: true,
          imports: ["src/entry.client.tsx", "_island-shared.js"],
        },
      },
      { eagerIslands: ["layout-client", "page-analytics"] },
    );

    expect(resolved.modulePreloadFiles).toEqual([
      "assets/entry.js",
      "assets/entry-shared.js",
      "assets/layout-client.js",
      "assets/island-shared.js",
      "assets/page-analytics.js",
    ]);
    expect(resolved.modulePreloadFiles).not.toContain("assets/mobile-menu.js");
    expect(resolved.islandModulePreloadFiles["mobile-menu"]).toEqual([
      "assets/mobile-menu.js",
      "assets/entry.js",
      "assets/entry-shared.js",
      "assets/island-shared.js",
    ]);
  });
});
