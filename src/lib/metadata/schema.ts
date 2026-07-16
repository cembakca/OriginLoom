import {
  normalizeCanonicalUrl,
  normalizeMetadataImageUrl,
  normalizeNavigationUrl,
} from "~/lib/content-url";

import type { SeoInfo } from "./types";

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_BADGE_LENGTH = 120;

/** Runtime parser for the CMS SEO contract. Unknown fields are discarded. */
export function parseSeoInfo(value: unknown, siteUrl: string): SeoInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const seo = value as Record<string, unknown>;
  if (
    !optionalString(seo.title, MAX_TITLE_LENGTH) ||
    !optionalString(seo.headingTitle, MAX_TITLE_LENGTH) ||
    !optionalString(seo.metaDescription, MAX_DESCRIPTION_LENGTH) ||
    !optionalString(seo.heroDescription, MAX_DESCRIPTION_LENGTH) ||
    !optionalString(seo.badge, MAX_BADGE_LENGTH) ||
    (seo.noindex !== undefined && typeof seo.noindex !== "boolean")
  ) {
    return null;
  }

  const canonicalUrl = optionalCanonical(seo.canonicalUrl, siteUrl);
  const friendlyUrl = optionalFriendlyUrl(seo.friendlyUrl, siteUrl);
  const image = optionalImage(seo.image, siteUrl);
  if (canonicalUrl === null || friendlyUrl === null || image === null) return null;

  return {
    ...(seo.title !== undefined ? { title: seo.title as string } : {}),
    ...(seo.metaDescription !== undefined
      ? { metaDescription: seo.metaDescription as string }
      : {}),
    ...(canonicalUrl !== undefined ? { canonicalUrl } : {}),
    ...(seo.headingTitle !== undefined ? { headingTitle: seo.headingTitle as string } : {}),
    ...(seo.heroDescription !== undefined
      ? { heroDescription: seo.heroDescription as string }
      : {}),
    ...(image !== undefined ? { image } : {}),
    ...(seo.noindex !== undefined ? { noindex: seo.noindex } : {}),
    ...(seo.badge !== undefined ? { badge: seo.badge as string } : {}),
    ...(friendlyUrl !== undefined ? { friendlyUrl } : {}),
  };
}

function optionalString(value: unknown, max: number): boolean {
  return (
    value === undefined || (typeof value === "string" && value.length > 0 && value.length <= max)
  );
}

function optionalCanonical(value: unknown, siteUrl: string): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return normalizeCanonicalUrl(value, siteUrl);
}

function optionalImage(value: unknown, siteUrl: string): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return normalizeMetadataImageUrl(value, siteUrl);
}

function optionalFriendlyUrl(value: unknown, siteUrl: string): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return normalizeNavigationUrl(value, { siteUrl });
}
