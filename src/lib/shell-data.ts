import { fetchMenuList } from "~/services/menu";

import type { PageAnalyticsMeta } from "./analytics/types";
import { Cookie } from "./cookies";
import type { DeviceType } from "./device";
import { deviceCacheFragment, getDeviceShell } from "./device";
import type { IMenuItems } from "./menu/types";
import { cookie } from "./request";
import type { Ctx } from "./types";

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
  opts?: { minimalChrome?: boolean },
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
export async function buildShellData(
  ctx: Ctx,
  opts?: { minimalChrome?: boolean },
): Promise<ShellData> {
  const base = buildLayoutClientProps(ctx, opts);
  if (base.minimalChrome) return { ...base, menu: null };

  const menu = await fetchMenuList(ctx.request, base.deviceType);
  return { ...base, menu };
}

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
