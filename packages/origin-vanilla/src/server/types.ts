import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import type { ResolvedMetadata } from "@originloom/shared/lib/metadata/types";
import type { RouteError } from "@originloom/shared/lib/types";

import type { HtmlNode } from "../html.js";

/**
 * The product's document chrome, in plain HTML. The counterpart of
 * `ReactRendererConfig` — same slots, string nodes instead of components.
 */
export type HtmlRendererConfig<Shell = unknown> = {
  notFoundPage: () => HtmlNode;
  errorPage: (args: { error: RouteError | null; status: number }) => HtmlNode;
  /** Rendered right after `<meta viewport>` — metadata, preloads, critical CSS. */
  renderHeadStart?: (args: { seo: ResolvedMetadata; cspNonce?: string | undefined }) => HtmlNode;
  /** Rendered last in `<head>` — analytics bootstrap and the like. */
  renderHeadEnd?: (args: { cspNonce?: string | undefined; isBot: boolean }) => HtmlNode;
  renderLayout: (args: {
    shell: Shell;
    pageMeta: PageAnalyticsMeta;
    children: HtmlNode;
  }) => HtmlNode;
};
