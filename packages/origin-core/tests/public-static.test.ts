import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
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

  it("serves files from the project public directory under /public/*", async () => {
    const root = await mkdtemp(join(tmpdir(), "originloom-public-"));
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "test.img"), "public static example\n");

    const app = createApp({
      assets,
      routes: [] as Route[],
      readinessCheck: async () => true,
      capacity: passthroughCapacity,
      publicStaticRoot: root,
    });

    const response = await app.request("http://localhost/public/test.img");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("public static example\n");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
  });
});
