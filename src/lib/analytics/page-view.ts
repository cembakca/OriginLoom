import { readCookie } from "~/lib/client/cookies";
import { Cookie } from "~/lib/cookies";
import { getOriginalLocation, setOriginalLocation } from "~/lib/stores/session-store";
import { getUserInfo } from "~/lib/stores/user-info-store";
import { stripUndefined } from "~/lib/strip-undefined";

import { pushDataLayer, signalReactReady } from "./data-layer";
import type { PageAnalyticsMeta, PageDetails } from "./types";

export function buildVirtualPageUrl(meta: PageAnalyticsMeta): string {
  return meta.publicPath + (meta.search || "");
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
