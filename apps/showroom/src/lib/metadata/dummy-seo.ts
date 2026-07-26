import type { Ctx } from "@originloom/react/lib/types";
import {
  generateMetaDataForPageWithSeoInfo,
  publicAbsoluteUrl,
} from "@originloom/shared/lib/metadata/generate";
import type { PageMetadata, SeoInfo } from "@originloom/shared/lib/metadata/types";

const dummySeoByPath: Record<string, Partial<SeoInfo>> = {
  "/": {
    title: "Hangikredi",
    metaDescription: "Kredi ve bankacılık ürünlerini karşılaştır.",
  },
  "/hesabim": {
    title: "Hesabım",
    noindex: true,
  },
  "/remote-customer-obtain": {
    title: "Uzaktan Müşteri Edinimi",
  },
  "/medya-pipeline": {
    title: "Image ve Font Pipeline",
    metaDescription: "Responsive, unoptimized CDN image ve self-host font pipeline demosu.",
  },
};

/** API seoInfo yoksa zayıf fallback — path tabanlı. */
export function generateMetaDataForPageWithDummySeoInfo(path: string, ctx: Ctx): PageMetadata {
  const key = Object.keys(dummySeoByPath).find((p) => path === p || ctx.publicPath === p) ?? path;
  const dummy = dummySeoByPath[key] ?? dummySeoByPath[ctx.publicPath] ?? { title: path };

  return generateMetaDataForPageWithSeoInfo(
    {
      ...dummy,
      friendlyUrl: ctx.publicPath,
      canonicalUrl: publicAbsoluteUrl(ctx),
    },
    ctx,
  );
}
