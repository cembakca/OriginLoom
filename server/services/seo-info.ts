import { config } from "@server/config";

import { parseSeoInfo } from "~/lib/metadata/schema";
import type { SeoInfo } from "~/lib/metadata/types";

/** Required gateway SEO boundary. Final URL normalization is repeated during metadata merge. */
export function isSeoInfo(value: unknown): value is SeoInfo {
  return parseSeoInfo(value, config.siteUrl) !== null;
}
