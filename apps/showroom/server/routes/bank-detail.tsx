import { defineRoute, notFound } from "@originloom/react/lib/types";
import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";
import {
  generateMetaDataForPageWithSeoInfo,
  publicAbsoluteUrl,
} from "@originloom/shared/lib/metadata/generate";
import {
  breadcrumbJsonLd,
  compactJsonLd,
  itemListJsonLd,
} from "@originloom/shared/lib/metadata/jsonld";
import { getBank } from "@server/services/financial-products";

import { BankDetailPage } from "~/features/financial-products/bank-detail";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import type { BankDetail } from "~/lib/contracts/financial-products";
import { bankProfileJsonLd } from "~/lib/metadata/jsonld-finance";
import { defaultPageMeta } from "~/lib/shell-data";

export default defineRoute<BankDetail>({
  path: "/bankalar/:slug",
  validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
  cache: (ctx) => pageCachePolicy(PageCacheId.bankDetail, ctx),
  loader: async (ctx) => {
    const data = await getBank(ctx.params.slug ?? "", ctx.request.signal);
    return data ? { data } : notFound();
  },
  generateMetadata: (data, ctx) => {
    const base = ctx.siteUrl ?? ctx.url.origin;
    const canonical = publicAbsoluteUrl(ctx, `/bankalar/${data.bank.slug}`);
    const metadata = generateMetaDataForPageWithSeoInfo(data.seoInfo, ctx);
    const products = [
      ...data.products.housingLoans.map((product) => ({
        name: product.name,
        url: publicAbsoluteUrl(ctx, `/konut-kredisi/${product.slug}`),
      })),
      ...data.products.creditCards.map((product) => ({
        name: product.name,
        url: publicAbsoluteUrl(ctx, `/kredi-kartlari/${product.slug}`),
      })),
    ];
    return {
      ...metadata,
      canonical,
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana Sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: data.bank.name, url: canonical },
          ],
          base,
        ),
        bankProfileJsonLd(data.bank, canonical),
        itemListJsonLd(`${data.bank.name} ürünleri`, products, base),
      ]),
    };
  },
  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "bank-detail", { category: "bank", mid: data.bank.slug }),
  Component: BankDetailPage,
});
