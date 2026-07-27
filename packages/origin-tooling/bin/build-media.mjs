import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import sharp from "sharp";

const root = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const config = JSON.parse(await readFile(resolve(root, "server/media.config.json"), "utf8"));
const outputDir = resolve(root, "dist/client/assets/media");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const manifest = { version: 1, images: {}, fonts: [] };

await buildSeoAssets(config.seoAssets);

for (const image of config.images) {
  validateImageConfig(image);
  const source = resolve(root, image.source);
  const sourceBuffer = await readFile(source);
  const metadata = await sharp(source).metadata();
  if (metadata.width !== image.width || metadata.height !== image.height) {
    throw new Error(
      `${image.id}: configured ${image.width}x${image.height}, source is ${metadata.width}x${metadata.height}`,
    );
  }

  const variants = {};
  for (const format of ["avif", "webp", "jpeg"]) {
    variants[format] = [];
    for (const width of image.widths) {
      const buffer = await encodeImage(source, width, format, image.quality);
      const filename = `${image.id}-${width}.${hash(buffer)}.${format === "jpeg" ? "jpg" : format}`;
      await writeFile(resolve(outputDir, filename), buffer);
      variants[format].push({ width, src: `/assets/media/${filename}` });
    }
  }

  const sourceExtension = extname(source).toLowerCase();
  const sourceFilename = `${image.id}-source.${hash(sourceBuffer)}${sourceExtension}`;
  await writeFile(resolve(outputDir, sourceFilename), sourceBuffer);

  manifest.images[image.id] = {
    source: `/assets/media/${sourceFilename}`,
    width: image.width,
    height: image.height,
    widths: image.widths,
    quality: image.quality,
    variants,
  };
}

for (const font of config.fonts) {
  validateFontConfig(font);
  const source = resolve(root, font.source);
  const buffer = await readFile(source);
  const extension = extname(source);
  const filename = `${font.id}.${hash(buffer)}${extension}`;
  await cp(source, resolve(outputDir, filename));
  manifest.fonts.push({
    family: font.family,
    style: font.style,
    weight: font.weight,
    display: font.display,
    unicodeRange: font.unicodeRange,
    preload: font.preload,
    href: `/assets/media/${filename}`,
  });
}

// A font's licence ships next to it, and which font is used is the app's choice —
// so the path comes from the config rather than from this file.
const copiedLicenses = new Set();
for (const font of config.fonts ?? []) {
  if (!font.license || copiedLicenses.has(font.license)) continue;
  copiedLicenses.add(font.license);
  const target = font.licenseFilename ?? `${basename(font.license)}.txt`;
  await cp(resolve(root, font.license), resolve(outputDir, target));
}
await writeFile(
  resolve(root, "dist/client/asset-pipeline.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(
  `[media] ${Object.keys(manifest.images).length} image source(s), ${manifest.fonts.length} font subset(s)`,
);

async function buildSeoAssets(seoAssets) {
  if (!seoAssets?.openGraphSource || !seoAssets?.brandSource) {
    throw new Error("seoAssets requires openGraphSource and brandSource");
  }
  const openGraphSource = resolve(root, seoAssets.openGraphSource);
  const brandSource = resolve(root, seoAssets.brandSource);
  await Promise.all([
    sharp(openGraphSource)
      .resize(1200, 630, { fit: "cover" })
      .jpeg({ quality: 84, mozjpeg: true })
      .toFile(resolve(outputDir, "og-default.jpg")),
    sharp(brandSource).resize(512, 512).png().toFile(resolve(outputDir, "brand-logo-512.png")),
    sharp(brandSource).resize(180, 180).png().toFile(resolve(outputDir, "apple-touch-icon.png")),
    sharp(brandSource).resize(32, 32).png().toFile(resolve(outputDir, "favicon-32.png")),
  ]);
}

async function encodeImage(source, width, format, quality) {
  const pipeline = sharp(source).resize({ width, withoutEnlargement: true });
  if (format === "avif") return pipeline.avif({ quality, effort: 4 }).toBuffer();
  if (format === "webp") return pipeline.webp({ quality, effort: 4 }).toBuffer();
  return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
}

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 12);
}

function validateImageConfig(image) {
  if (!image || typeof image !== "object" || !/^[a-z0-9-]+$/.test(image.id)) {
    throw new Error("Every image needs a kebab-case id");
  }
  for (const field of ["width", "height", "quality"]) {
    if (!Number.isInteger(image[field]) || image[field] <= 0) {
      throw new Error(`${image.id}: invalid ${field}`);
    }
  }
  if (image.quality > 100) throw new Error(`${image.id}: quality cannot exceed 100`);
  if (
    !Array.isArray(image.widths) ||
    image.widths.length === 0 ||
    image.widths.some((width) => !Number.isInteger(width) || width <= 0 || width > image.width)
  ) {
    throw new Error(`${image.id}: widths must be positive integers up to intrinsic width`);
  }
  if (new Set(image.widths).size !== image.widths.length) {
    throw new Error(`${image.id}: duplicate widths`);
  }
  image.widths.sort((a, b) => a - b);
}

function validateFontConfig(font) {
  if (!font || typeof font !== "object" || !font.source?.endsWith(".woff2")) {
    throw new Error("Font pipeline accepts local WOFF2 sources only");
  }
  if (!font.family || !font.weight || !font.unicodeRange) {
    throw new Error(`${font.id ?? basename(font.source)}: incomplete font descriptor`);
  }
}
