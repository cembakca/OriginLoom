import { createHash } from "node:crypto";

import { isCacheInitialized, takeDistributedRateLimit } from "../cache";
import { config } from "../config";
import { BoundedIpRateLimiter, FixedWindowRateLimiter } from "./rate-limit";

const DEFAULT_IP_MAX_ENTRIES = 10_000;
const DEFAULT_IP_TTL_MS = 300_000;

export type PublicApiPolicy = {
  name: string;
  windowMs: number;
  globalLimit: number;
  ipLimit: number;
  requireSameOriginMutation?: boolean;
  /** Memory bound of the local per-IP limiter map. */
  ipMaxEntries?: number;
  ipTtlMs?: number;
};

type LocalLimiters = {
  global: FixedWindowRateLimiter;
  ip: BoundedIpRateLimiter;
};

const localLimiters = new Map<string, LocalLimiters>();

export async function guardPublicApi(
  request: Request,
  clientIp: string,
  policy: PublicApiPolicy,
): Promise<Response | null> {
  if (policy.requireSameOriginMutation && !isSafeMethod(request.method)) {
    if (!isSameOriginBrowserRequest(request)) {
      return denied("Cross-origin request rejected", 403);
    }
  }

  const global = await takeLimit(`public:${policy.name}:global`, policy.globalLimit, policy);
  if (!global.allowed) return limited(global.retryAfterMs);

  const ipKey = createHash("sha256").update(clientIp).digest("base64url");
  const perIp = await takeLimit(
    `public:${policy.name}:ip:${ipKey}`,
    policy.ipLimit,
    policy,
    clientIp,
  );
  return perIp.allowed ? null : limited(perIp.retryAfterMs);
}

export function isSameOriginBrowserRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;

  const expectedOrigin = new URL(config.siteUrl).origin;
  const origin = request.headers.get("origin");
  if (origin) return safeOrigin(origin) === expectedOrigin;

  const referer = request.headers.get("referer");
  if (referer) return safeOrigin(referer) === expectedOrigin;

  return fetchSite === "same-origin";
}

async function takeLimit(
  key: string,
  limit: number,
  policy: PublicApiPolicy,
  clientIp?: string,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  if (isCacheInitialized()) {
    const distributed = await takeDistributedRateLimit(key, limit, policy.windowMs);
    if (distributed) return distributed;
  }

  const local = localLimiter(policy);
  const allowed = clientIp ? local.ip.take(clientIp) : local.global.take();
  return { allowed, retryAfterMs: policy.windowMs };
}

function localLimiter(policy: PublicApiPolicy): LocalLimiters {
  let value = localLimiters.get(policy.name);
  if (!value) {
    value = {
      global: new FixedWindowRateLimiter(policy.globalLimit, policy.windowMs),
      ip: new BoundedIpRateLimiter(
        policy.ipLimit,
        policy.windowMs,
        policy.ipMaxEntries ?? DEFAULT_IP_MAX_ENTRIES,
        policy.ipTtlMs ?? DEFAULT_IP_TTL_MS,
      ),
    };
    localLimiters.set(policy.name, value);
  }
  return value;
}

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function denied(message: string, status: 403): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

function limited(retryAfterMs: number): Response {
  return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "retry-after": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
    },
  });
}
