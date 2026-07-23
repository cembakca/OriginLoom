import { stripUndefined } from "@originloom/react/lib/strip-undefined";
import type { Route } from "@originloom/react/lib/types";
import type { Assets } from "@server/assets";
import { handle, handleHead, isSsrRouteRequest, methodNotAllowedResponse } from "@server/handler";
import {
  finalizePipelineResponse,
  finalizeSsrResponse,
  runPipeline,
  shouldUsePipeline,
} from "@server/middleware/pipeline";
import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { setActiveHttpRoute } from "@server/observability";
import { SsrCapacityError, ssrCapacityResponse } from "@server/ssr-capacity";
import type { Handler } from "hono";

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
    const pathname = new URL(request.url).pathname;
    const clientIp = c.get("clientIp") ?? "127.0.0.1";
    const method = request.method.toUpperCase();
    const ssrRoute = isSsrRouteRequest(request, routes);

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
}): Promise<Response> {
  const { request, requestId, clientIp, cspNonce, method, pathname, routes, assets } = options;
  const context = { requestId, clientIp, ...stripUndefined({ cspNonce }) };
  if (!shouldUsePipeline(pathname)) {
    return method === "HEAD"
      ? handleHead(request, routes, context)
      : handle(request, routes, assets, context);
  }

  const pipeline = await runPipeline(request, requestId, clientIp);
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
