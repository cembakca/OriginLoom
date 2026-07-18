import type { Assets } from "@server/assets";
import { config } from "@server/config";
import { renderDocument, renderDocumentToStream, streamToString } from "@server/document";
import { logError } from "@server/logger";
import { SpanKind, withSpan } from "@server/observability";
import { renderRouteErrorDocument } from "@server/route-boundary";

import { isBotRequest } from "~/components/analytics/gtm-bootstrap";
import type { Ctx, Route } from "~/lib/types";

import { rethrowRequestDeadline } from "./context";
import type { RenderPhase, RouteExecution } from "./types";

export class CacheFillTimeoutError extends Error {
  constructor() {
    super(`Cold cache fill exceeded ${config.cacheFillTimeoutMs}ms`);
    this.name = "CacheFillTimeoutError";
  }
}

export async function executeRouteWithBudget(
  route: Route,
  routeCtx: Ctx,
  assets: Assets,
): Promise<RouteExecution> {
  const controller = new AbortController();
  const timeoutError = new CacheFillTimeoutError();
  const timer = setTimeout(() => controller.abort(timeoutError), config.cacheFillTimeoutMs);
  timer.unref?.();
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(timeoutError), { once: true });
  });
  const budgetCtx: Ctx = {
    ...routeCtx,
    request: new Request(routeCtx.request, {
      signal: AbortSignal.any([routeCtx.request.signal, controller.signal]),
    }),
  };

  try {
    return await Promise.race([executeRoute(route, budgetCtx, assets, "cache_fill"), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function executeRoute(
  route: Route,
  routeCtx: Ctx,
  assets: Assets,
  phase: RenderPhase,
): Promise<RouteExecution> {
  const result = await runLoader(route, routeCtx, phase);
  if (result.kind && result.kind !== "data") return { result };

  const shouldStream = route.streaming && phase === "request" && !isBotRequest(routeCtx.request);
  if (!shouldStream) {
    return { result, body: await runRender(route, result.data, assets, routeCtx, phase) };
  }

  try {
    const streamResult = await renderDocumentToStream(
      route,
      result.data,
      assets,
      { routeCtx },
      (error) => {
        logError(error, {
          requestId: routeCtx.trackingId,
          msg: "deferred stream render error",
          path: routeCtx.url.pathname,
        });
      },
    );
    routeCtx.request.signal.addEventListener("abort", () => streamResult.abort());
    return { result, streamResult };
  } catch (error) {
    rethrowRequestDeadline(routeCtx.request, error);
    logError(error, { msg: "stream shell render failed", path: routeCtx.url.pathname });
    const body = await renderRouteErrorDocument(assets, routeCtx, route, null, 500);
    return {
      result: {
        kind: "error",
        error: { code: "stream_shell_error", message: "Stream shell render error" },
      },
      body,
    };
  }
}

export function runLoader(route: Route, routeCtx: Ctx, phase: RenderPhase) {
  return withSpan(
    "route.loader",
    {
      kind: SpanKind.INTERNAL,
      attributes: { "http.route": route.path, "ssr.phase": phase },
    },
    () => route.loader(routeCtx),
  );
}

export async function runRender<T>(
  route: Route<T>,
  data: T,
  assets: Assets,
  routeCtx: Ctx,
  phase: RenderPhase,
): Promise<string> {
  return withSpan(
    "ssr.render",
    {
      kind: SpanKind.INTERNAL,
      attributes: { "http.route": route.path, "ssr.phase": phase },
    },
    async () => {
      if (!route.streaming) return renderDocument(route, data, assets, { routeCtx });

      const streamResult = await renderDocumentToStream(
        route,
        data,
        assets,
        { routeCtx },
        (error) => {
          logError(error, {
            requestId: routeCtx.trackingId,
            msg: "runRender stream error",
            path: routeCtx.url.pathname,
          });
        },
      );
      await streamResult.allReady;
      return streamToString(streamResult.stream);
    },
  );
}
