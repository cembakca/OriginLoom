import { defineRoute, notFound } from "@originloom/react/lib/types";
import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";
import { publicAbsoluteUrl } from "@originloom/shared/lib/metadata/generate";
import { getReferral } from "@server/services/financial-products";

import { ReferralPage } from "~/features/financial-products/referral-page";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import type { ReferralDetail } from "~/lib/contracts/financial-products";
import { referralProductByPublicType } from "~/lib/referral-products";
import { defaultPageMeta } from "~/lib/shell-data";

type Data = { detail: ReferralDetail; publicType: string };

export default defineRoute<Data>({
  path: "/basvuru/:productType/:slug/yonlendirme",
  validateParams: (ctx) =>
    Boolean(referralProductByPublicType(ctx.params.productType)) &&
    isBoundedRouteSlug(ctx.params.slug),
  cache: pageCache(PageCacheId.financeReferral),
  loader: async (ctx) => {
    const publicType = ctx.params.productType ?? "";
    const definition = referralProductByPublicType(publicType);
    if (!definition) return notFound();
    const detail = await getReferral(
      definition.gatewayType,
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
  Component: ({ data }) => <ReferralPage data={data.detail} />,
});
