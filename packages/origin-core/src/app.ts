import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { stripUndefined } from "@originloom/shared/lib/strip-undefined";
import type { Route } from "@originloom/shared/lib/types";
import { normalizePublicUrl } from "@originloom/shared/routing";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { compress } from "hono/compress";
import { HTTPException } from "hono/http-exception";

import { type Capacity, createSsrDispatch } from "./app/ssr-dispatch.js";
import type { Assets } from "./assets.js";
import { pingCache } from "./cache/index.js";
import { resolveTrustedClientIp } from "./client-ip.js";
import { config } from "./config.js";
import { errorResponse } from "./error.js";
import { handle, handleHead } from "./handler.js";
import { logError } from "./logger.js";
import { observeRequest } from "./metrics.js";
import { publicBodyLimit } from "./middleware/public-body-limit.js";
import { contextRequest, requestDeadline } from "./middleware/request-deadline.js";
import { type AppVariables, requestId } from "./middleware/request-id.js";
import { securityMiddleware } from "./middleware/security.js";
import { staticAssetCacheHeaders } from "./middleware/static-assets.js";
import { SpanStatusCode, withRequestSpan } from "./observability.js";
import { publicUrlErrorResponse, publicUrlRedirectResponse } from "./public-url.js";
import { ssrCapacity as defaultSsrCapacity } from "./ssr-capacity.js";

const clientIpMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  c.set("clientIp", resolveClientIp(c));
  await next();
};

export type AppMounts = {
  /** Product BFF/API routes (mounted after health/readiness, before SSR dispatch). */
  api?: (app: Hono<{ Variables: AppVariables }>) => void;
  /** SEO routes (robots.txt, sitemap) — product decides whether and how. */
  seo?: (app: Hono<{ Variables: AppVariables }>, siteUrl: string) => void;
};

export type CreateAppOptions = {
  assets: Assets;
  routes: Route[];
  mounts?: AppMounts;
  /** Static asset root served under /assets/*. Defaults to the local client build. */
  staticRoot?: string;
  isShuttingDown?: () => boolean;
  readinessCheck?: () => Promise<boolean>;
  cacheRequired?: boolean;
  capacity?: Capacity;
};

export function createApp(options: CreateAppOptions): Hono<{ Variables: AppVariables }> {
  const routeTable = options.routes;
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
  app.use("/assets/*", serveStatic({ root: options.staticRoot ?? config.clientDistDir }));

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

  options.mounts?.seo?.(app, config.siteUrl);
  options.mounts?.api?.(app);

  app.all(
    "*",
    createSsrDispatch({ assets: options.assets, routes: routeTable, capacity, isShuttingDown }),
  );

  return app;
}

function resolveClientIp(c: Context<{ Variables: AppVariables }>): string {
  let remote = "127.0.0.1";
  try {
    remote = getConnInfo(c).remote.address ?? remote;
  } catch {
    // app.request() and non-Node adapters do not provide node-server connection info.
  }
  return resolveTrustedClientIp(remote, c.req.raw.headers, {
    enabled: config.trustProxy,
    hops: config.trustedProxyHops,
    cidrs: config.trustedProxyCidrs,
  });
}
