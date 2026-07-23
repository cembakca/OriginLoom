import { normalizeCanonicalUrl, normalizeMetadataImageUrl } from "../content-url";
import type { ResolvedMetadata } from "./types";

export type JsonLdPrimitive = string | number | boolean | null;
export type JsonLdValue = JsonLdPrimitive | JsonLdObject | JsonLdValue[];
export type JsonLdObject = { [key: string]: JsonLdValue | undefined };

export type BreadcrumbJsonLdItem = { name: string; url: string };
export type ItemListJsonLdItem = { name: string; url: string; image?: string };

export function baseStructuredData(
  meta: ResolvedMetadata,
  baseUrl: string,
  indexable: boolean,
): JsonLdObject[] {
  if (!indexable) return [];
  const base = baseUrl.replace(/\/$/, "");
  const organizationId = `${base}/#organization`;
  const websiteId = `${base}/#website`;
  const nodes: JsonLdObject[] = [
    {
      "@type": "Organization",
      "@id": organizationId,
      name: meta.siteName,
      url: `${base}/`,
      logo: {
        "@type": "ImageObject",
        url: `${base}/assets/media/brand-logo-512.png`,
        width: 512,
        height: 512,
      },
    },
    {
      "@type": "WebSite",
      "@id": websiteId,
      url: `${base}/`,
      name: meta.siteName,
      inLanguage: "tr-TR",
      publisher: { "@id": organizationId },
    },
    {
      "@type": "WebPage",
      "@id": `${meta.canonical}#webpage`,
      url: meta.canonical,
      name: meta.title,
      description: meta.description,
      inLanguage: "tr-TR",
      isPartOf: { "@id": websiteId },
      about: { "@id": organizationId },
      primaryImageOfPage: meta.openGraph.image
        ? {
            "@type": "ImageObject",
            url: meta.openGraph.image,
            contentUrl: meta.openGraph.image,
            caption: meta.openGraph.imageAlt ?? meta.openGraph.title,
            ...(meta.openGraph.imageWidth ? { width: meta.openGraph.imageWidth } : {}),
            ...(meta.openGraph.imageHeight ? { height: meta.openGraph.imageHeight } : {}),
          }
        : undefined,
    },
  ];

  return nodes;
}

export function breadcrumbJsonLd(
  items: BreadcrumbJsonLdItem[],
  baseUrl: string,
): JsonLdObject | null {
  const normalized = items
    .map((item) => ({ name: item.name.trim(), url: normalizeCanonicalUrl(item.url, baseUrl) }))
    .filter((item): item is { name: string; url: string } => Boolean(item.name && item.url));
  if (normalized.length < 2) return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: normalized.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function itemListJsonLd(
  name: string,
  items: ItemListJsonLdItem[],
  baseUrl: string,
): JsonLdObject | null {
  const normalized = items
    .map((item) => ({
      name: item.name.trim(),
      url: normalizeCanonicalUrl(item.url, baseUrl),
      image: item.image ? normalizeMetadataImageUrl(item.image, baseUrl) : undefined,
    }))
    .filter((item): item is { name: string; url: string; image: string | undefined } =>
      Boolean(item.name && item.url),
    );
  if (normalized.length === 0) return null;
  return {
    "@type": "ItemList",
    name,
    numberOfItems: normalized.length,
    itemListElement: normalized.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: item.url,
      name: item.name,
      image: item.image,
    })),
  };
}

export function compactJsonLd(nodes: Array<JsonLdObject | null | undefined>): JsonLdObject[] {
  return nodes.filter((node): node is JsonLdObject => Boolean(node));
}
