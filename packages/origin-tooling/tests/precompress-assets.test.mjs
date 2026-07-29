import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

import { precompressAssets } from "../bin/precompress-assets.mjs";
import { describe, expect, it } from "vitest";

describe("asset precompression", () => {
  it("writes smaller Brotli and gzip siblings for compressible build assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "originloom-assets-"));
    const assets = join(root, "dist/client/assets");
    await mkdir(assets, { recursive: true });
    const source = "export const repeated = 'originloom';\n".repeat(500);
    const file = join(assets, "entry-hash.js");
    await writeFile(file, source);

    const result = await precompressAssets(root);

    expect(result).toEqual({ sources: 1, variants: 2 });
    expect((await stat(`${file}.br`)).size).toBeLessThan(Buffer.byteLength(source));
    expect((await stat(`${file}.gz`)).size).toBeLessThan(Buffer.byteLength(source));
    expect(brotliDecompressSync(await readFile(`${file}.br`)).toString()).toBe(source);
    expect(gunzipSync(await readFile(`${file}.gz`)).toString()).toBe(source);
  });
});
