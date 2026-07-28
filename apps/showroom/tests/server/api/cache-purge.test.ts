import { closeCache, initCache, read, write } from "@originloom/core/cache";
import {
  assertPurgeAuthorized,
  handleCacheKeysList,
  handleCachePurge,
} from "@server/api/internal/cache-purge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeCacheKeyForApi, formatCacheKey } from "~/lib/cache-keys";

describe("cache purge API", () => {
  const envSnapshot = { ...process.env };

  beforeEach(async () => {
    process.env.CACHE_BACKEND = "memory";
    process.env.CACHE_PURGE_SECRET = "test-secret";
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    process.env = { ...envSnapshot };
    await closeCache();
  });

  it("rejects purge without secret in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.CACHE_PURGE_SECRET;

    const res = assertPurgeAuthorized(new Request("http://localhost/api/internal/cache/purge"));
    expect(res?.status).toBe(503);

    process.env.NODE_ENV = prev;
    process.env.CACHE_PURGE_SECRET = "test-secret";
  });

  it("rejects purge with wrong token", () => {
    const res = assertPurgeAuthorized(
      new Request("http://localhost/api/internal/cache/purge", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(res?.status).toBe(401);
  });

  it("allows purge in development without secret", () => {
    delete process.env.CACHE_PURGE_SECRET;
    const res = assertPurgeAuthorized(new Request("http://localhost/api/internal/cache/purge"));
    expect(res).toBeNull();
  });

  it("purges keys by list", async () => {
    await write("menu:Desktop", "{}", { kind: "shared", ttl: 60, key: ["menu:Desktop"] });
    await write("menu:Mobile", "{}", { kind: "shared", ttl: 60, key: ["menu:Mobile"] });

    const res = await handleCachePurge(
      new Request("http://localhost/api/internal/cache/purge", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ keys: ["menu:Desktop"] }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deleted: number; mode: string };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("keys");
    expect(body.deleted).toBe(1);
    expect(await read("menu:Mobile")).not.toBeNull();
  });

  it("purges by prefix", async () => {
    await write("menu:Desktop", "{}", { kind: "shared", ttl: 60, key: ["menu:Desktop"] });
    await write("menu:Mobile", "{}", { kind: "shared", ttl: 60, key: ["menu:Mobile"] });
    await write("home\0tr", "<html>", { kind: "shared", ttl: 60, key: ["home", "tr"] });

    const res = await handleCachePurge(
      new Request("http://localhost/api/internal/cache/purge", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ prefix: "menu:" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(2);
    expect(await read("home\0tr")).not.toBeNull();
  });

  it("flushes all cache entries", async () => {
    await write("menu:Desktop", "{}", { kind: "shared", ttl: 60, key: ["menu:Desktop"] });
    await write("home\0tr", "<html>", { kind: "shared", ttl: 60, key: ["home", "tr"] });

    const res = await handleCachePurge(
      new Request("http://localhost/api/internal/cache/purge", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ all: true }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number; mode: string };
    expect(body.mode).toBe("all");
    expect(body.deleted).toBe(2);
    expect(await read("menu:Desktop")).toBeNull();
  });

  it("lists keys with prefix filter", async () => {
    await write("menu:Desktop", "{}", { kind: "shared", ttl: 60, key: ["menu:Desktop"] });
    await write("home\0tr", "<html>", { kind: "shared", ttl: 60, key: ["home", "tr"] });

    const res = await handleCacheKeysList(
      new Request("http://localhost/api/internal/cache/keys?prefix=menu:", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      keys: string[];
      entries: Array<{ encoded: string; display: string; parts: string[] }>;
    };
    expect(body.keys).toEqual(["menu:Desktop"]);
    expect(body.entries[0]?.display).toBe("menu:Desktop");
    expect(body.entries[0]?.encoded).toBe(encodeCacheKeyForApi("menu:Desktop"));
  });

  it("purges query-param HTML keys via keysEncoded", async () => {
    const contentKey = formatCacheKey(["knowledge-center", "page=1", "tr", "Desktop"]);
    await write(contentKey, "<html>", {
      kind: "shared",
      ttl: 60,
      key: ["knowledge-center", "page=1", "tr", "Desktop"],
    });

    const res = await handleCachePurge(
      new Request("http://localhost/api/internal/cache/purge", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ keysEncoded: [encodeCacheKeyForApi(contentKey)] }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(1);
    expect(await read(contentKey)).toBeNull();
  });

  it("purges all variants of a page via pageIds", async () => {
    const loanKey = formatCacheKey(["housing-loans", "amount=2500000", "tr", "Desktop"]);
    const homeKey = formatCacheKey(["home", "en", "Desktop"]);
    await write(loanKey, "<html>", {
      kind: "shared",
      ttl: 60,
      key: ["housing-loans", "amount=2500000", "tr", "Desktop"],
    });
    await write(homeKey, "<html>", {
      kind: "shared",
      ttl: 60,
      key: ["home", "en", "Desktop"],
    });

    const res = await handleCachePurge(
      new Request("http://localhost/api/internal/cache/purge", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ pageIds: ["housing-loans"] }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number; mode: string };
    expect(body.mode).toBe("pageIds");
    expect(body.deleted).toBe(1);
    expect(await read(loanKey)).toBeNull();
    expect(await read(homeKey)).not.toBeNull();
  });
});
