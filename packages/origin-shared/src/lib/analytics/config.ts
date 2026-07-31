/**
 * The names this app's dataLayer uses.
 *
 * A tag manager contract is a set of exact strings — `hkUserTrackingId`,
 * `HK_pageCategory` — and those strings belong to the product, not to the
 * platform. They are configured once at startup so no call site repeats them and
 * a rename is one edit rather than a search.
 */
export type AnalyticsFieldConfig = {
  /** Key the visitor's tracking id is pushed under. No `event` key comes with it. */
  trackingIdKey: string;
  /** Prefix on the page-view dimensions, e.g. `"HK_"`. */
  fieldPrefix: string;
  /** Event name of the page view itself. */
  pageViewEvent: string;
};

const DEFAULTS: AnalyticsFieldConfig = {
  trackingIdKey: "userTrackingId",
  fieldPrefix: "",
  pageViewEvent: "GAVirtual",
};

let fields: AnalyticsFieldConfig = DEFAULTS;

export function configureAnalyticsFields(overrides: Partial<AnalyticsFieldConfig>): void {
  fields = { ...DEFAULTS, ...overrides };
}

export function analyticsFields(): AnalyticsFieldConfig {
  return fields;
}
