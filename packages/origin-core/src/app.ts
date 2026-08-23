import { randomUUID } from "node:crypto";

import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { stripUndefined } from "@originloom/shared/lib/strip-undefined";
import type { Route } from "@originloom/shared/lib/types";
import { normalizePublicUrl } from "@originloom/shared/routing";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { compress } from "hono/compress";
import { HTTPException } from "hono/http-exception";

import { flushAfterTasks } from "./after.js";
import { type Capacity, createSsrDispatch } from "./app/ssr-dispatch.js";
import type { Assets } from "./assets.js";
import { pingCache } from "./cache/index.js";
import { resolveTrustedClientIp } from "./client-ip.js";
import { config } from "./config.js";
import { errorResponse } from "./error.js";
import { handle, handleHead } from "./handler.js";
import { logError } from "./logger.js";
import { observeRequest } from "./metrics.js";
import { createPipeline } from "./middleware/pipeline.js";
import type { OriginMiddleware } from "./middleware/product.js";
import { publicBodyLimit } from "./middleware/public-body-limit.js";
import { contextRequest, requestDeadline } from "./middleware/request-deadline.js";
import { type AppVariables, requestId } from "./middleware/request-id.js";
import { createSecurityMiddleware, type CspSources } from "./middleware/security.js";
import { staticAssetCacheHeaders } from "./middleware/static-assets.js";
import { SpanStatusCode, withRequestSpan } from "./observability.js";
import { publicUrlErrorResponse, publicUrlRedirectResponse } from "./public-url.js";
import { ssrCapacity as defaultSsrCapacity } from "./ssr-capacity.js";

export const DEV_SERVER_GENERATION_HEADER = "x-originloom-dev-generation";
const devServerGeneration = config.isProduction ? undefined : randomUUID();

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
  /**
   * Product middleware for document requests — locale, tenant, maintenance,
   * experiments. Runs in list order inside its phase, around the platform's own
   * auth/session/redirect steps. Mounted API routes are not covered: give those
   * a Hono `app.use()` inside `mounts.api`.
   */
  middleware?: readonly OriginMiddleware[];
  /** Static asset root served under /assets/*. Defaults to the local client build. */
  staticRoot?: string;
  /**
   * Unprocessed files served under /public/* from the project public directory.
   * Defaults to config.publicDir. Set false to disable the mount.
   */
  publicStaticRoot?: string | false;
  isShuttingDown?: () => boolean;
  readinessCheck?: () => Promise<boolean>;
  cacheRequired?: boolean;
  capacity?: Capacity;
  /**
   * Endpoints that hold their connection open on purpose — SSE, long polling.
   * They manage their own lifetime, so no request deadline is armed for them.
   */
  longLivedRoutes?: readonly string[];
  /**
   * Third-party origins this app's pages reach — an analytics vendor, a consent
   * tool, an embedded player. Added to the platform's own CSP sources.
   */
  csp?: CspSources;
};

