import type { Hono } from "hono";

import { cacheTopology } from "../cache/index.js";
import { executePurge, listCacheKeys, parseListKeysQuery, parsePurgeBody } from "../cache/purge.js";
import { config } from "../config.js";
import { contextRequest } from "../middleware/request-deadline.js";
import type { AppVariables } from "../middleware/request-id.js";
import { secretMatches } from "../security/secrets.js";

export type CachePurgeApiOptions = {
  /** Defaults to `CACHE_PURGE_SECRET`. Without one, the endpoints are disabled in production. */
  secret?: string | undefined;
};

/**
 * Operational endpoints for the shared HTML cache:
 *
 *   GET  /api/internal/cache/keys   — inspect what is cached
 *   POST /api/internal/cache/purge  — drop entries by key, prefix or dependency tag
 *
 * They read and destroy shared state, so they are secret-gated: a bearer token
 * or `X-Cache-Purge-Token`, compared in constant time. With no secret set they
 * stay open in development (nothing to protect locally) and refuse to answer in
 * production rather than exposing the cache.
 */
export function mountCachePurgeApi(
  app: Hono<{ Variables: AppVariables }>,
  options: CachePurgeApiOptions = {},
): void {
  const secret = options.secret ?? config.cachePurgeSecret;

  app.get("/api/internal/cache/keys", async (c) => {
    const denied = authorize(c.req.raw, secret);
    if (denied) return denied;

    const parsed = parseListKeysQuery(new URL(contextRequest(c).url));
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    return json({ ok: true, ...(await listCacheKeys(parsed, cacheTopology())) });
  });

  app.post("/api/internal/cache/purge", async (c) => {
    const denied = authorize(c.req.raw, secret);
    if (denied) return denied;

    let body: unknown;
    try {
      body = await contextRequest(c).json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const parsed = parsePurgeBody(body);
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    return json({ ok: true, ...(await executePurge(parsed, cacheTopology())) });
  });
}

/** @returns a response when the request must be refused, `null` when it may proceed. */
export function authorizeCachePurge(request: Request, secret?: string): Response | null {
  return authorize(request, secret ?? config.cachePurgeSecret);
}

function authorize(request: Request, secret: string | undefined): Response | null {
  if (!secret) {
    if (config.isProduction) {
      return json({ error: "CACHE_PURGE_SECRET is not set — purge is disabled" }, 503);
    }
    return null;
  }

  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const token = bearer ?? request.headers.get("x-cache-purge-token");
  return secretMatches(token, secret) ? null : json({ error: "Unauthorized" }, 401);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
