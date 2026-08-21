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

export type ShellRequestFacts = Omit<LayoutClientProps, "theme">;
export type PublicShellSnapshot = { menu: IMenuItems | null };
export type TargetedShell = ShellRequestFacts & PublicShellSnapshot;
export type RequestOverlay = Pick<LayoutClientProps, "theme">;

export function buildShellRequestFacts(
  ctx: Ctx,
  opts?: { minimalChrome?: boolean | undefined },
): ShellRequestFacts {
  const deviceType = deviceCacheFragment(ctx.request);
  return {
    publicPath: ctx.publicPath,
    pathname: ctx.url.pathname,
    ...(opts?.minimalChrome !== undefined ? { minimalChrome: opts.minimalChrome } : {}),
    deviceType,
    deviceShell: getDeviceShell(deviceType),
  };
}

export function buildRequestOverlay(ctx: Ctx): RequestOverlay {
  const theme = cookie(ctx.request, Cookie.theme);
  return theme === undefined ? {} : { theme };
}

export function buildLayoutClientProps(
  ctx: Ctx,
  opts?: { minimalChrome?: boolean | undefined },
): LayoutClientProps {
  return { ...buildShellRequestFacts(ctx, opts), ...buildRequestOverlay(ctx) };
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
