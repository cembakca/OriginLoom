import { gatewayFetch } from "@server/adapters/gateway";
import { config } from "@server/config";
import { logger } from "@server/logger";

export type CmsRedirectRule =
  { kind: "redirect"; destination: string; status: 301 | 302 | 307 | 308 } | { kind: "gone" };

/** Temporary local CMS fixture; remove when the redirect API becomes authoritative. */
const MOCK_MAP: Record<string, CmsRedirectRule> = {
  "/eski-emeklilik": { kind: "redirect", destination: "/emekli-bankaciligi", status: 301 },
  "/kaldirildi": { kind: "gone" },
};

const cache = new Map<string, { value: CmsRedirectRule | null; expiresAt: number }>();
const VALID_STATUS = new Set([301, 302, 307, 308]);

function validDestination(value: string): boolean {
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
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
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

export async function lookupRedirect(pathname: string): Promise<CmsRedirectRule | null> {
  if (MOCK_MAP[pathname]) return MOCK_MAP[pathname];

  const cached = cache.get(pathname);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: CmsRedirectRule | null = null;
  try {
    const res = await gatewayFetch(`/cms/redirects?path=${encodeURIComponent(pathname)}`, {
      method: "GET",
    });
    if (res.ok) value = parseRule(await res.json());
  } catch (error) {
    logger.warn("redirect lookup failed", {
      pathname,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!cache.has(pathname) && cache.size >= config.redirectCacheMaxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(pathname, { value, expiresAt: Date.now() + config.redirectCacheTtlMs });
  return value;
}
