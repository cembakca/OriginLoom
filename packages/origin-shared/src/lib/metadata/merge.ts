import { normalizeCanonicalUrl, normalizeMetadataImageUrl } from "../content-url.js";
import { stripUndefined } from "../strip-undefined.js";
import type { Ctx } from "../types.js";
import { baseStructuredData } from "./jsonld.js";
import { siteMetadataConfig } from "./site-config.js";
import type { PageMetadata, ResolvedMetadata, SiteMetadataConfig } from "./types.js";

function formatTitle(pageTitle: string | undefined, site: SiteMetadataConfig): string {
  if (!pageTitle || pageTitle === site.title.default) return site.title.default;
  return site.title.template.replace("%s", pageTitle);
}

function robotsTag(robots: NonNullable<PageMetadata["robots"]>, site: SiteMetadataConfig): string {
  const index = robots.index ?? site.robots.index;
  const follow = robots.follow ?? site.robots.follow;
  const directives = [index ? "index" : "noindex", follow ? "follow" : "nofollow"];
  if (robots.noarchive) directives.push("noarchive");
  if (robots.nosnippet) directives.push("nosnippet");
  if (robots.noimageindex) directives.push("noimageindex");
  if (robots.notranslate) directives.push("notranslate");
  if (index && !robots.nosnippet) {
    directives.push(`max-snippet:${robots.maxSnippet ?? -1}`);
    directives.push(`max-image-preview:${robots.maxImagePreview ?? "large"}`);
    directives.push(`max-video-preview:${robots.maxVideoPreview ?? -1}`);
  }
  return directives.join(", ");
}

/** Layout metadata ⊎ page metadata → final head values. Page alanları layout'u ezer. */
export function mergeMetadata(page: PageMetadata | undefined, ctx: Ctx): ResolvedMetadata {
  const pageMeta = page ?? {};
  const base = ctx.siteUrl ?? ctx.url.origin;
  const site = siteMetadataConfig(base);
  const title = formatTitle(pageMeta.title, site);
  const description = pageMeta.description ?? site.description;
  const canonical = resolveCanonical(pageMeta, ctx, base);
  const openGraph = resolveOpenGraph(pageMeta, site, base, canonical, description);
  const resolved: ResolvedMetadata = {
    applicationName: site.applicationName,
    siteName: site.openGraph.siteName,
    title,
    description,
    canonical,
    robots: robotsTag(pageMeta.robots ?? {}, site),
    openGraph,
    twitter: resolveTwitter(pageMeta, site, base, openGraph),
    icons: stripUndefined({
      icon: pageMeta.icons?.icon ?? site.icons.icon,
      apple: pageMeta.icons?.apple ?? site.icons.apple,
    }),
    verification: pageMeta.verification ?? {},
    pagination: resolvePagination(pageMeta, base),
    formatDetection: { telephone: site.formatDetection?.telephone ?? true },
    structuredData: [],
  };
  const indexable = pageMeta.robots?.index ?? site.robots.index;
  resolved.structuredData = [
    ...baseStructuredData(resolved, base, indexable),
    ...(indexable ? (pageMeta.structuredData ?? []) : []),
  ];
  return resolved;
}

function resolvePagination(page: PageMetadata, base: string): ResolvedMetadata["pagination"] {
  return stripUndefined({
    previous: page.pagination?.previous
      ? (normalizeCanonicalUrl(page.pagination.previous, base) ?? undefined)
      : undefined,
    next: page.pagination?.next
      ? (normalizeCanonicalUrl(page.pagination.next, base) ?? undefined)
      : undefined,
  });
}

function resolveCanonical(page: PageMetadata, ctx: Ctx, base: string): string {
  return (
    (page.canonical ? normalizeCanonicalUrl(page.canonical, base) : null) ??
    normalizeCanonicalUrl(ctx.publicPath, base) ??
    `${base.replace(/\/$/, "")}/`
  );
}

function resolveOpenGraph(
  page: PageMetadata,
  site: SiteMetadataConfig,
  base: string,
  canonical: string,
  description: string,
): ResolvedMetadata["openGraph"] {
  const source = page.openGraph ?? {};
  const title = source.title ?? page.title ?? site.title.default;
  const image = source.image
    ? (normalizeMetadataImageUrl(source.image, base) ?? site.openGraph.defaultImage)
    : site.openGraph.defaultImage;
  return {
    title,
    description: source.description ?? description,
    url: source.url ? (normalizeCanonicalUrl(source.url, base) ?? canonical) : canonical,
    image,
    imageAlt: source.imageAlt ?? title,
    siteName: source.siteName ?? site.openGraph.siteName,
    type: source.type ?? site.openGraph.type,
    locale: source.locale ?? site.openGraph.locale,
    ...stripUndefined({
      imageType: source.imageType,
      imageWidth: source.imageWidth,
      imageHeight: source.imageHeight,
      publishedTime: source.publishedTime,
      modifiedTime: source.modifiedTime,
      authors: source.authors,
      section: source.section,
      tags: source.tags,
    }),
  };
}

function resolveTwitter(
  page: PageMetadata,
  site: SiteMetadataConfig,
  base: string,
  openGraph: ResolvedMetadata["openGraph"],
): ResolvedMetadata["twitter"] {
  const source = page.twitter ?? {};
  const image = source.image
    ? (normalizeMetadataImageUrl(source.image, base) ?? openGraph.image)
    : openGraph.image;
  return {
    card: source.card ?? site.twitter.card,
    title: source.title ?? openGraph.title,
    description: source.description ?? openGraph.description,
    ...stripUndefined({
      image,
      imageAlt: source.imageAlt ?? page.openGraph?.imageAlt ?? openGraph.title,
      site: source.site ?? site.twitter.site,
      creator: source.creator,
    }),
  };
}
