import type { JsonLdObject } from "./jsonld";

/** Backend / CMS SEO payload (ISeoInfo subset). */
export type SeoInfo = {
  title?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  headingTitle?: string;
  heroDescription?: string;
  image?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  noindex?: boolean;
  nofollow?: boolean;
  badge?: string;
  friendlyUrl?: string;
  openGraphType?: "website" | "article" | "product";
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  section?: string;
  tags?: string[];
};

/** Route-level metadata override (Next.js Metadata API karşılığı). */
export type PageMetadata = {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: {
    index?: boolean;
    follow?: boolean;
    noarchive?: boolean;
    nosnippet?: boolean;
    noimageindex?: boolean;
    notranslate?: boolean;
    maxSnippet?: number;
    maxImagePreview?: "none" | "standard" | "large";
    maxVideoPreview?: number;
  };
  openGraph?: {
    title?: string;
    description?: string;
    url?: string;
    image?: string;
    imageAlt?: string;
    imageType?: string;
    imageWidth?: number;
    imageHeight?: number;
    siteName?: string;
    type?: string;
    locale?: string;
    publishedTime?: string;
    modifiedTime?: string;
    authors?: string[];
    section?: string;
    tags?: string[];
  };
  twitter?: {
    card?: "summary" | "summary_large_image";
    title?: string;
    description?: string;
    image?: string;
    imageAlt?: string;
    site?: string;
    creator?: string;
  };
  icons?: { icon?: string; apple?: string };
  verification?: Record<string, string>;
  pagination?: { previous?: string; next?: string };
  structuredData?: JsonLdObject[];
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
  applicationName: string;
  siteName: string;
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
  verification: Record<string, string>;
  pagination: { previous?: string; next?: string };
  formatDetection: { telephone: boolean };
  structuredData: JsonLdObject[];
};
