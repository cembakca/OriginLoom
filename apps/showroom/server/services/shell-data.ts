import { GatewayPayloadError } from "@originloom/core/gateway-payload";
import { logger } from "@originloom/core/logger";
import { observeShellDegradation } from "@originloom/core/metrics";
import { isRequestDeadlineError } from "@originloom/core/middleware/request-deadline";
import type { ShellDependencyPlan } from "@originloom/core/runtime";
import type { Ctx } from "@originloom/react/lib/types";

import {
  buildLayoutClientProps,
  buildRequestOverlay,
  buildShellRequestFacts,
  type PublicShellSnapshot,
  type RequestOverlay,
  type ShellData,
  type ShellRequestFacts,
  type TargetedShell,
} from "~/lib/shell-data";

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
    if (ctx.request.signal.aborted) throw abortReason(ctx.request.signal);
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

export const shellDependencyPlan: ShellDependencyPlan<
  ShellData,
  ShellRequestFacts,
  PublicShellSnapshot,
  TargetedShell,
  RequestOverlay
> = {
  requestFacts: (ctx, options) => buildShellRequestFacts(ctx, options),
  loadPublicShellSnapshot: async (facts, { ctx }) => ({
    menu: facts.minimalChrome ? null : await loadMenu(ctx, facts.deviceType),
  }),
  buildTargetedShell: (snapshot, facts) => ({ ...facts, ...snapshot }),
  loadRequestOverlay: (_facts, { ctx }) => buildRequestOverlay(ctx),
  composeShell: ({ targetedShell, requestOverlay }) => ({
    ...targetedShell,
    ...(requestOverlay ?? {}),
  }),
  composeTerminalShell: ({ facts }) => ({ ...facts, menu: null }),
};

async function loadMenu(ctx: Ctx, deviceType: ShellRequestFacts["deviceType"]) {
  try {
    return await fetchMenuList(ctx.request, deviceType);
  } catch (error) {
    if (ctx.request.signal.aborted) throw abortReason(ctx.request.signal);
    if (isRequestDeadlineError(ctx.request.signal.reason)) throw ctx.request.signal.reason;
    if (isRequestDeadlineError(error)) throw error;
    const reason = error instanceof GatewayPayloadError ? "invalid_payload" : "gateway_error";
    observeShellDegradation("menu", reason);
    logger.warn("shell menu degraded", {
      requestId: ctx.request.headers.get("x-request-id") ?? undefined,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return { headerItems: [], hamburgerItems: [], footerItems: [] };
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}
