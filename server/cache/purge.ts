import { getRuntime } from "@server/runtime";

import { getCache, cacheTopology } from "./index";
import { type CacheKeyApiEntry, decodeCacheKeyFromApi, toCacheKeyApiEntry } from "./key-codec";
import type { ListKeysOptions, ListKeysResult } from "./types";

export type { CacheKeyApiEntry };

export type PurgeMode = "all" | "keys" | "prefix" | "pageIds";

export type PurgeRequest =
  | { mode: "all" }
  | { mode: "keys"; keys: string[] }
  | { mode: "prefix"; prefix: string }
  | { mode: "pageIds"; pageIds: string[] };

export type PurgeResult = {
  mode: PurgeMode;
  deleted: number;
  keys?: string[];
  prefix?: string;
  pageIds?: string[];
  backend: string;
};

const MAX_KEYS_PER_REQUEST = 500;
const MAX_PREFIX_LENGTH = 256;

export function parsePurgeBody(body: unknown): PurgeRequest | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "JSON body gerekli" };
  }

  const input = body as Record<string, unknown>;

  if (input.all === true) {
    return { mode: "all" };
  }

  if (Array.isArray(input.keys) || Array.isArray(input.keysEncoded)) {
    const keys: string[] = [];

    if (Array.isArray(input.keys)) {
      keys.push(
        ...input.keys.filter((key): key is string => typeof key === "string" && key.length > 0),
      );
    }

    if (Array.isArray(input.keysEncoded)) {
      for (const encoded of input.keysEncoded) {
        if (typeof encoded !== "string" || encoded.length === 0) continue;
        try {
          keys.push(decodeCacheKeyFromApi(encoded));
        } catch {
          return { error: `Geçersiz keysEncoded: ${encoded}` };
        }
      }
    }

    if (keys.length === 0) return { error: "keys veya keysEncoded boş olamaz" };
    if (keys.length > MAX_KEYS_PER_REQUEST) {
      return { error: `En fazla ${MAX_KEYS_PER_REQUEST} key silinebilir` };
    }
    return { mode: "keys", keys };
  }

  if (Array.isArray(input.pageIds)) {
    const pageIds = input.pageIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (pageIds.length === 0) return { error: "pageIds dizisi boş olamaz" };
    if (pageIds.length > MAX_KEYS_PER_REQUEST) {
      return { error: `En fazla ${MAX_KEYS_PER_REQUEST} pageId silinebilir` };
    }
    for (const pageId of pageIds) {
      if (!getRuntime().cacheKeys.isKnownPageCachePrefix(pageId)) {
        return { error: `Bilinmeyen pageId: ${pageId}` };
      }
    }
    return { mode: "pageIds", pageIds };
  }

  if (typeof input.prefix === "string") {
    const prefix = input.prefix.trim();
    if (!prefix) return { error: "prefix boş olamaz" };
    if (prefix.length > MAX_PREFIX_LENGTH) return { error: "prefix çok uzun" };
    if (prefix.includes("*") || prefix.includes("?")) {
      return { error: "prefix wildcard içeremez" };
    }
    return { mode: "prefix", prefix };
  }

  return { error: "all, keys, keysEncoded, pageIds veya prefix alanlarından biri gerekli" };
}

export function parseListKeysQuery(url: URL): ListKeysOptions | { error: string } {
  const prefix = url.searchParams.get("prefix") ?? undefined;
  if (prefix && (prefix.includes("*") || prefix.includes("?"))) {
    return { error: "prefix wildcard içeremez" };
  }

  const limitRaw = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 200) : 50;
  const cursor = url.searchParams.get("cursor");

  return {
    limit,
    ...(prefix ? { prefix } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export async function executePurge(request: PurgeRequest, _backend?: string): Promise<PurgeResult> {
  const store = getCache();
  const backend = _backend ?? cacheTopology();

  if (request.mode === "all") {
    const deleted = await store.flushAll();
    return { mode: "all", deleted, backend };
  }

  // Menu invalidation also removes obsolete fingerprinted shell fragments.
  const shouldPurgeFragments =
    (request.mode === "prefix" && request.prefix.startsWith("menu:")) ||
    (request.mode === "keys" && request.keys.some((key) => key.startsWith("menu:")));

  const relatedDeleted = shouldPurgeFragments
    ? (await store.deleteByPrefix("fragment:header:")) +
      (await store.deleteByPrefix("fragment:footer:"))
    : 0;

  if (request.mode === "keys") {
    const deleted = relatedDeleted + (await store.deleteKeys(request.keys));
    return { mode: "keys", deleted, keys: request.keys, backend };
  }

  if (request.mode === "pageIds") {
    let deleted = 0;
    for (const pageId of request.pageIds) {
      deleted += await store.deleteByPrefix(pageId);
    }
    return { mode: "pageIds", deleted, pageIds: request.pageIds, backend };
  }

  const deleted = relatedDeleted + (await store.deleteByPrefix(request.prefix));
  return { mode: "prefix", deleted, prefix: request.prefix, backend };
}

export async function listCacheKeys(
  options: ListKeysOptions,
  _backend?: string,
): Promise<ListKeysResult & { backend: string; entries: CacheKeyApiEntry[] }> {
  const backend = _backend ?? cacheTopology();
  const result = await getCache().listKeys(options);
  const entries = result.keys.map(toCacheKeyApiEntry);
  return { ...result, entries, backend };
}
