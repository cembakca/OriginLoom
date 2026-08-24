import { stripUndefined } from "@originloom/shared/lib/strip-undefined";
import type { Route } from "@originloom/shared/lib/types";
import type { Handler } from "hono";

import type { Assets } from "../assets.js";
import { config } from "../config.js";
import { earlyHintLinks, sendEarlyHints, shouldSendEarlyHints } from "../early-hints.js";
import {
  crossOriginSubmissionResponse,
  handle,
  handleHead,
  matchedSsrRoute,
  methodNotAllowedResponse,
  renderHandle,
  renderHeadRoute,
  resolveHandleRequest,
  resolveHeadRoute,
  tryCachedHandle,
  tryServeCachedHead,
} from "../handler.js";
import { observeEarlyHints } from "../metrics.js";
import {
  finalizePipelineResponse,
  finalizeSsrResponse,
  type Pipeline,
  shouldUsePipeline,
} from "../middleware/pipeline.js";
import { contextRequest } from "../middleware/request-deadline.js";
import type { AppVariables } from "../middleware/request-id.js";
import { setActiveHttpRoute } from "../observability.js";
import { isSameOriginBrowserRequest } from "../security/public-api-guard.js";
import { SsrCapacityError, ssrCapacityResponse } from "../ssr-capacity.js";

export type Capacity = {
  run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T>;
};

type SsrDispatchOptions = {
  assets: Assets;
  routes: Route[];
  capacity: Capacity;
  isShuttingDown: () => boolean;
  pipeline: Pipeline;
};

// x-request-id is owned by the outer `requestId` Hono middleware (middleware/request-id.ts),
// which stamps the header on the final response after this handler returns. Individual
// paths below do not set it themselves — see OR3 in CACHE_PERFORMANCE_ROADMAP.md.
export function createSsrDispatch({
  assets,
  routes,
  capacity,
  isShuttingDown,
  pipeline,
}: SsrDispatchOptions): Handler<{ Variables: AppVariables }> {
  return async (c) => {
    if (isShuttingDown()) return c.text("shutting down", 503);

    const requestId = c.get("requestId");
    const cspNonce = c.get("cspNonce");
    const request = contextRequest(c);
    const preparedRequest = c.get("preparedRequest");
    const pathname = preparedRequest?.url.pathname ?? new URL(request.url).pathname;
    const clientIp = c.get("clientIp") ?? "127.0.0.1";
    const method = request.method.toUpperCase();
    const matchedRoute = matchedSsrRoute(request, routes, preparedRequest);
    const ssrRoute = matchedRoute !== null;

    if (ssrRoute && method !== "GET" && method !== "HEAD") {
      // A page that declares an action accepts submissions to its own path; one
      // that does not still answers 405 rather than rendering, because a POST
      // that quietly returns the page tells the sender their write succeeded.
      if (!matchedRoute.action) {
        setActiveHttpRoute(method, "<method-not-allowed>");
        return methodNotAllowedResponse(requestId);
      }
      // A form action is a state change, and the only evidence a browser offers
      // that the submission came from this site is the origin it reports — the
      // same check the public API guard applies to every mutation.
      if (!isSameOriginBrowserRequest(request)) {
        setActiveHttpRoute(method, matchedRoute.path);
        return crossOriginSubmissionResponse(requestId);
      }
    }
    if (!ssrRoute && c.get("requestClass") === "ssr" && !shouldUsePipeline(pathname)) {
      return c.notFound();
    }

    const requestOptions = {
      request,
      requestId,
      clientIp,
      ...stripUndefined({ cspNonce }),
      method,
      pathname,
      routes,
      assets,
      pipeline,
      ...stripUndefined({ preparedRequest }),
    };

    if (c.get("requestClass") !== "ssr") {
      return executeRequest(requestOptions);
    }

    try {
      return await executeSsrRequest({
        ...requestOptions,
        capacity,
        // Handed down rather than sent here: the only moment a 103 is worth its
        // write is after the cache has missed, when the socket is about to sit
        // idle waiting on an upstream. Sending it before that would hint every
        // cache HIT for nothing.
        onFreshRender: () => {
          if (
            !shouldSendEarlyHints({
              enabled: config.earlyHints,
              method,
              isDocumentRequest: ssrRoute,
              willRenderFresh: true,
            })
          ) {
            return;
          }
          const sent = sendEarlyHints(
            (c.env as { outgoing?: unknown } | undefined)?.outgoing,
            earlyHintLinks(assets),
          );
          if (sent) observeEarlyHints();
        },
      });
    } catch (error) {
      if (error instanceof SsrCapacityError) return ssrCapacityResponse(error, requestId);
      throw error;
    }
  };
}

