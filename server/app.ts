import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { compress } from "hono/compress";
import { HTTPException } from "hono/http-exception";

import { stripUndefined } from "~/lib/strip-undefined";
import type { Route } from "~/lib/types";
import { normalizePublicUrl } from "~/routing";

import { mountApi } from "./api";
import type { Assets } from "./assets";
import { pingCache } from "./cache";
import { resolveTrustedClientIp } from "./client-ip";
import { config } from "./config";
import { errorResponse } from "./error";
import { handle, handleHead, isSsrRouteRequest, methodNotAllowedResponse } from "./handler";
import { logError } from "./logger";
import { observeRequest } from "./metrics";
import {
  finalizePipelineResponse,
  finalizeSsrResponse,
  runPipeline,
  shouldUsePipeline,
} from "./middleware/pipeline";
import { publicBodyLimit } from "./middleware/public-body-limit";
import { contextRequest, requestDeadline } from "./middleware/request-deadline";
import { type AppVariables, requestId } from "./middleware/request-id";
import { securityMiddleware } from "./middleware/security";
import { staticAssetCacheHeaders } from "./middleware/static-assets";
import { setActiveHttpRoute, SpanStatusCode, withRequestSpan } from "./observability";
import { publicUrlErrorResponse, publicUrlRedirectResponse } from "./public-url";
import { routes as defaultRoutes } from "./routes";
import { mountSeoRoutes } from "./seo";
import {
  ssrCapacity as defaultSsrCapacity,
  SsrCapacityError,
  ssrCapacityResponse,
} from "./ssr-capacity";

type Capacity = {
  run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T>;
};

const clientIpMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  c.set("clientIp", resolveClientIp(c));
  await next();
};

export type CreateAppOptions = {
  assets: Assets;
  routes?: Route[];
  isShuttingDown?: () => boolean;
  readinessCheck?: () => Promise<boolean>;
  cacheRequired?: boolean;
  capacity?: Capacity;
};

