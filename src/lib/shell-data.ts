import { cookie } from "./request";
import { Cookie } from "./cookies";
import type { Ctx } from "./types";
import type { PageAnalyticsMeta } from "./analytics/types";

/** Cache-safe props for layout-client island — no trackingId, no auth tokens. */
export type LayoutClientProps = {
  publicPath: string;
  pathname: string;
  search: string;
  theme?: string;
  minimalChrome?: boolean;
};

export function buildLayoutClientProps(ctx: Ctx, opts?: { minimalChrome?: boolean }): LayoutClientProps {
  return {
    publicPath: ctx.publicPath,
    pathname: ctx.url.pathname,
    search: ctx.url.search,
    theme: cookie(ctx.request, Cookie.theme),
    minimalChrome: opts?.minimalChrome,
  };
}

export function defaultPageMeta(ctx: Ctx, pageType: string, extra?: Partial<PageAnalyticsMeta>): PageAnalyticsMeta {
  return {
    pageType,
    publicPath: ctx.publicPath,
    search: ctx.url.search,
    ...extra,
  };
}
