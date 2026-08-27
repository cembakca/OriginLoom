import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { FontAsset } from "@originloom/shared/assets";
import {
  createCdnImage,
  type ImageCandidate,
  type ImageFormat,
  type ResponsiveImageData,
  serializeSrcSet,
  type UnoptimizedImageData,
} from "@originloom/shared/lib/media";

import { clientAssetUrl } from "./asset-url.js";
import { config } from "./config.js";

function mediaManifestPath(): string {
  return join(config.clientDistDir, "asset-pipeline.json");
}

export type { FontAsset };

type ImageManifestEntry = {
  source: string;
  width: number;
  height: number;
  widths: number[];
  quality: number;
  variants: Record<ImageFormat, ImageCandidate[]>;
};

/** One of the four fixed-purpose SEO images, content-hashed by the media build. */
export type SeoAsset = {
  src: string;
  width: number;
  height: number;
};

export type SeoAssets = {
  openGraph: SeoAsset;
  brandLogo: SeoAsset;
  appleTouchIcon: SeoAsset;
  favicon: SeoAsset;
};

type MediaManifest = {
  version: 1;
  images: Record<string, ImageManifestEntry>;
  fonts: FontAsset[];
  seo: SeoAssets;
};

let cachedManifest: MediaManifest | undefined;

export function readFontAssets(): FontAsset[] {
  // Apps without a media pipeline ship no self-hosted fonts.
  const manifest = tryReadMediaManifest();
  return (manifest?.fonts ?? []).map((font) => ({ ...font, href: fontAssetUrl(font.href) }));
}

/**
 * The favicon, apple-touch icon, OG image and organization logo.
 *
 * Read from the manifest rather than written out as paths: these files are
 * content-hashed, so a literal would be wrong the first time the source image
 * changed — and they live under the immutable client-asset namespace, where a
 * stale URL is stale for a year.
 */
export function seoAssets(): SeoAssets {
  const manifest = readMediaManifest();
  return {
    openGraph: seoAsset(manifest.seo.openGraph),
    brandLogo: seoAsset(manifest.seo.brandLogo),
    appleTouchIcon: seoAsset(manifest.seo.appleTouchIcon),
    favicon: seoAsset(manifest.seo.favicon),
  };
}

function seoAsset(asset: SeoAsset): SeoAsset {
  return { ...asset, src: imageAssetUrl(asset.src) };
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

function tryReadMediaManifest(): MediaManifest | null {
  if (cachedManifest) return cachedManifest;
  if (!existsSync(mediaManifestPath())) return null;
  return readMediaManifest();
}

function readMediaManifest(): MediaManifest {
  if (cachedManifest) return cachedManifest;
  const manifestPath = mediaManifestPath();
  if (!existsSync(manifestPath)) {
    throw new Error(`Media manifest not found at ${manifestPath}: run \`pnpm media\` first`);
  }

  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isMediaManifest(parsed)) throw new Error(`Invalid media manifest: ${mediaManifestPath()}`);
  cachedManifest = parsed;
  return parsed;
}

function fontAssetUrl(path: string): string {
  return clientAssetUrl(path);
}

function imageAssetUrl(path: string): string {
  const localOrAssetCdn = clientAssetUrl(path);
  if (!config.imageCdnUrl) return localOrAssetCdn;
  const namespacedPath = new URL(localOrAssetCdn, config.siteUrl).pathname;
  return `${config.imageCdnUrl.replace(/\/$/, "")}${namespacedPath}`;
}

function absoluteAssetUrl(path: string): string {
  return new URL(path, config.siteUrl).toString();
}

function isMediaManifest(value: unknown): value is MediaManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Record<string, unknown>;
  return (
    manifest.version === 1 &&
    isSeoAssets(manifest.seo) &&
    Array.isArray(manifest.fonts) &&
    manifest.fonts.every(isFontAsset) &&
    Boolean(manifest.images) &&
    typeof manifest.images === "object" &&
    Object.values(manifest.images as Record<string, unknown>).every(isImageEntry)
  );
}

function isSeoAssets(value: unknown): value is SeoAssets {
  if (!value || typeof value !== "object") return false;
  const seo = value as Record<string, unknown>;
  return ["openGraph", "brandLogo", "appleTouchIcon", "favicon"].every((key) => {
    const asset = seo[key];
    if (!asset || typeof asset !== "object") return false;
    const entry = asset as Record<string, unknown>;
    return (
      typeof entry.src === "string" &&
      typeof entry.width === "number" &&
      typeof entry.height === "number"
    );
  });
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
