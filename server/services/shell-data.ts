import { GatewayPayloadError } from "@server/gateway-payload";
import { logger } from "@server/logger";
import { observeShellDegradation } from "@server/metrics";

import { buildLayoutClientProps, type ShellData } from "~/lib/shell-data";
import type { Ctx } from "~/lib/types";

import { fetchMenuList } from "./menu";

export async function buildShellData(
  ctx: Ctx,
  opts?: { minimalChrome?: boolean },
): Promise<ShellData> {
  const base = buildLayoutClientProps(ctx, opts);
  if (base.minimalChrome) return { ...base, menu: null };

  try {
    const menu = await fetchMenuList(ctx.request, base.deviceType);
    return { ...base, menu };
  } catch (error) {
    const reason = error instanceof GatewayPayloadError ? "invalid_payload" : "gateway_error";
    observeShellDegradation("menu", reason);
    logger.warn("shell menu degraded", {
      requestId: ctx.request.headers.get("x-request-id") ?? undefined,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ...base,
      menu: { headerItems: [], hamburgerItems: [], footerItems: [] },
    };
  }
}
