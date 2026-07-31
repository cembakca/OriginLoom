import { readCookie } from "../client/cookies.js";
import { Cookie } from "../cookies.js";
import { getOriginalLocation, setOriginalLocation } from "../stores/session-store.js";
import { getUserInfo } from "../stores/user-info-store.js";
import { stripUndefined } from "../strip-undefined.js";
import { pushDataLayer, signalReactReady } from "./data-layer.js";
import type { PageAnalyticsMeta, PageDetails } from "./types.js";

export function buildVirtualPageUrl(meta: PageAnalyticsMeta): string {
  if (typeof window !== "undefined") {
    return window.location.pathname + window.location.search;
  }
  return meta.publicPath;
}

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

/** Route page-analytics island — ONLY page-view payload. Order: originalLocation → GAVirtual → signalReactReady. */
export function pushPageView(meta: PageAnalyticsMeta): void {
  const currentUrl = window.location.pathname + window.location.search;
  if (!getOriginalLocation()) setOriginalLocation(currentUrl);

  pushDataLayer({ originalLocation: getOriginalLocation() }, "immediate");
  pushDataLayer(
    {
      event: `page-${meta.pageType}`,
      GAVirtual: {
        virtualPageUrl: buildVirtualPageUrl(meta),
        pageDetails: buildPageDetails(meta),
      },
    },
    "immediate",
  );
  signalReactReady();
}

export function trackEvent(name: string, payload: Record<string, unknown> = {}): void {
  pushDataLayer({ event: name, ...payload }, "after-dom");
}
