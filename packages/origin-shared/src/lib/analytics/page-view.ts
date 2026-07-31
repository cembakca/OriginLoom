import { readCookie } from "../client/cookies.js";
import { Cookie } from "../cookies.js";
import { getOriginalLocation, setOriginalLocation } from "../stores/session-store.js";
import { getUserInfo } from "../stores/user-info-store.js";
import { stripUndefined } from "../strip-undefined.js";
import { analyticsFields } from "./config.js";
import { pushDataLayer, signalReactReady } from "./data-layer.js";
import type { PageAnalyticsMeta, PageDetails } from "./types.js";

export function buildVirtualPageUrl(meta: PageAnalyticsMeta): string {
  if (typeof window !== "undefined") {
    return window.location.pathname + window.location.search;
  }
  return meta.publicPath;
}

/** The page's dimensions, before the product's prefix is applied to their names. */
export function buildPageDetails(meta: PageAnalyticsMeta): PageDetails {
  const user = getUserInfo();
  return {
    pageType: meta.pageType,
    platform: "web",
    loginState: user.isSignedIn,
    bot: readCookie(Cookie.botFlag) === "1",
    ...stripUndefined({
      category: meta.category,
      mid: meta.mid,
      sub: meta.sub,
      experiment: meta.experiment,
      campaign: meta.campaign,
    }),
  };
}

/**
 * The page view, in the order a tag manager expects to receive it.
 *
 *   1. `originalLocation` — the address the visit started at, absolute, pushed
 *      once per session. Tags use it for attribution, so it has to be there
 *      before the view it explains.
 *   2. the page view itself — one flat event. Flat because a tag reads a
 *      dataLayer variable by name; a nested object means every dimension needs
 *      its own variable definition in the container UI.
 *   3. `signalReactReady()` — releases the `gtm.dom` / `gtm.load` the bootstrap
 *      has been holding, so the tags that fire on them see these dimensions.
 *
 * Field names come from `configureAnalyticsFields`: they are the product's
 * contract with its container, not the platform's.
 */
export function pushPageView(meta: PageAnalyticsMeta): void {
  const { fieldPrefix, pageViewEvent } = analyticsFields();
  const currentUrl = window.location.pathname + window.location.search;
  if (!getOriginalLocation()) setOriginalLocation(window.location.origin + currentUrl);

  pushDataLayer({ event: "originalLocation", originalLocation: getOriginalLocation() });

  const details = buildPageDetails(meta);
  pushDataLayer({
    event: pageViewEvent,
    virtualPageUrl: buildVirtualPageUrl(meta),
    ...stripUndefined({ virtualPageTitle: meta.title }),
    ...prefixed(details, fieldPrefix),
  });

  signalReactReady();
}

/** `{ category: "x" }` with prefix `HK_` becomes `{ HK_category: "x" }`. */
function prefixed(details: PageDetails, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(details)) {
    if (value !== undefined) out[`${prefix}${name}`] = value;
  }
  return out;
}

export function trackEvent(name: string, payload: Record<string, unknown> = {}): void {
  pushDataLayer({ event: name, ...payload });
}
