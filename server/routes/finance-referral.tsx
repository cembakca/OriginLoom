import { getReferral } from "@server/services/financial-products";

import { ReferralPage } from "~/features/financial-products/referral-page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { isBoundedRouteSlug } from "~/lib/content-values";
import type { ReferralDetail } from "~/lib/contracts/financial-products";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound } from "~/lib/types";

const PRODUCT_TYPES: Record<string, string> = {
  "konut-kredisi": "housing-loan",
  "kredi-karti": "credit-card",
};
type Data = { detail: ReferralDetail; publicType: string };

export default defineRoute<Data>({
  path: "/basvuru/:productType/:slug/yonlendirme",
  validateParams: (ctx) =>
    Boolean(PRODUCT_TYPES[ctx.params.productType ?? ""]) && isBoundedRouteSlug(ctx.params.slug),
  cache: (ctx) => pageCachePolicy(PageCacheId.financeReferral, ctx),
  loader: async (ctx) => {
    const publicType = ctx.params.productType ?? "";
    const detail = await getReferral(
      PRODUCT_TYPES[publicType] ?? "",
      ctx.params.slug ?? "",
      ctx.request.signal,
    );
    return detail ? { data: { detail, publicType } } : notFound();
  },
  generateMetadata: (data, ctx) => {
    const title = `${data.detail.product.name} Başvuru Yönlendirmesi`;
    const url = publicAbsoluteUrl(ctx);
    return { title, canonical: url, robots: { index: false, follow: true } };
  },
  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "finance-referral", {
      category: "redirect",
      mid: data.publicType,
      sub: data.detail.product.slug,
    }),
  Component: ({ data }) => <ReferralPage data={data.detail} publicType={data.publicType} />,
});
