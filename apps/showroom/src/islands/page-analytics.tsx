import { pushPageView } from "@originloom/shared/lib/analytics/page-view";
import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import { useLayoutEffect } from "react";

/** Route page.client equivalent — ONLY page-view dataLayer payload. */
export default function PageAnalytics(props: PageAnalyticsMeta) {
  useLayoutEffect(() => {
    pushPageView(props);
  }, [props]);

  return null;
}
