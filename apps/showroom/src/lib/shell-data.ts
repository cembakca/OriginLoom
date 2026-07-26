import type { Ctx } from "@originloom/react/lib/types";
import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import { Cookie } from "@originloom/shared/lib/cookies";
import type { DeviceType } from "@originloom/shared/lib/device";
import { deviceCacheFragment, getDeviceShell } from "@originloom/shared/lib/device";
import type { IMenuItems } from "@originloom/shared/lib/menu/types";
import { cookie } from "@originloom/shared/lib/request";

/** Cache-safe props for layout-client island — no trackingId, no auth tokens. */
export type LayoutClientProps = {
  publicPath: string;
  pathname: string;
  theme?: string;
  minimalChrome?: boolean;
  deviceType: DeviceType;
  deviceShell: "desktop" | "mobile";
};

export type ShellData = LayoutClientProps & {
  menu: IMenuItems | null;
};

export function buildLayoutClientProps(
  ctx: Ctx,
  opts?: { minimalChrome?: boolean | undefined },
): LayoutClientProps {
  const deviceType = deviceCacheFragment(ctx.request);
  const theme = cookie(ctx.request, Cookie.theme);
  return {
    publicPath: ctx.publicPath,
    pathname: ctx.url.pathname,
    ...(theme !== undefined ? { theme } : {}),
    ...(opts?.minimalChrome !== undefined ? { minimalChrome: opts.minimalChrome } : {}),
    deviceType,
    deviceShell: getDeviceShell(deviceType),
  };
}

/** Root layout shell — tek menu fetch, Header + Footer SSR'da kullanır. */
/** HTML cache key'e ekle — shell device'a göre değişir. */
export function layoutCacheFragment(ctx: Ctx): string {
  return deviceCacheFragment(ctx.request);
}

export function defaultPageMeta(
  ctx: Ctx,
  pageType: string,
  extra?: Partial<PageAnalyticsMeta>,
): PageAnalyticsMeta {
  return {
    pageType,
    publicPath: ctx.publicPath,
    ...extra,
  };
}
