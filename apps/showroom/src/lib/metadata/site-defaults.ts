import type { SiteMetadataConfig } from "@originloom/shared/lib/metadata/types";

/** Root layout `export const metadata` karşılığı — statik site kimliği. */
export function siteMetadata(baseUrl: string): SiteMetadataConfig {
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
      defaultImage: `${baseUrl}/assets/media/og-default.jpg`,
    },
    twitter: {
      card: "summary_large_image",
      site: "@hangikredi",
    },
    robots: { index: true, follow: true },
    icons: {
      icon: "/assets/media/favicon-32.png",
      apple: "/assets/media/apple-touch-icon.png",
    },
    formatDetection: { telephone: false },
  };
}