export function createApp(options: CreateAppOptions): Hono<{ Variables: AppVariables }> {
  const routeTable = options.routes;
  const isShuttingDown = options.isShuttingDown ?? (() => false);
  const readinessCheck = options.readinessCheck ?? pingCache;
  const cacheRequired = options.cacheRequired ?? config.cacheRequired;
  const capacity = options.capacity ?? defaultSsrCapacity;
  // Compiled at startup, so a malformed middleware list fails the deploy rather
  // than the first request that happens to match it.
  const pipeline = createPipeline(options.middleware ?? []);
  const app = new Hono<{ Variables: AppVariables }>();

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    const errorId = randomUUID();
    logError(error, {
      msg: "unhandled Hono application error",
      errorId,
      requestId: c.get("requestId"),
      path: new URL(c.req.url).pathname,
    });
    const response = errorResponse(options.assets, errorId, {
      pageRequestId: c.get("requestId"),
      cspNonce: c.get("cspNonce"),
    });
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
      ...stripUndefined({
        cspNonce: c.get("cspNonce"),
        preparedRequest: c.get("preparedRequest"),
      }),
    };
    return request.method === "HEAD"
      ? handleHead(request, routeTable, handleContext)
      : handle(request, routeTable, options.assets, handleContext);
  });

  app.use("*", requestId);
  app.use("*", clientIpMiddleware);
  // Before requestDeadline: that clones the request, and a clone locks the body
  // the limit still has to measure.
  app.use("*", publicBodyLimit(config.proxyBodyLimitBytes));
  // Filled in from the app's own route table once everything is mounted, and read
  // only when a metric is labelled. Deriving it beats asking for a list: what is
  // mounted is the truth, and it cannot drift or be forgotten.
  const mountedApiRoutes = new Set<string>();
  app.use(
    "*",
    requestDeadline(routeTable, {
      apiRouteLabels: mountedApiRoutes,
      ...stripUndefined({ longLivedRoutes: options.longLivedRoutes }),
    }),
  );
  app.use("*", async (c, next) => {
    await withRequestSpan(contextRequest(c), c.get("requestId"), async (span) => {
      try {
        await next();
        span.setAttribute("http.response.status_code", c.res.status);
        span.setAttribute("ssr.cache.state", c.res.headers.get("x-cache") ?? "NONE");
        if (c.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      } finally {
        // Deliberately not awaited: `after()` exists so this work stays off the
        // response path. In `finally` because a failed request still has to
        // release what it parked — otherwise the tasks leak with the context.
        flushAfterTasks();
      }
    });
  });
  app.use("*", createSecurityMiddleware(options.csp));
  // Hono >=4.13 owns compression negotiation and its Vary: Accept-Encoding header.
  app.use("*", compress({ threshold: config.httpCompressionThresholdBytes }));
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
    const normalized =
      c.get("preparedRequest")?.normalized ?? normalizePublicUrl(new URL(c.req.url));
    if (normalized.kind === "invalid") {
      return publicUrlErrorResponse(c.get("requestId"));
    }
    if (normalized.kind === "redirect") {
      return publicUrlRedirectResponse(normalized.location, c.get("requestId"));
    }
    await next();
  });

  app.use("/assets/*", staticAssetCacheHeaders);
  app.use(
    "/assets/*",
    serveStatic({
      root: options.staticRoot ?? config.clientDistDir,
      // origin-build emits .br/.gz siblings. The Node server negotiates them
      // without spending compression CPU on every immutable asset request.
      precompressed: true,
    }),
  );

  const publicStaticRoot =
    options.publicStaticRoot === false ? undefined : (options.publicStaticRoot ?? config.publicDir);
  if (publicStaticRoot) {
    app.use("/public/*", staticAssetCacheHeaders);
    app.use(
      "/public/*",
      serveStatic({
        root: publicStaticRoot,
        rewriteRequestPath: (path) => path.replace(/^\/public/, "") || "/",
      }),
    );
  }

  app.get("/healthz", (c) => {
    c.set("requestRoute", "<health>");
    return c.text("ok");
  });
  app.all("/metrics", (c) => c.body(null, 404, { "cache-control": "private, no-store" }));
  app.get("/readyz", async (c) => {
    c.set("requestRoute", "<health>");
    c.header("cache-control", "private, no-store");
    if (isShuttingDown()) return c.text("shutting down", 503);
    const ok = await readinessCheck();
    if (!ok && cacheRequired) return c.text("cache unavailable", 503);
    if (devServerGeneration) c.header(DEV_SERVER_GENERATION_HEADER, devServerGeneration);
    return c.text("ok");
  });

  options.mounts?.seo?.(app, config.siteUrl);
  options.mounts?.api?.(app);

  // Every concrete /api endpoint this app registered — its own and the
  // platform's. A metric label has to come from a bounded set: labelling with
  // the raw path would let any caller mint new time series.
  for (const route of app.routes) {
    if (route.method !== "ALL" && route.path.startsWith("/api")) {
      mountedApiRoutes.add(route.path);
    }
  }

  app.all(
    "*",
    createSsrDispatch({
      assets: options.assets,
      routes: routeTable,
      capacity,
      isShuttingDown,
      pipeline,
    }),
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
