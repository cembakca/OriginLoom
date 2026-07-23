import { isRecord } from "@originloom/react/lib/runtime-schema";

import { gatewayFetch } from "../../adapters/gateway";
import { config } from "../../config";
import { parseGatewayPayload, readGatewayJson } from "../../gateway-payload";
import { logger } from "../../logger";
import { isRequestDeadlineError } from "../request-deadline";

export type CmsRedirectRule =
  { kind: "redirect"; destination: string; status: 301 | 302 | 307 | 308 } | { kind: "gone" };

const cache = new Map<string, { value: CmsRedirectRule | null; expiresAt: number }>();
const VALID_STATUS = new Set([301, 302, 307, 308]);

function validDestination(value: string): boolean {
  if (value.length === 0 || value.length > 2_048) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      config.redirectAllowedHosts.includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function parseRule(value: unknown): CmsRedirectRule | null {
  if (!isRecord(value)) return null;
  const data = value;
  if (data.type === "gone") return { kind: "gone" };
  if (typeof data.destination !== "string" || !validDestination(data.destination)) return null;
  const status = typeof data.status === "number" ? data.status : 301;
  if (!VALID_STATUS.has(status)) return null;
  return {
    kind: "redirect",
    destination: data.destination,
    status: status as 301 | 302 | 307 | 308,
  };
}

export async function lookupRedirect(
  pathname: string,
  signal?: AbortSignal,
): Promise<CmsRedirectRule | null> {
  const cached = cache.get(pathname);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: CmsRedirectRule | null = null;
  let shouldCache = true;
  try {
    const res = await gatewayFetch(`/cms/redirects?path=${encodeURIComponent(pathname)}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    if (res.ok) {
      const payload = await readGatewayJson(
        res,
        "redirect",
        "Redirect gateway returned an invalid payload",
      );
      value = parseGatewayPayload(
        "redirect",
        payload,
        parseRule,
        "Redirect gateway returned an invalid payload",
      );
    }
  } catch (error) {
    if (isRequestDeadlineError(signal?.reason)) throw signal.reason;
    if (isRequestDeadlineError(error)) throw error;
    logger.warn("redirect lookup failed", {
      pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    shouldCache = false;
  }

  if (shouldCache) {
    if (!cache.has(pathname) && cache.size >= config.redirectCacheMaxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(pathname, { value, expiresAt: Date.now() + config.redirectCacheTtlMs });
  }
  return value;
}
