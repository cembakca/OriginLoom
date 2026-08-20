import { stripUndefined } from "@originloom/shared/lib/strip-undefined";
import type { Route } from "@originloom/shared/lib/types";
import type { Handler } from "hono";

import type { Assets } from "../assets.js";
import {
  handle,
  handleHead,
  isSsrRouteRequest,
  methodNotAllowedResponse,
  renderHandle,
  renderHeadRoute,
  resolveHandleRequest,
  resolveHeadRoute,
  tryCachedHandle,
  tryServeCachedHead,
} from "../handler.js";
import {
  finalizePipelineResponse,
  finalizeSsrResponse,
  type Pipeline,
  shouldUsePipeline,
} from "../middleware/pipeline.js";
import { contextRequest } from "../middleware/request-deadline.js";
import type { AppVariables } from "../middleware/request-id.js";
import { setActiveHttpRoute } from "../observability.js";
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
    const ssrRoute = isSsrRouteRequest(request, routes, preparedRequest);

    if (ssrRoute && method !== "GET" && method !== "HEAD") {
      setActiveHttpRoute(method, "<method-not-allowed>");
      return methodNotAllowedResponse(requestId);
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
      return await executeSsrRequest({ ...requestOptions, capacity });
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
  options: RequestOptions & { capacity: Capacity },
): Promise<Response> {
  const outcome = await tryServeFromCache(options);
  if ("response" in outcome) return outcome.response;
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
        resolved.headers.set("x-request-id", options.requestId);
        return { response: resolved };
      }
      const cached = await tryServeCachedHead(resolved, options.requestId);
      if (cached) {
        cached.headers.set("x-request-id", options.requestId);
        return { response: cached };
      }
      return {
        render: async () => {
          const response = await renderHeadRoute(resolved, options.requestId);
          response.headers.set("x-request-id", options.requestId);
          return response;
        },
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
      resolved.response.headers.set("x-request-id", options.requestId);
      return { response: resolved.response };
    }
    const cached = await tryCachedHandle(resolved.serveOptions);
    if (cached) {
      cached.headers.set("x-request-id", options.requestId);
      return { response: cached };
    }
    return {
      render: async () => {
        const response = await renderHandle(resolved.serveOptions);
        response.headers.set("x-request-id", options.requestId);
        return response;
      },
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
    response.headers.set("x-request-id", options.requestId);
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
      const response = finalizeSsrResponse(resolved, pipeline);
      response.headers.set("x-request-id", options.requestId);
      return { response };
    }
    const cached = await tryServeCachedHead(resolved, options.requestId);
    if (cached) {
      const response = finalizeSsrResponse(cached, pipeline);
      response.headers.set("x-request-id", options.requestId);
      return { response };
    }
    return {
      render: async () => {
        const ssr = await renderHeadRoute(resolved, options.requestId);
        const response = finalizeSsrResponse(ssr, pipeline);
        response.headers.set("x-request-id", options.requestId);
        return response;
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
    const response = finalizeSsrResponse(resolved.response, pipeline);
    response.headers.set("x-request-id", options.requestId);
    return { response };
  }
  const cached = await tryCachedHandle(resolved.serveOptions);
  if (cached) {
    const response = finalizeSsrResponse(cached, pipeline);
    response.headers.set("x-request-id", options.requestId);
    return { response };
  }
  return {
    render: async () => {
      const ssr = await renderHandle(resolved.serveOptions);
      const response = finalizeSsrResponse(ssr, pipeline);
      response.headers.set("x-request-id", options.requestId);
      return response;
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
    const response =
      options.method === "HEAD"
        ? withoutBody(finalizePipelineResponse(pipeline))
        : finalizePipelineResponse(pipeline);
    response.headers.set("x-request-id", options.requestId);
    return response;
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
  const response = finalizeSsrResponse(ssr, pipeline);
  response.headers.set("x-request-id", options.requestId);
  return response;
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
