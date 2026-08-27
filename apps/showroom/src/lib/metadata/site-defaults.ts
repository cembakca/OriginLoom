import { seoAssets } from "@originloom/core/media";
import type { SiteMetadataConfig } from "@originloom/shared/lib/metadata/types";

/** Root layout `export const metadata` karşılığı — statik site kimliği. */
export function siteMetadata(baseUrl: string): SiteMetadataConfig {
  // Read from the media manifest, never written out as a path: these four are
  // content-hashed, and they are served with a one-year immutable cache.
  const seo = seoAssets();
  return {
    applicationName: "Hangikredi",
    title: {
      default: "Hangikredi",
      template: "%s | Hangikredi",
    },
    description:
      "Kredi, mevduat ve bankacılık ürünlerini karşılaştır; sana en uygun finansal ürünü bul.",
    baseUrl,
    openGraph: {
      siteName: "Hangikredi",
      type: "website",
      locale: "tr_TR",
      defaultImage: new URL(seo.openGraph.src, baseUrl).toString(),
    },
    twitter: {
      card: "summary_large_image",
      site: "@hangikredi",
    },
    robots: { index: true, follow: true },
    icons: {
      icon: seo.favicon.src,
      apple: seo.appleTouchIcon.src,
    },
    organizationLogo: {
      url: seo.brandLogo.src,
      width: seo.brandLogo.width,
      height: seo.brandLogo.height,
    },
    formatDetection: { telephone: false },
  };
}
