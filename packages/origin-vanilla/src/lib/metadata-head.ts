import { escapeHtml } from "@originloom/shared/html";
import { serializeEmbeddedJson } from "@originloom/shared/lib/embedded-json";
import type { ResolvedMetadata } from "@originloom/shared/lib/metadata/types";

import { type HtmlNode, joinHtml, raw } from "../html.js";
import { tag as element } from "../tag.js";

/**
 * Metadata API output → head tags. GTM/analytics scripts do not belong here.
 * Tags are joined without separators so the head carries no filler whitespace.
 */
export function metadataHead(meta: ResolvedMetadata, nonce?: string): HtmlNode {
  return joinHtml([
    element("title", {}, raw(escapeHtml(meta.title))),
    tag("meta", { name: "application-name", content: meta.applicationName }),
    tag("meta", { name: "description", content: meta.description }),
    tag("meta", { name: "robots", content: meta.robots }),
    tag("meta", {
      name: "format-detection",
      content: `telephone=${meta.formatDetection.telephone ? "yes" : "no"}`,
    }),
    tag("link", { rel: "canonical", href: meta.canonical }),
    tag("link", { rel: "prev", href: meta.pagination.previous }),
    tag("link", { rel: "next", href: meta.pagination.next }),
    openGraphHead(meta),
    twitterHead(meta),
    verificationHead(meta),
    structuredDataHead(meta, nonce),
    tag("link", { rel: "icon", href: meta.icons.icon }),
    tag("link", { rel: "apple-touch-icon", href: meta.icons.apple }),
  ]);
}

function openGraphHead(meta: ResolvedMetadata): HtmlNode {
  const og = meta.openGraph;
  return joinHtml([
    property("og:title", og.title),
    property("og:description", og.description),
    property("og:url", og.url),
    property("og:site_name", og.siteName),
    property("og:type", og.type),
    property("og:locale", og.locale),
    property("og:image", og.image),
    property("og:image:secure_url", og.image),
    property("og:image:alt", og.imageAlt),
    property("og:image:type", og.imageType),
    property("og:image:width", og.imageWidth),
    property("og:image:height", og.imageHeight),
    property("article:published_time", og.publishedTime),
    property("article:modified_time", og.modifiedTime),
    (og.authors ?? []).map((author) => property("article:author", author)),
    property("article:section", og.section),
    (og.tags ?? []).map((tagName) => property("article:tag", tagName)),
  ]);
}

function twitterHead(meta: ResolvedMetadata): HtmlNode {
  const twitter = meta.twitter;
  return joinHtml([
    tag("meta", { name: "twitter:card", content: twitter.card }),
    tag("meta", { name: "twitter:title", content: twitter.title }),
    tag("meta", { name: "twitter:description", content: twitter.description }),
    tag("meta", { name: "twitter:image", content: twitter.image }),
    tag("meta", { name: "twitter:image:alt", content: twitter.imageAlt }),
    tag("meta", { name: "twitter:site", content: twitter.site }),
    tag("meta", { name: "twitter:creator", content: twitter.creator }),
  ]);
}

function verificationHead(meta: ResolvedMetadata): HtmlNode {
  return joinHtml(
    Object.entries(meta.verification).map(([provider, value]) =>
      tag("meta", { name: provider, content: value }),
    ),
  );
}

function structuredDataHead(meta: ResolvedMetadata, nonce?: string): HtmlNode | null {
  if (meta.structuredData.length === 0) return null;
  const json = serializeEmbeddedJson({
    "@context": "https://schema.org",
    "@graph": meta.structuredData,
  });
  return element("script", { type: "application/ld+json", nonce }, raw(json));
}

function property(name: string, content: string | number | undefined): HtmlNode | null {
  return tag("meta", { property: name, content });
}

/** Renders the tag only when it carries a value — absent metadata emits nothing. */
function tag(
  name: "meta" | "link",
  attributes: Record<string, string | number | undefined>,
): HtmlNode | null {
  const value = attributes.content ?? attributes.href;
  if (value === undefined || value === "") return null;
  return element(name, attributes);
}
