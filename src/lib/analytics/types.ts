/** GTM dataLayer page-view contract (HK + GAVirtual). */
export type PageDetails = {
  pageType: string;
  category?: string;
  mid?: string;
  sub?: string;
  platform?: string;
  loginState?: boolean;
  bot?: boolean;
};

export type DataLayerPageEvent = {
  event: string;
  originalLocation?: string;
  GAVirtual?: {
    virtualPageUrl: string;
    pageDetails: PageDetails;
  };
  hkUserTrackingId?: string;
  hkGclid?: string;
  hkUtmSource?: string;
  hkUtmCampaign?: string;
};

export type PageAnalyticsMeta = {
  pageType: string;
  category?: string;
  mid?: string;
  sub?: string;
  title?: string;
  publicPath: string;
};

export type GtmLifecycleEvent = {
  event: "gtm.dom" | "gtm.load";
  [key: string]: unknown;
};

export type DataLayerPushPriority = "immediate" | "after-react" | "after-dom" | "between-dom-load";
