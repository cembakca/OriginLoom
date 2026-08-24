import { randomUUID } from "node:crypto";

import type { Ctx, Route } from "@originloom/shared/lib/types";

import type { Assets } from "../assets.js";
import { cachedHtmlDynamicValues } from "../cache/dynamic-html.js";
import { config } from "../config.js";
import { renderDocument, renderDocumentToStream, streamToString } from "../document.js";
import { logError } from "../logger.js";
import { observePayloadSize, observeSerialization } from "../metrics.js";
import { SpanKind, withSpan } from "../observability.js";
import { getRuntime } from "../runtime.js";
import { createShellResolution, type ShellResolution } from "../shell-resolution.js";
import { rethrowRequestDeadline } from "./context.js";
import type { RenderPhase, RouteExecution } from "./types.js";

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
  const shellResolution = createShellResolution(
    routeCtx,
    route.path,
    route.minimalChrome === undefined ? {} : { minimalChrome: route.minimalChrome },
  );
  // The loader and the render are the two sequential phases of a response, so
  // timing them separately is what turns "this page took 1700ms" into "the
  // gateway took 1400 of it". They ride out on Server-Timing in development.
  const loaderStarted = performance.now();
  let result;
  try {
    result = await runLoader(route, routeCtx, phase);
  } catch (error) {
    shellResolution.abort(error);
    throw error;
  }
  const loaderMs = performance.now() - loaderStarted;
  if (result.kind && result.kind !== "data") {
    shellResolution.abort();
    return { result };
  }

  const shouldStream =
    route.streaming && phase === "request" && !getRuntime().document.isBotRequest(routeCtx.request);
  const renderStarted = performance.now();
  if (!shouldStream) {
    try {
      const body = await runRender(route, result.data, assets, routeCtx, phase, shellResolution);
      return {
        result,
        body,
        shellResolution,
        timings: { loaderMs, renderMs: performance.now() - renderStarted },
      };
    } catch (error) {
      shellResolution.abort(error);
      throw error;
    }
  }

  try {
    const streamResult = await renderDocumentToStream(
      route,
      result.data,
      assets,
      { routeCtx, shellResolution, includeRequestOverlay: phase === "request" },
      (error) => {
        logError(error, {
          requestId: routeCtx.trackingId,
          msg: "deferred stream render error",
          path: routeCtx.url.pathname,
        });
      },
    );
    routeCtx.request.signal.addEventListener("abort", () => streamResult.abort());
    // A streamed render returns once the shell is ready, not once the body is
    // finished — the headers leave at that moment too, so this is the phase the
    // header can honestly describe.
    return {
      result,
      streamResult,
      shellResolution,
      timings: { loaderMs, renderMs: performance.now() - renderStarted },
    };
  } catch (error) {
    shellResolution.abort(error);
    rethrowRequestDeadline(routeCtx.request, error);
    const errorId = randomUUID();
    logError(error, {
      msg: "stream shell render failed",
      errorId,
      requestId: routeCtx.pageRequestId,
      path: routeCtx.url.pathname,
    });
    return {
      result: {
        kind: "error",
        error: { code: "stream_shell_error", message: "Stream shell render error" },
      },
      errorId,
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
  shellResolution?: ShellResolution,
): Promise<string> {
  const cachedValues = cachedHtmlDynamicValues(routeCtx);
  const hasCachedValues = Object.keys(cachedValues).length > 0;
  const renderCtx =
    phase === "request" || !hasCachedValues ? routeCtx : { ...routeCtx, ...cachedValues };
  return withSpan(
    "ssr.render",
    {
      kind: SpanKind.INTERNAL,
      attributes: { "http.route": route.path, "ssr.phase": phase },
    },
    async () => {
      const started = performance.now();
      if (!route.streaming) {
        const body = await renderDocument(route, data, assets, {
          routeCtx: renderCtx,
          ...(shellResolution ? { shellResolution } : {}),
          includeRequestOverlay: phase === "request",
        });
        observeSerialization("document_render", route.path, performance.now() - started);
        observePayloadSize("html", route.path, Buffer.byteLength(body));
        return body;
      }

      const streamResult = await renderDocumentToStream(
        route,
        data,
        assets,
        {
          routeCtx: renderCtx,
          ...(shellResolution ? { shellResolution } : {}),
          includeRequestOverlay: phase === "request",
        },
        (error) => {
          logError(error, {
            requestId: routeCtx.trackingId,
            msg: "runRender stream error",
            path: routeCtx.url.pathname,
          });
        },
      );
      await streamResult.allReady;
      const body = await streamToString(streamResult.stream);
      observeSerialization("document_render", route.path, performance.now() - started);
      observePayloadSize("html", route.path, Buffer.byteLength(body));
      return body;
    },
  );
}
