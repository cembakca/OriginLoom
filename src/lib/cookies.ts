/** Cookie names — single source of truth for routes and middleware. */
export const Cookie = {
  accessToken: "access_token",
  refreshToken: "refresh_token",
  userTrackingId: "user_tracking_id",
  theme: "theme",
  gclid: "gclid",
  utmSource: "utm_source",
  utmCampaign: "utm_campaign",
  resource: "resource",
  botFlag: "bot_flag",
  /** Example: product/personalization id — wire a bypass check when needed. */
  pid: "pid",
} as const;

export type CookieName = (typeof Cookie)[keyof typeof Cookie];
