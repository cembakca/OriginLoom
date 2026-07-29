import { stripUndefined } from "@originloom/shared/lib/strip-undefined";
import type { Route } from "@originloom/shared/lib/types";
import type { Handler } from "hono";

import type { Assets } from "../assets.js";
import { handle, handleHead, isSsrRouteRequest, methodNotAllowedResponse } from "../handler.js";
import {
  finalizePipelineResponse,
  finalizeSsrResponse,
  runPipeline,
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
};

export function createSsrDispatch({
  assets,
  routes,
  capacity,
  isShuttingDown,
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

    const execute = () =>
      executeRequest({
        request,
        requestId,
        clientIp,
        ...stripUndefined({ cspNonce }),
        method,
        pathname,
        routes,
        assets,
        ...stripUndefined({ preparedRequest }),
      });

    if (c.get("requestClass") !== "ssr") return execute();
    try {
      return await capacity.run(request.signal, execute);
    } catch (error) {
      if (error instanceof SsrCapacityError) return ssrCapacityResponse(error, requestId);
      throw error;
    }
  };
}

async function executeRequest(options: {
  request: Request;
  requestId: string;
  clientIp: string;
  cspNonce?: string;
  method: string;
  pathname: string;
  routes: Route[];
  assets: Assets;
  preparedRequest?: NonNullable<AppVariables["preparedRequest"]>;
}): Promise<Response> {
  const {
    request,
    requestId,
    clientIp,
    cspNonce,
    method,
    pathname,
    routes,
    assets,
    preparedRequest,
  } = options;
  const context = {
    requestId,
    clientIp,
    ...stripUndefined({ cspNonce, preparedRequest }),
  };
  if (!shouldUsePipeline(pathname)) {
    return method === "HEAD"
      ? handleHead(request, routes, context)
      : handle(request, routes, assets, context);
  }

  const pipeline = await runPipeline(request, requestId, clientIp, preparedRequest?.url);
  if (pipeline.response) {
    const response =
      method === "HEAD"
        ? withoutBody(finalizePipelineResponse(pipeline))
        : finalizePipelineResponse(pipeline);
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const handleContext = {
    ...context,
    ...stripUndefined({ trackingId: pipeline.trackingId }),
  };
  const ssr =
    method === "HEAD"
      ? await handleHead(pipeline.request, routes, handleContext)
      : await handle(pipeline.request, routes, assets, handleContext);
  const response = finalizeSsrResponse(ssr, pipeline);
  response.headers.set("x-request-id", requestId);
  return response;
}

function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
