import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { config } from "@originloom/core/config";
import type { Route } from "@originloom/shared/lib/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const assets = { js: "/assets/entry.client.js", css: [], fonts: [] };
const passthroughCapacity = {
  run: <T>(_signal: AbortSignal, work: () => Promise<T>) => work(),
};

describe("public static files", () => {
  beforeEach(async () => {
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    await closeCache();
  });

  it("serves files from the namespaced public icon directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "originloom-public-"));
    const iconRoot = join(root, `${config.assetNamespace}-icons`);
    await mkdir(iconRoot, { recursive: true });
    await writeFile(join(iconRoot, "test.img"), "public static example\n");

    const app = createApp({
      assets,
      routes: [] as Route[],
      readinessCheck: async () => true,
      capacity: passthroughCapacity,
      publicStaticRoot: root,
    });

    const response = await app.request(`http://localhost/${config.assetNamespace}-icons/test.img`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("public static example\n");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");

    const legacyAlias = await app.request(
      `http://localhost/public/${config.assetNamespace}-icons/test.img`,
    );
    expect(legacyAlias.status).toBe(200);
  });

  it("serves namespaced client chunks with immutable caching", async () => {
    const root = await mkdtemp(join(tmpdir(), "originloom-client-assets-"));
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "assets/entry.abc123.js"), "export {};\n");

    const app = createApp({
      assets,
      routes: [] as Route[],
      readinessCheck: async () => true,
      capacity: passthroughCapacity,
      staticRoot: root,
      publicStaticRoot: false,
    });
    const response = await app.request(
      `http://localhost/${config.assetNamespace}/assets/entry.abc123.js`,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("export {};\n");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});
