import {
  normalizeCanonicalUrl,
  normalizeMetadataImageUrl,
  normalizeNavigationUrl,
} from "../content-url.js";
import { stripUndefined } from "../strip-undefined.js";
import type { SeoInfo } from "./types.js";

const STRING_LIMITS = {
  title: 200,
  headingTitle: 200,
  metaDescription: 1_000,
  heroDescription: 1_000,
  imageAlt: 300,
  badge: 120,
  author: 160,
  section: 120,
} as const;
const OPEN_GRAPH_TYPES = new Set(["website", "article", "product"]);

/** Runtime parser for the CMS SEO contract. Unknown fields are discarded. */
export function parseSeoInfo(value: unknown, siteUrl: string): SeoInfo | null {
  if (!isRecord(value) || !validStrings(value) || !validFlags(value) || !validEditorial(value)) {
    return null;
  }
  const urls = parseSeoUrls(value, siteUrl);
  if (!urls) return null;
  return {
    ...pickStrings(value),
    ...urls,
    ...stripUndefined({
      imageWidth: optionalInteger(value.imageWidth, 1, 10_000),
      imageHeight: optionalInteger(value.imageHeight, 1, 10_000),
      noindex: optionalBoolean(value.noindex),
      nofollow: optionalBoolean(value.nofollow),
      openGraphType: optionalOpenGraphType(value.openGraphType),
      tags: optionalTags(value.tags),
    }),
  };
}

function validStrings(value: Record<string, unknown>): boolean {
  return Object.entries(STRING_LIMITS).every(([key, max]) => optionalString(value[key], max));
}

function validFlags(value: Record<string, unknown>): boolean {
  return (
    validOptionalBoolean(value.noindex) &&
    validOptionalBoolean(value.nofollow) &&
    validOptionalInteger(value.imageWidth, 1, 10_000) &&
    validOptionalInteger(value.imageHeight, 1, 10_000) &&
    (value.openGraphType === undefined ||
      (typeof value.openGraphType === "string" && OPEN_GRAPH_TYPES.has(value.openGraphType)))
  );
}

function validEditorial(value: Record<string, unknown>): boolean {
  return (
    optionalIsoDate(value.publishedTime) &&
    optionalIsoDate(value.modifiedTime) &&
    (value.tags === undefined ||
      (Array.isArray(value.tags) &&
        value.tags.length <= 30 &&
        value.tags.every((tag) => typeof tag === "string" && tag.length > 0 && tag.length <= 100)))
  );
}

function parseSeoUrls(value: Record<string, unknown>, siteUrl: string): Partial<SeoInfo> | null {
  const canonicalUrl = optionalCanonical(value.canonicalUrl, siteUrl);
  const friendlyUrl = optionalFriendlyUrl(value.friendlyUrl, siteUrl);
  const image = optionalImage(value.image, siteUrl);
  if (canonicalUrl === null || friendlyUrl === null || image === null) return null;
  return stripUndefined({ canonicalUrl, friendlyUrl, image });
}

function pickStrings(value: Record<string, unknown>): Partial<SeoInfo> {
  return stripUndefined({
    title: optionalKnownString(value.title),
    metaDescription: optionalKnownString(value.metaDescription),
    headingTitle: optionalKnownString(value.headingTitle),
    heroDescription: optionalKnownString(value.heroDescription),
    imageAlt: optionalKnownString(value.imageAlt),
    badge: optionalKnownString(value.badge),
    publishedTime: optionalKnownString(value.publishedTime),
    modifiedTime: optionalKnownString(value.modifiedTime),
    author: optionalKnownString(value.author),
    section: optionalKnownString(value.section),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(value: unknown, max: number): boolean {
  return (
    value === undefined || (typeof value === "string" && value.length > 0 && value.length <= max)
  );
}

function optionalKnownString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function validOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function validOptionalInteger(value: unknown, min: number, max: number): boolean {
  return value === undefined || optionalInteger(value, min, max) !== undefined;
}

function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

function optionalIsoDate(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)))
  );
}

function optionalOpenGraphType(value: unknown): SeoInfo["openGraphType"] {
  return typeof value === "string" && OPEN_GRAPH_TYPES.has(value)
    ? (value as SeoInfo["openGraphType"])
    : undefined;
}

function optionalTags(value: unknown): string[] | undefined {
  return Array.isArray(value) ? (value as string[]) : undefined;
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
