import { buildLayoutClientProps, type ShellData } from "~/lib/shell-data";
import type { Ctx } from "~/lib/types";

import { fetchMenuList } from "./menu";

export async function buildShellData(
  ctx: Ctx,
  opts?: { minimalChrome?: boolean },
): Promise<ShellData> {
  const base = buildLayoutClientProps(ctx, opts);
  if (base.minimalChrome) return { ...base, menu: null };

  const menu = await fetchMenuList(ctx.request, base.deviceType);
  return { ...base, menu };
}
