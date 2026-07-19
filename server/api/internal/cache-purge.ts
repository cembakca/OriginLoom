import {
  executePurge,
  listCacheKeys,
  parseListKeysQuery,
  parsePurgeBody,
} from "@server/cache/purge";
import { config, purgeSecurityConfig } from "@server/config";
import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { secretMatches } from "@server/security/secrets";
import type { Context } from "hono";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

/** Bearer veya X-Cache-Purge-Token ile doğrulama. Prod'da secret zorunlu. */
export function assertPurgeAuthorized(request: Request): Response | null {
  const { secret, isProduction } = purgeSecurityConfig();

  if (!secret) {
    if (isProduction) {
      return json({ error: "CACHE_PURGE_SECRET tanımlı değil — purge devre dışı" }, 503);
    }
    return null;
  }

  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? request.headers.get("x-cache-purge-token");

  if (!secretMatches(token, secret)) {
    return json({ error: "Yetkisiz" }, 401);
  }

  return null;
}

export async function handleCachePurge(request: Request): Promise<Response> {
  const denied = assertPurgeAuthorized(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Geçersiz JSON" }, 400);
  }

  const parsed = parsePurgeBody(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);

  const result = await executePurge(parsed, config.cacheBackend);
  return json({ ok: true, ...result });
}

export async function handleCacheKeysList(request: Request): Promise<Response> {
  const denied = assertPurgeAuthorized(request);
  if (denied) return denied;

  const parsed = parseListKeysQuery(new URL(request.url));
  if ("error" in parsed) return json({ error: parsed.error }, 400);

  const result = await listCacheKeys(parsed, config.cacheBackend);
  return json({ ok: true, ...result });
}

export function mountCachePurgeRoutes(app: {
  get: (
    path: string,
    handler: (c: Context<{ Variables: AppVariables }>) => Response | Promise<Response>,
  ) => void;
  post: (
    path: string,
    handler: (c: Context<{ Variables: AppVariables }>) => Response | Promise<Response>,
  ) => void;
}): void {
  app.get("/api/internal/cache/keys", (c) => handleCacheKeysList(contextRequest(c)));
  app.post("/api/internal/cache/purge", (c) => handleCachePurge(contextRequest(c)));
}
