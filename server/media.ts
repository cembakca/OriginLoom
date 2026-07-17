import { existsSync, readFileSync } from "node:fs";

import { config } from "@server/config";

import {
  createCdnImage,
  type ImageCandidate,
  type ImageFormat,
  type ResponsiveImageData,
  serializeSrcSet,
  type UnoptimizedImageData,
} from "~/lib/media";

const MANIFEST_PATH = "dist/client/asset-pipeline.json";

export type FontAsset = {
  family: string;
  style: string;
  weight: string;
  display: "swap" | "optional" | "fallback";
  unicodeRange: string;
  preload: boolean;
  href: string;
};

type ImageManifestEntry = {
  source: string;
  width: number;
  height: number;
  widths: number[];
  quality: number;
  variants: Record<ImageFormat, ImageCandidate[]>;
};

type MediaManifest = {
  version: 1;
  images: Record<string, ImageManifestEntry>;
  fonts: FontAsset[];
};

let cachedManifest: MediaManifest | undefined;

export function readFontAssets(): FontAsset[] {
  return readMediaManifest().fonts.map((font) => ({ ...font, href: fontAssetUrl(font.href) }));
}

export function imageCdnOrigins(): string[] {
  return [config.imageCdnUrl, config.imageTransformUrl]
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value).origin);
}

export function responsiveImage(id: string): ResponsiveImageData {
  const image = readMediaManifest().images[id];
  if (!image) throw new Error(`Responsive image not found in media manifest: ${id}`);

  const local = localResponsiveImage(image);
  if (!config.imageTransformUrl) return local;

  return createCdnImage({
    endpoint: config.imageTransformUrl,
    src: absoluteAssetUrl(imageAssetUrl(image.source)),
    width: image.width,
    height: image.height,
    widths: image.widths,
    quality: image.quality,
  });
}

/** Original source through the image CDN prefix, without srcset or transformation. */
export function unoptimizedImage(id: string): UnoptimizedImageData {
  const image = readMediaManifest().images[id];
  if (!image) throw new Error(`Unoptimized image not found in media manifest: ${id}`);
  return { src: imageAssetUrl(image.source), width: image.width, height: image.height };
}

function localResponsiveImage(image: ImageManifestEntry): ResponsiveImageData {
  const variants = (format: ImageFormat) =>
    image.variants[format].map((candidate) => ({
      ...candidate,
      src: imageAssetUrl(candidate.src),
    }));
  const jpeg = variants("jpeg");
  const avif = variants("avif");
  const webp = variants("webp");
  return {
    width: image.width,
    height: image.height,
    src: jpeg.at(-1)!.src,
    srcSet: serializeSrcSet(jpeg),
    sources: [
      { type: "image/avif", src: avif.at(-1)!.src, srcSet: serializeSrcSet(avif) },
      { type: "image/webp", src: webp.at(-1)!.src, srcSet: serializeSrcSet(webp) },
    ],
  };
}

function readMediaManifest(): MediaManifest {
  if (cachedManifest) return cachedManifest;
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Media manifest not found: run npm run media before starting the server`);
  }

  const parsed: unknown = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (!isMediaManifest(parsed)) throw new Error("Invalid dist/client/asset-pipeline.json");
  cachedManifest = parsed;
  return parsed;
}

function fontAssetUrl(path: string): string {
  const base = config.assetCdnUrl?.replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}

function imageAssetUrl(path: string): string {
  const base = (config.imageCdnUrl ?? config.assetCdnUrl)?.replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}

function absoluteAssetUrl(path: string): string {
  return new URL(path, config.siteUrl).toString();
}

function isMediaManifest(value: unknown): value is MediaManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Record<string, unknown>;
  return (
    manifest.version === 1 &&
    Array.isArray(manifest.fonts) &&
    manifest.fonts.every(isFontAsset) &&
    Boolean(manifest.images) &&
    typeof manifest.images === "object" &&
    Object.values(manifest.images as Record<string, unknown>).every(isImageEntry)
  );
}

function isFontAsset(value: unknown): value is FontAsset {
  if (!value || typeof value !== "object") return false;
  const font = value as Record<string, unknown>;
  return (
    typeof font.family === "string" &&
    typeof font.style === "string" &&
    typeof font.weight === "string" &&
    ["swap", "optional", "fallback"].includes(String(font.display)) &&
    typeof font.unicodeRange === "string" &&
    typeof font.preload === "boolean" &&
    typeof font.href === "string"
  );
}

function isImageEntry(value: unknown): value is ImageManifestEntry {
  if (!value || typeof value !== "object") return false;
  const image = value as Record<string, unknown>;
  const variants = image.variants as Record<string, unknown> | undefined;
  return (
    typeof image.source === "string" &&
    isPositiveInteger(image.width) &&
    isPositiveInteger(image.height) &&
    isPositiveInteger(image.quality) &&
    Array.isArray(image.widths) &&
    image.widths.every(isPositiveInteger) &&
    Boolean(variants) &&
    ["avif", "webp", "jpeg"].every((format) =>
      Array.isArray(variants?.[format])
        ? variants[format].every((candidate) => {
            if (!candidate || typeof candidate !== "object") return false;
            const item = candidate as Record<string, unknown>;
            return isPositiveInteger(item.width) && typeof item.src === "string";
          })
        : false,
    )
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
