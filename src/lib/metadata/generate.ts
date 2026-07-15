import type { Ctx } from "../types";
import { config } from "../../../server/config";
import type { PageMetadata, SeoInfo } from "./types";

/** Public absolute URL from browser-visible path. */
export function publicAbsoluteUrl(ctx: Ctx, path?: string): string {
  const base = config.siteUrl.replace(/\/$/, "");
  const p = path ?? ctx.publicPath;
  return `${base}${p.startsWith("/") ? p : `/${p}`}`;
}

const dummySeoByPath: Record<string, Partial<SeoInfo>> = {
  "/": {
    title: "Hangikredi",
    metaDescription: "Kredi ve bankacılık ürünlerini karşılaştır.",
  },
  "/retirement-banking": {
    title: "Emekli Bankacılığı",
    badge: "Emekli",
    metaDescription: "Emekliler için özel bankacılık ürünleri ve kampanyalar.",
  },
  "/emekli-bankaciligi": {
    title: "Emekli Bankacılığı",
    metaDescription: "Emekliler için özel bankacılık ürünleri ve kampanyalar.",
  },
  "/ihtiyac-kredisi": {
    title: "İhtiyaç Kredisi",
    metaDescription: "İhtiyaç kredisi faiz oranlarını karşılaştır.",
  },
  "/blogs/paginated": {
    title: "Blog",
    metaDescription: "Finans ve bankacılık içerikleri.",
  },
  "/hesabim": {
    title: "Hesabım",
    noindex: true,
  },
  "/remote-customer-obtain": {
    title: "Uzaktan Müşteri Edinimi",
  },
};

/** CMS seoInfo → route PageMetadata. */
export function generateMetaDataForPageWithSeoInfo(seoInfo: SeoInfo, ctx: Ctx): PageMetadata {
  const canonical = seoInfo.canonicalUrl ?? publicAbsoluteUrl(ctx, seoInfo.friendlyUrl);
  const title = seoInfo.title ?? seoInfo.badge;
  const description = seoInfo.metaDescription ?? seoInfo.heroDescription;
  const image = seoInfo.image;

  return {
    title,
    description,
    canonical,
    robots: seoInfo.noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      title: title ?? undefined,
      description,
      url: canonical,
      image,
    },
    twitter: {
      title: title ?? undefined,
      description,
      image,
    },
  };
}

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

/** Route title helper → minimal metadata. */
export function metadataFromTitle(title: string, ctx: Ctx): PageMetadata {
  return {
    title,
    canonical: publicAbsoluteUrl(ctx),
    openGraph: { url: publicAbsoluteUrl(ctx), title },
    twitter: { title },
  };
}
