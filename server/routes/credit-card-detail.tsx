import { neverCache } from "@originloom/react/lib/cache-policy";
import { isBoundedRouteSlug } from "@originloom/react/lib/content-values";
import { breadcrumbJsonLd, compactJsonLd } from "@originloom/react/lib/metadata/jsonld";
import { defineRoute, notFound } from "@originloom/react/lib/types";
import { getCreditCard, getCreditCardCampaigns } from "@server/services/financial-products";

import { CreditCardDetailPage } from "~/features/financial-products/credit-card-detail";
import type { CreditCardCampaign, CreditCardDetail } from "~/lib/contracts/financial-products";
import { generateMetaDataForPageWithSeoInfo, publicAbsoluteUrl } from "~/lib/metadata/generate";
import { creditCardJsonLd } from "~/lib/metadata/jsonld-finance";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = {
  detail: CreditCardDetail;
  campaignsPromise: Promise<CreditCardCampaign[]>;
};

export default defineRoute<Data>({
  path: "/kredi-kartlari/:slug",
  streaming: true,
  validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
  cache: () => neverCache(),
  loader: async (ctx) => {
    const slug = ctx.params.slug ?? "";
    const detail = await getCreditCard(slug, ctx.request.signal);
    if (!detail) return notFound();

    const campaignsPromise =
      ctx.request.method === "HEAD"
        ? Promise.resolve([])
        : getCreditCardCampaigns(slug, ctx.request.signal).then((result) => {
            if (!result) throw new Error("Credit card campaigns disappeared after detail lookup");
            return result.campaigns;
          });
    return { data: { detail, campaignsPromise } };
  },
  generateMetadata: (data, ctx) => {
    const base = ctx.siteUrl ?? ctx.url.origin;
    const url = publicAbsoluteUrl(ctx, `/kredi-kartlari/${data.detail.product.slug}`);
    const metadata = generateMetaDataForPageWithSeoInfo(data.detail.seoInfo, ctx);
    return {
      ...metadata,
      canonical: url,
      openGraph: { ...metadata.openGraph, url },
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana Sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "Kredi Kartları", url: publicAbsoluteUrl(ctx, "/kredi-kartlari") },
            { name: data.detail.product.name, url },
          ],
          base,
        ),
        creditCardJsonLd(data.detail.product, url),
      ]),
    };
  },
  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "credit-card-detail", {
      category: "card",
      mid: "kredi-kartlari",
      sub: data.detail.product.slug,
    }),
  Component: CreditCardDetailPage,
});
