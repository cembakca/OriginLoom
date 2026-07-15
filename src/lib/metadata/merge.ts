import { env } from "~/lib/env";
import { stripUndefined } from "~/lib/strip-undefined";
import type { Ctx } from "~/lib/types";

import { siteMetadata } from "./site-defaults";
import type { PageMetadata, ResolvedMetadata, SiteMetadataConfig } from "./types";

function absUrl(url: string | undefined, base: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const b = base.replace(/\/$/, "");
  return `${b}${url.startsWith("/") ? url : `/${url}`}`;
}

function formatTitle(pageTitle: string | undefined, site: SiteMetadataConfig): string {
  if (!pageTitle || pageTitle === site.title.default) return site.title.default;
  return site.title.template.replace("%s", pageTitle);
}

function robotsTag(
  robots: { index?: boolean; follow?: boolean },
  site: SiteMetadataConfig,
): string {
  const index = robots.index ?? site.robots.index;
  const follow = robots.follow ?? site.robots.follow;
  return `${index ? "index" : "noindex"}, ${follow ? "follow" : "nofollow"}`;
}

/** Layout metadata ⊎ page metadata → final head values. Page alanları layout'u ezer. */
export function mergeMetadata(page: PageMetadata | undefined, ctx: Ctx): ResolvedMetadata {
  const site = siteMetadata;
  const base = env.siteUrl;

  const title = formatTitle(page?.title, site);
  const description = page?.description ?? site.description;
  const canonical = absUrl(page?.canonical, base) ?? absUrl(ctx.publicPath, base)!;

  const ogTitle = page?.openGraph?.title ?? page?.title ?? site.title.default;
  const ogDescription = page?.openGraph?.description ?? description;
  const ogImage = absUrl(page?.openGraph?.image, base) ?? site.openGraph.defaultImage;
  const ogUrl = absUrl(page?.openGraph?.url, base) ?? canonical;

  const twitterTitle = page?.twitter?.title ?? ogTitle;
  const twitterDescription = page?.twitter?.description ?? ogDescription;
  const twitterImage = absUrl(page?.twitter?.image, base) ?? ogImage;

  return {
    title,
    description,
    canonical,
    robots: robotsTag(page?.robots ?? {}, site),
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: ogUrl,
      image: ogImage,
      siteName: page?.openGraph?.siteName ?? site.openGraph.siteName,
      type: page?.openGraph?.type ?? site.openGraph.type,
      locale: page?.openGraph?.locale ?? site.openGraph.locale,
    },
    twitter: {
      card: page?.twitter?.card ?? site.twitter.card,
      title: twitterTitle,
      description: twitterDescription,
      image: twitterImage,
    },
    icons: stripUndefined({
      icon: page?.icons?.icon ?? site.icons.icon,
      apple: page?.icons?.apple ?? site.icons.apple,
    }),
  };
}