type RequestOptions = {
  request: Request;
  requestId: string;
  clientIp: string;
  cspNonce?: string;
  method: string;
  pathname: string;
  routes: Route[];
  assets: Assets;
  pipeline: Pipeline;
  preparedRequest?: NonNullable<AppVariables["preparedRequest"]>;
};

async function executeSsrRequest(
  options: RequestOptions & { capacity: Capacity; onFreshRender: () => void },
): Promise<Response> {
  const outcome = await tryServeFromCache(options);
  if ("response" in outcome) return outcome.response;
  options.onFreshRender();
  return options.capacity.run(options.request.signal, outcome.render);
}

async function tryServeFromCache(
  options: RequestOptions,
): Promise<{ response: Response } | { render: () => Promise<Response> }> {
  if (!shouldUsePipeline(options.pathname)) {
    if (options.method === "HEAD") {
      const context = buildContext(options);
      const resolved = await resolveHeadRoute(options.request, options.routes, context);
      if (resolved instanceof Response) {
        return { response: resolved };
      }
      const cached = await tryServeCachedHead(resolved, options.requestId);
      if (cached) {
        return { response: cached };
      }
      return {
        render: () => renderHeadRoute(resolved, options.requestId),
      };
    }

    const context = buildContext(options);
    const resolved = await resolveHandleRequest(
      options.request,
      options.routes,
      options.assets,
      context,
    );
    if (resolved.kind === "response") {
      return { response: resolved.response };
    }
    const cached = await tryCachedHandle(resolved.serveOptions);
    if (cached) {
      return { response: cached };
    }
    return {
      render: () => renderHandle(resolved.serveOptions),
    };
  }

  const pipeline = await options.pipeline(
    options.request,
    options.requestId,
    options.clientIp,
    options.preparedRequest?.url,
  );
  if (pipeline.response) {
    const response =
      options.method === "HEAD"
        ? withoutBody(finalizePipelineResponse(pipeline))
        : finalizePipelineResponse(pipeline);
    return { response };
  }

  const handleContext = {
    ...buildContext(options),
    ...stripUndefined({
      trackingId: pipeline.trackingId,
      values: pipeline.values,
      cacheVary: pipeline.cacheVary,
    }),
  };

  if (options.method === "HEAD") {
    const resolved = await resolveHeadRoute(pipeline.request, options.routes, handleContext);
    if (resolved instanceof Response) {
      return { response: finalizeSsrResponse(resolved, pipeline) };
    }
    const cached = await tryServeCachedHead(resolved, options.requestId);
    if (cached) {
      return { response: finalizeSsrResponse(cached, pipeline) };
    }
    return {
      render: async () => {
        const ssr = await renderHeadRoute(resolved, options.requestId);
        return finalizeSsrResponse(ssr, pipeline);
      },
    };
  }

  const resolved = await resolveHandleRequest(
    pipeline.request,
    options.routes,
    options.assets,
    handleContext,
  );
  if (resolved.kind === "response") {
    return { response: finalizeSsrResponse(resolved.response, pipeline) };
  }
  const cached = await tryCachedHandle(resolved.serveOptions);
  if (cached) {
    return { response: finalizeSsrResponse(cached, pipeline) };
  }
  return {
    render: async () => {
      const ssr = await renderHandle(resolved.serveOptions);
      return finalizeSsrResponse(ssr, pipeline);
    },
  };
}

async function executeRequest(options: RequestOptions): Promise<Response> {
  if (!shouldUsePipeline(options.pathname)) {
    const context = buildContext(options);
    return options.method === "HEAD"
      ? handleHead(options.request, options.routes, context)
      : handle(options.request, options.routes, options.assets, context);
  }

  const pipeline = await options.pipeline(
    options.request,
    options.requestId,
    options.clientIp,
    options.preparedRequest?.url,
  );
  if (pipeline.response) {
    return options.method === "HEAD"
      ? withoutBody(finalizePipelineResponse(pipeline))
      : finalizePipelineResponse(pipeline);
  }

  const handleContext = {
    ...buildContext(options),
    ...stripUndefined({
      trackingId: pipeline.trackingId,
      values: pipeline.values,
      cacheVary: pipeline.cacheVary,
    }),
  };
  const ssr =
    options.method === "HEAD"
      ? await handleHead(pipeline.request, options.routes, handleContext)
      : await handle(pipeline.request, options.routes, options.assets, handleContext);
  return finalizeSsrResponse(ssr, pipeline);
}

function buildContext(options: RequestOptions) {
  return {
    requestId: options.requestId,
    clientIp: options.clientIp,
    ...stripUndefined({
      cspNonce: options.cspNonce,
      preparedRequest: options.preparedRequest,
    }),
  };
}

function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
