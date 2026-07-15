import { gatewayFetch } from "~/lib/gateway-fetch";
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
    const res = await gatewayFetch(request, "/pages/retirement-banking");
    if (!res.ok) return mockRetirementBankingPage(authenticated);

    const data = (await res.json()) as {
      headline?: string;
      seoInfo?: SeoInfo;
    };

    return {
      headline: data.headline ?? data.seoInfo?.headingTitle ?? "Emekli Bankacılığı",
      authenticated,
      seoInfo: data.seoInfo ?? null,
    };
  } catch {
    return mockRetirementBankingPage(authenticated);
  }
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
