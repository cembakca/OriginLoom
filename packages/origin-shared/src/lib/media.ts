export type ImageFormat = "avif" | "webp" | "jpeg";

export type ImageCandidate = {
  src: string;
  width: number;
};

export type ResponsiveImageSource = {
  type: `image/${ImageFormat}`;
  src: string;
  srcSet: string;
};

export type ResponsiveImageData = {
  width: number;
  height: number;
  src: string;
  srcSet: string;
  sources: ResponsiveImageSource[];
};

export type UnoptimizedImageData = {
  width: number;
  height: number;
  src: string;
};

export type ImagePreload = {
  href: string;
  imageSrcSet: string;
  imageSizes: string;
  type: `image/${ImageFormat}`;
};

export function buildImageCdnUrl({
  endpoint,
  src,
  width,
  quality = 78,
  format,
}: {
  endpoint: string;
  src: string;
  width: number;
  quality?: number;
  format: ImageFormat;
}): string {
  assertPositiveInteger("width", width);
  assertPositiveInteger("quality", quality);
  if (quality > 100) throw new RangeError(`quality must not exceed 100: ${quality}`);

  const url = new URL(endpoint);
  url.searchParams.set("url", src);
  url.searchParams.set("w", String(width));
  url.searchParams.set("q", String(quality));
  url.searchParams.set("format", format === "jpeg" ? "jpg" : format);
  return url.toString();
}

export function createCdnImage({
  endpoint,
  src,
  width,
  height,
  widths,
  quality = 78,
}: {
  endpoint: string;
  src: string;
  width: number;
  height: number;
  widths: number[];
  quality?: number;
}): ResponsiveImageData {
  assertPositiveInteger("width", width);
  assertPositiveInteger("height", height);
  const candidates = normalizeWidths(widths, width);
  const variants = (format: ImageFormat) =>
    candidates.map((candidateWidth) => ({
      width: candidateWidth,
      src: buildImageCdnUrl({ endpoint, src, width: candidateWidth, quality, format }),
    }));
  const jpeg = variants("jpeg");
  const avif = variants("avif");
  const webp = variants("webp");

  return {
    width,
    height,
    src: jpeg.at(-1)!.src,
    srcSet: serializeSrcSet(jpeg),
    sources: [
      { type: "image/avif", src: avif.at(-1)!.src, srcSet: serializeSrcSet(avif) },
      { type: "image/webp", src: webp.at(-1)!.src, srcSet: serializeSrcSet(webp) },
    ],
  };
}

/**
 * Keeps the source byte-for-byte untransformed. Relative paths can still be
 * published below an image CDN prefix such as https://cdn.example.com/media.
 */
export function createUnoptimizedImage({
  src,
  width,
  height,
  cdnPrefix,
}: {
  src: string;
  width: number;
  height: number;
  cdnPrefix?: string;
}): UnoptimizedImageData {
  assertPositiveInteger("width", width);
  assertPositiveInteger("height", height);
  return { src: prefixMediaUrl(src, cdnPrefix), width, height };
}

export function prefixMediaUrl(src: string, cdnPrefix?: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  const normalized = src.startsWith("/") ? src : `/${src}`;
  if (!cdnPrefix) return normalized;
  return `${cdnPrefix.replace(/\/$/, "")}${normalized}`;
}

export function imagePreload(image: ResponsiveImageData, imageSizes: string): ImagePreload {
  const preferred = image.sources[0];
  return {
    href: preferred?.src ?? image.src,
    imageSrcSet: preferred?.srcSet ?? image.srcSet,
    imageSizes,
    type: preferred?.type ?? "image/jpeg",
  };
}

export function serializeSrcSet(candidates: ImageCandidate[]): string {
  return candidates.map(({ src, width }) => `${src} ${width}w`).join(", ");
}

function normalizeWidths(widths: number[], intrinsicWidth: number): number[] {
  const normalized = [...new Set(widths)].sort((a, b) => a - b);
  if (
    normalized.length === 0 ||
    normalized.some((width) => !Number.isInteger(width) || width <= 0 || width > intrinsicWidth)
  ) {
    throw new RangeError("widths must contain positive integers up to intrinsic width");
  }
  return normalized;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new RangeError(`${name} must be positive: ${value}`);
}
