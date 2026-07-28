import { GatewayPayloadError } from "@originloom/core/gateway-payload";
import { logger } from "@originloom/core/logger";
import { observeShellDegradation } from "@originloom/core/metrics";
import { isRequestDeadlineError } from "@originloom/core/middleware/request-deadline";
import type { Ctx } from "@originloom/react/lib/types";

import { buildLayoutClientProps, type ShellData } from "~/lib/shell-data";

import { fetchMenuList } from "./menu";

export async function buildShellData(
  ctx: Ctx,
  opts?: { minimalChrome?: boolean | undefined },
): Promise<ShellData> {
  const base = buildLayoutClientProps(ctx, opts);
  if (base.minimalChrome) return { ...base, menu: null };

  try {
    const menu = await fetchMenuList(ctx.request, base.deviceType);
    return { ...base, menu };
  } catch (error) {
    if (isRequestDeadlineError(ctx.request.signal.reason)) throw ctx.request.signal.reason;
    if (isRequestDeadlineError(error)) throw error;
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
