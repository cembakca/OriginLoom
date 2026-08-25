/** Cookie names — single source of truth for routes and middleware. */
export const Cookie = {
  accessToken: "access_token",
  refreshToken: "refresh_token",
  /** Client-readable oturum göstergesi — httpOnly token'ların yerine UI bunu okur. */
  signedIn: "signed_in",
  accountText: "account_text",
  userTrackingId: "user_tracking_id",
  /** Referral tekil oturum ölçümü — client JS tarafından okunamaz. */
  referralSession: "referral_session",
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

/** The prefix a browser refuses unless the cookie is `Secure` and `Path=/` with no `Domain`. */
export const HOST_PREFIX = "__Host-";

/**
 * The cookies that carry a session, and the reason the prefix is worth having.
 *
 * `__Host-` is not decoration. Without it a cookie a browser holds for this
 * origin may have been set by *any* host under the registrable domain — a
 * forgotten staging box, a subdomain someone else operates, an XSS on a sibling
 * app — with `Domain=` making it visible here. The prefix is the browser
 * promising the opposite: this cookie was set by this exact origin, over HTTPS,
 * for the whole path, and no `Domain` widened it.
 *
 * Deliberately not every cookie. `__Host-` forbids `Domain`, so a marketing or
 * attribution cookie that a product genuinely wants shared across subdomains
 * cannot carry it — and quietly breaking that sharing to look strict would be a
 * worse trade than leaving those names alone.
 */
export const HOST_PREFIXED_COOKIES = new Set<string>([
  Cookie.accessToken,
  Cookie.refreshToken,
  Cookie.signedIn,
  Cookie.accountText,
  Cookie.referralSession,
]);

/**
 * The name to look for, newest first.
 *
 * Both, and in this order, because a rollout has a middle: visitors arrive
 * holding the old unprefixed cookie for as long as it lives, while every new
 * response sets the prefixed one. Reading only the new name would sign
 * everybody out on deploy; reading only the old one would never finish the
 * migration. Once the unprefixed cookie has expired everywhere, the second
 * entry stops matching anything and can be dropped.
 */
export function cookieNameCandidates(name: string): readonly string[] {
  return HOST_PREFIXED_COOKIES.has(name) ? [`${HOST_PREFIX}${name}`, name] : [name];
}
