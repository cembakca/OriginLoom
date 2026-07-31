/** GTM dataLayer page-view contract (HK + GAVirtual). */
export type PageDetails = {
  pageType: string;
  category?: string;
  mid?: string;
  sub?: string;
  experiment?: string;
  campaign?: string;
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
  /**
   * Which arm of an experiment rendered this page.
   *
   * Page-level, like `category`: an analysis that cannot tell the arms apart is
   * not an analysis. It is a dimension and never an identifier — a value with
   * one entry per visitor belongs nowhere near this.
   */
  experiment?: string;
  /** Campaign the visit arrived on. Attribution only; it changes no rendering. */
  campaign?: string;
};

export type GtmLifecycleEvent = {
  event: "gtm.dom" | "gtm.load";
  [key: string]: unknown;
};

export type DataLayerPushPriority = "immediate" | "after-react" | "after-dom" | "between-dom-load";
