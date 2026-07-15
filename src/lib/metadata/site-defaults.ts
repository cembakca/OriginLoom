import { env } from "~/lib/env";

import type { SiteMetadataConfig } from "./types";

/** Root layout `export const metadata` karşılığı — statik site kimliği. */
export const siteMetadata: SiteMetadataConfig = {
  applicationName: "Hangikredi",
  title: {
    default: "Hangikredi",
    template: "%s | Hangikredi",
  },
  description:
    "Kredi, mevduat ve bankacılık ürünlerini karşılaştır; sana en uygun finansal ürünü bul.",
  baseUrl: env.siteUrl,
  openGraph: {
    siteName: "Hangikredi",
    type: "website",
    locale: "tr_TR",
    defaultImage: `${env.siteUrl}/og-default.png`,
  },
  twitter: {
    card: "summary_large_image",
    site: "@hangikredi",
  },
  robots: { index: true, follow: true },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  formatDetection: { telephone: false },
};
