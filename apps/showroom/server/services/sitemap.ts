import {
  gatewayFetch,
  gatewayFetchWithIdentity,
  requireGatewayOk,
} from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import { GatewayContracts } from "@server/services/gateway-contracts";
import { isIsoDate, isRecord } from "@server/services/gateway-guards";

const MAX_SITEMAP_ENTRIES = 50_000;
const MAX_PATH_LENGTH = 2_048;
const INVALID_SITEMAP = "Sitemap gateway returned an invalid payload";

export type SitemapEntry = {
  path: string;
  lastModified?: string;
};

export async function fetchSitemapEntries(request?: Request): Promise<SitemapEntry[]> {
  await using response = request
    ? await gatewayFetchWithIdentity(request, "/seo/sitemap")
    : await gatewayFetch("/seo/sitemap");
  await requireGatewayOk(response, "Sitemap gateway returned");
  const payload = await readGatewayJson(response, GatewayContracts.sitemap, INVALID_SITEMAP);
  const result = requireGatewayPayload(
    GatewayContracts.sitemap,
    payload,
    isSitemapPayload,
    INVALID_SITEMAP,
  );
  return [...new Map(result.entries.map((entry) => [entry.path, entry])).values()];
}

function isSitemapPayload(value: unknown): value is { entries: SitemapEntry[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.entries) &&
    value.entries.length > 0 &&
    value.entries.length <= MAX_SITEMAP_ENTRIES &&
    value.entries.every(isSitemapEntry)
  );
}

function isSitemapEntry(value: unknown): value is SitemapEntry {
  if (!isRecord(value) || !isPublicPath(value.path)) return false;
  return value.lastModified === undefined || isIsoDate(value.lastModified);
}

function isPublicPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PATH_LENGTH &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !value.includes("\\") &&
    ![...value].some(isControlCharacter)
  );
}

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 31 || code === 127;
}
