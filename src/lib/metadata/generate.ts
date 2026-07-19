import { normalizeCanonicalUrl, normalizeMetadataImageUrl } from "~/lib/content-url";
import { stripUndefined } from "~/lib/strip-undefined";
import type { Ctx } from "~/lib/types";

import type { PageMetadata, SeoInfo } from "./types";

/** Public absolute URL from browser-visible path. */
export function publicAbsoluteUrl(ctx: Ctx, path?: string): string {
  const base = (ctx.siteUrl ?? ctx.url.origin).replace(/\/$/, "");
  const p = path ?? ctx.publicPath;
  return normalizeCanonicalUrl(p.startsWith("/") ? p : `/${p}`, base) ?? `${base}/`;
}

const dummySeoByPath: Record<string, Partial<SeoInfo>> = {
  "/": {
    title: "Hangikredi",
    metaDescription: "Kredi ve bankacılık ürünlerini karşılaştır.",
  },
  "/hesabim": {
    title: "Hesabım",
    noindex: true,
  },
  "/remote-customer-obtain": {
    title: "Uzaktan Müşteri Edinimi",
  },
  "/medya-pipeline": {
    title: "Image ve Font Pipeline",
    metaDescription: "Responsive, unoptimized CDN image ve self-host font pipeline demosu.",
  },
};

/** CMS seoInfo → route PageMetadata. */
export function generateMetaDataForPageWithSeoInfo(seoInfo: SeoInfo, ctx: Ctx): PageMetadata {
  const base = ctx.siteUrl ?? ctx.url.origin;
  const canonical =
    (seoInfo.canonicalUrl ? normalizeCanonicalUrl(seoInfo.canonicalUrl, base) : null) ??
    publicAbsoluteUrl(ctx, seoInfo.friendlyUrl);
  const title = seoInfo.title ?? seoInfo.badge;
  const description = seoInfo.metaDescription ?? seoInfo.heroDescription;
  const image = seoInfo.image
    ? (normalizeMetadataImageUrl(seoInfo.image, base) ?? undefined)
    : undefined;

  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    canonical,
    ...(seoInfo.noindex || seoInfo.nofollow
      ? {
          robots: {
            ...(seoInfo.noindex ? { index: false } : {}),
            ...(seoInfo.nofollow ? { follow: false } : { follow: true }),
          } as const,
        }
      : {}),
    openGraph: stripUndefined({
      title: title ?? undefined,
      description,
      url: canonical,
      image,
      imageAlt: seoInfo.imageAlt,
      imageType: image ? imageMimeType(image) : undefined,
      imageWidth: seoInfo.imageWidth,
      imageHeight: seoInfo.imageHeight,
      type: seoInfo.openGraphType,
      publishedTime: seoInfo.publishedTime,
      modifiedTime: seoInfo.modifiedTime,
      authors: seoInfo.author ? [seoInfo.author] : undefined,
      section: seoInfo.section,
      tags: seoInfo.tags,
    }),
    twitter: stripUndefined({
      title: title ?? undefined,
      description,
      image,
      imageAlt: seoInfo.imageAlt,
    }),
  };
}

function imageMimeType(image: string): string | undefined {
  const pathname = new URL(image).pathname.toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".avif")) return "image/avif";
  return undefined;
}

/** CMS SEO + normalized pagination identity. Faceted noindex pages stay canonical to the base URL. */
export function generatePaginatedMetadata(
  seoInfo: SeoInfo,
  ctx: Ctx,
  page: number,
  totalPages: number,
  basePath: string,
): PageMetadata {
  const metadata = generateMetaDataForPageWithSeoInfo(seoInfo, ctx);
  if (seoInfo.noindex) return metadata;
  const pageUrl = (value: number) =>
    publicAbsoluteUrl(ctx, value <= 1 ? basePath : `${basePath}?page=${value}`);
  const canonical = pageUrl(page);
  return {
    ...metadata,
    ...(page > 1
      ? { title: metadata.title ? `${metadata.title} — Sayfa ${page}` : `Sayfa ${page}` }
      : {}),
    canonical,
    openGraph: { ...metadata.openGraph, url: canonical },
    pagination: stripUndefined({
      previous: page > 1 ? pageUrl(page - 1) : undefined,
      next: page < totalPages ? pageUrl(page + 1) : undefined,
    }),
  };
}

/** API seoInfo yoksa zayıf fallback — path tabanlı. */
export function generateMetaDataForPageWithDummySeoInfo(path: string, ctx: Ctx): PageMetadata {
  const key = Object.keys(dummySeoByPath).find((p) => path === p || ctx.publicPath === p) ?? path;
  const dummy = dummySeoByPath[key] ?? dummySeoByPath[ctx.publicPath] ?? { title: path };

  return generateMetaDataForPageWithSeoInfo(
    {
      ...dummy,
      friendlyUrl: ctx.publicPath,
      canonicalUrl: publicAbsoluteUrl(ctx),
    },
    ctx,
  );
}

/** Route title helper → minimal metadata. */
export function metadataFromTitle(title: string, ctx: Ctx): PageMetadata {
  return {
    title,
    canonical: publicAbsoluteUrl(ctx),
    openGraph: { url: publicAbsoluteUrl(ctx), title },
    twitter: { title },
  };
}
