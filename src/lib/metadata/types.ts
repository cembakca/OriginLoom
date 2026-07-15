/** Backend / CMS SEO payload (ISeoInfo subset). */
export type SeoInfo = {
  title?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  headingTitle?: string;
  heroDescription?: string;
  image?: string;
  noindex?: boolean;
  badge?: string;
  friendlyUrl?: string;
};

/** Route-level metadata override (Next.js Metadata API karşılığı). */
export type PageMetadata = {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: { index?: boolean; follow?: boolean };
  openGraph?: {
    title?: string;
    description?: string;
    url?: string;
    image?: string;
    siteName?: string;
    type?: string;
    locale?: string;
  };
  twitter?: {
    card?: "summary" | "summary_large_image";
    title?: string;
    description?: string;
    image?: string;
  };
  icons?: { icon?: string; apple?: string };
  verification?: Record<string, string>;
};

/** Site-wide defaults from root layout metadata. */
export type SiteMetadataConfig = {
  applicationName: string;
  title: { default: string; template: string };
  description: string;
  baseUrl: string;
  openGraph: {
    siteName: string;
    type: string;
    locale: string;
    defaultImage: string;
  };
  twitter: {
    card: "summary" | "summary_large_image";
    site?: string;
  };
  robots: { index: boolean; follow: boolean };
  icons: { icon: string; apple?: string };
  formatDetection?: { telephone?: boolean };
};

/** Final merged head output. */
export type ResolvedMetadata = {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  openGraph: Required<
    Pick<NonNullable<PageMetadata["openGraph"]>, "title" | "description" | "url">
  > &
    NonNullable<PageMetadata["openGraph"]>;
  twitter: Required<Pick<NonNullable<PageMetadata["twitter"]>, "card" | "title" | "description">> &
    NonNullable<PageMetadata["twitter"]>;
  icons: { icon: string; apple?: string };
};
