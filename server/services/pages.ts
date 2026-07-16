import { gatewayFetchForRequest } from "@server/adapters/gateway";
import { config } from "@server/config";
import { parseGatewayPayload, readGatewayJson } from "@server/gateway-payload";

import { parseSeoInfo } from "~/lib/metadata/schema";
import type { SeoInfo } from "~/lib/metadata/types";

export type RetirementBankingPage = {
  headline: string;
  authenticated: boolean;
  seoInfo: SeoInfo | null;
};

type PagePayload = { headline?: string; seoInfo?: SeoInfo };
const INVALID_PAGE = "Page gateway returned an invalid payload";

/** Page + seoInfo tek fetch — loader ve generateMetadata aynı data'yı kullanır. */
export async function fetchRetirementBankingPage(request: Request): Promise<RetirementBankingPage> {
  const authenticated = Boolean(request.headers.get("Authorization"));

  const res = await gatewayFetchForRequest(request, "/pages/retirement-banking");
  if (!res.ok) throw new Error(`Page gateway returned ${res.status}`);

  const data = await readGatewayJson(res, "page", INVALID_PAGE);
  const page = parseGatewayPayload("page", data, parsePagePayload, INVALID_PAGE);

  return {
    headline: page.headline ?? page.seoInfo?.headingTitle ?? "Emekli Bankacılığı",
    authenticated,
    seoInfo: page.seoInfo ?? null,
  };
}

function parsePagePayload(data: unknown): PagePayload | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  if (
    value.headline !== undefined &&
    (typeof value.headline !== "string" ||
      value.headline.length === 0 ||
      value.headline.length > 200)
  ) {
    return null;
  }
  const seoInfo =
    value.seoInfo === undefined ? undefined : parseSeoInfo(value.seoInfo, config.siteUrl);
  if (seoInfo === null) return null;
  return {
    ...(value.headline !== undefined ? { headline: value.headline } : {}),
    ...(seoInfo !== undefined ? { seoInfo } : {}),
  };
}
