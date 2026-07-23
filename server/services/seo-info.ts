import { parseSeoInfo } from "@originloom/react/lib/metadata/schema";
import type { SeoInfo } from "@originloom/react/lib/metadata/types";
import { config } from "@server/config";

/** Required gateway SEO boundary. Final URL normalization is repeated during metadata merge. */
export function isSeoInfo(value: unknown): value is SeoInfo {
  return parseSeoInfo(value, config.siteUrl) !== null;
}
