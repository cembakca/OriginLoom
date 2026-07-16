import { gatewayFetchForRequest } from "@server/adapters/gateway";
import { runtimeMocksEnabled } from "@server/config";

import type { SeoInfo } from "~/lib/metadata/types";

export type RetirementBankingPage = {
  headline: string;
  authenticated: boolean;
  seoInfo: SeoInfo | null;
};

/** Page + seoInfo tek fetch — loader ve generateMetadata aynı data'yı kullanır. */
export async function fetchRetirementBankingPage(request: Request): Promise<RetirementBankingPage> {
  const authenticated = Boolean(request.headers.get("Authorization"));

  try {
    const res = await gatewayFetchForRequest(request, "/pages/retirement-banking");
    if (!res.ok) throw new Error(`Page gateway returned ${res.status}`);

    const data: unknown = await res.json();
    if (!isPagePayload(data)) throw new Error("Page gateway returned an invalid payload");

    return {
      headline: data.headline ?? data.seoInfo?.headingTitle ?? "Emekli Bankacılığı",
      authenticated,
      seoInfo: data.seoInfo ?? null,
    };
  } catch (error) {
    if (runtimeMocksEnabled()) return mockRetirementBankingPage(authenticated);
    throw error;
  }
}

function isPagePayload(data: unknown): data is { headline?: string; seoInfo?: SeoInfo } {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  return (
    (value.headline === undefined || typeof value.headline === "string") &&
    (value.seoInfo === undefined || (value.seoInfo !== null && typeof value.seoInfo === "object"))
  );
}

function mockRetirementBankingPage(authenticated: boolean): RetirementBankingPage {
  return {
    headline: "Emekli Bankacılığı",
    authenticated,
    seoInfo: {
      title: "Emekli Bankacılığı",
      metaDescription:
        "Emekli maaşınıza özel bankacılık ürünleri, promosyonlar ve avantajlı faiz oranları.",
      headingTitle: "Emekli Bankacılığı",
      heroDescription: "Emekliler için özel bankacılık çözümleri.",
      image: "https://cdn.hangikredi.com/og/retirement-banking.png",
      friendlyUrl: "/emekli-bankaciligi",
    },
  };
}
