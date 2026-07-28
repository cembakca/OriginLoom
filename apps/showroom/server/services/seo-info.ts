import { config } from "@originloom/core/config";
import { parseSeoInfo } from "@originloom/shared/lib/metadata/schema";
import type { SeoInfo } from "@originloom/shared/lib/metadata/types";

/** Required gateway SEO boundary. Final URL normalization is repeated during metadata merge. */
export function isSeoInfo(value: unknown): value is SeoInfo {
  return parseSeoInfo(value, config.siteUrl) !== null;
}
