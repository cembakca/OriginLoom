import { createReadStream } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createBrotliCompress, createGzip, constants } from "node:zlib";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const COMPRESSIBLE = /\.(?:css|html|js|json|map|svg|txt|xml)$/i;
const MIN_BYTES = 1_024;

export async function precompressAssets(root = process.cwd()) {
  const assetsRoot = resolve(root, "dist/client/assets");
  const files = await walk(assetsRoot).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  let sources = 0;
  let variants = 0;

  for (const file of files) {
    if (!COMPRESSIBLE.test(file) || file.endsWith(".br") || file.endsWith(".gz")) continue;
    const source = await stat(file);
    if (source.size < MIN_BYTES) continue;
    sources++;
    variants += await writeSmallerVariant(file, source.size, ".br", () =>
      createBrotliCompress({
        params: { [constants.BROTLI_PARAM_QUALITY]: 9 },
      }),
    );
    variants += await writeSmallerVariant(file, source.size, ".gz", () => createGzip({ level: 9 }));
  }

  console.log(`[assets] ${sources} source(s) → ${variants} precompressed variant(s)`);
  return { sources, variants };
}

async function writeSmallerVariant(file, sourceBytes, suffix, createTransform) {
  const target = `${file}${suffix}`;
  await pipeline(createReadStream(file), createTransform(), createWriteStream(target));
  const output = await stat(target);
  if (output.size < sourceBytes) return 1;
  await unlink(target);
  return 0;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await precompressAssets(resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd()));
}