export function createApp(options: CreateAppOptions): Hono<{ Variables: AppVariables }> {
  const routeTable = options.routes ?? defaultRoutes;
  const isShuttingDown = options.isShuttingDown ?? (() => false);
  const readinessCheck = options.readinessCheck ?? pingCache;
  const cacheRequired = options.cacheRequired ?? config.cacheRequired;
  const capacity = options.capacity ?? defaultSsrCapacity;
  const app = new Hono<{ Variables: AppVariables }>();

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    logError(error, {
      msg: "unhandled Hono application error",
      requestId: c.get("requestId"),
      path: new URL(c.req.url).pathname,
    });
    const response = errorResponse(options.assets);
    response.headers.set("cache-control", "private, no-store");
    const requestIdValue = c.get("requestId");
    if (requestIdValue) response.headers.set("x-request-id", requestIdValue);
    return response;
  });
  app.notFound((c) => {
    const request = contextRequest(c);
    const handleContext = {
      requestId: c.get("requestId"),
      clientIp: c.get("clientIp") ?? resolveClientIp(c),
      ...stripUndefined({ cspNonce: c.get("cspNonce") }),
    };
    return request.method === "HEAD"
      ? handleHead(request, routeTable, handleContext)
      : handle(request, routeTable, options.assets, handleContext);
  });

  app.use("*", requestId);
  app.use("*", clientIpMiddleware);
  app.use("*", requestDeadline(routeTable));
  app.use("*", async (c, next) => {
    await withRequestSpan(contextRequest(c), c.get("requestId"), async (span) => {
      await next();
      span.setAttribute("http.response.status_code", c.res.status);
      span.setAttribute("ssr.cache.state", c.res.headers.get("x-cache") ?? "NONE");
      if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    });
  });
  app.use("*", securityMiddleware);
  app.use("*", compress());
  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    observeRequest(
      c.res.status,
      c.res.headers.get("x-cache") ?? "NONE",
      performance.now() - started,
      c.get("requestRoute") ?? "<unmatched>",
    );
  });
  app.use("*", async (c, next) => {
    const normalized = normalizePublicUrl(new URL(c.req.url));
    if (normalized.kind === "invalid") {
      return publicUrlErrorResponse(c.get("requestId"));
    }
    if (normalized.kind === "redirect") {
      return publicUrlRedirectResponse(normalized.location, c.get("requestId"));
    }
    await next();
  });
  app.use("*", publicBodyLimit(config.proxyBodyLimitBytes));

  app.use("/assets/*", staticAssetCacheHeaders);
  app.use("/assets/*", serveStatic({ root: "./dist/client" }));

  app.get("/healthz", (c) => {
    c.set("requestRoute", "<health>");
    return c.text("ok");
  });
  app.all("/metrics", (c) => c.body(null, 404, { "cache-control": "private, no-store" }));
  app.get("/readyz", async (c) => {
    c.set("requestRoute", "<health>");
    if (isShuttingDown()) return c.text("shutting down", 503);
    const ok = await readinessCheck();
    return ok || !cacheRequired ? c.text("ok") : c.text("cache unavailable", 503);
  });

  mountSeoRoutes(app, config.siteUrl);
  mountApi(app);

  app.all("*", async (c) => {
    if (isShuttingDown()) return c.text("shutting down", 503);

    const requestIdValue = c.get("requestId");
    const cspNonce = c.get("cspNonce");
    const request = contextRequest(c);
    const pathname = new URL(request.url).pathname;
    const clientIp = c.get("clientIp") ?? resolveClientIp(c);
    const method = request.method.toUpperCase();
    const ssrRoute = isSsrRouteRequest(request, routeTable);

    if (ssrRoute && method !== "GET" && method !== "HEAD") {
      setActiveHttpRoute(method, "<method-not-allowed>");
      return methodNotAllowedResponse(requestIdValue);
    }
    if (!ssrRoute && c.get("requestClass") === "ssr" && !shouldUsePipeline(pathname)) {
      return c.notFound();
    }

    const execute = async (): Promise<Response> => {
      if (shouldUsePipeline(pathname)) {
        const pipeline = await runPipeline(request, requestIdValue, clientIp);

        if (pipeline.response) {
          const pipelineResponse = finalizePipelineResponse(pipeline);
          const response = method === "HEAD" ? withoutBody(pipelineResponse) : pipelineResponse;
          if (requestIdValue) response.headers.set("x-request-id", requestIdValue);
          return response;
        }

        const handleContext = {
          requestId: requestIdValue,
          clientIp,
          ...stripUndefined({ trackingId: pipeline.trackingId, cspNonce }),
        };
        const ssr =
          method === "HEAD"
            ? await handleHead(pipeline.request, routeTable, handleContext)
            : await handle(pipeline.request, routeTable, options.assets, handleContext);
        const response = finalizeSsrResponse(ssr, pipeline);
        if (requestIdValue) response.headers.set("x-request-id", requestIdValue);
        return response;
      }

      return method === "HEAD"
        ? handleHead(request, routeTable, {
            requestId: requestIdValue,
            clientIp,
            ...stripUndefined({ cspNonce }),
          })
        : handle(request, routeTable, options.assets, {
            requestId: requestIdValue,
            clientIp,
            ...stripUndefined({ cspNonce }),
          });
    };

    if (c.get("requestClass") !== "ssr") return execute();
    try {
      return await capacity.run(request.signal, execute);
    } catch (error) {
      if (error instanceof SsrCapacityError) {
        return ssrCapacityResponse(error, requestIdValue);
      }
      throw error;
    }
  });

  return app;
}

function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function resolveClientIp(c: Context<{ Variables: AppVariables }>): string {
  let remote = "127.0.0.1";
  try {
    remote = getConnInfo(c).remote.address ?? remote;
  } catch {
    // app.request() and non-Node adapters do not provide node-server connection info.
  }
  return resolveTrustedClientIp(remote, c.req.raw.headers, config.trustProxy);
}
