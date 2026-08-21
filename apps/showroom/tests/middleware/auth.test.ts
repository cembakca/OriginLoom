import { closeCache, initCache } from "@originloom/core/cache";
import { CookieJar } from "@originloom/core/middleware/cookie-jar";
import { runAuthCore } from "@originloom/core/middleware/steps/auth/core";
import {
  isAccessTokenExpired,
  refreshTokens,
} from "@originloom/core/middleware/steps/auth/helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(async () => {
  await initCache();
});

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.unstubAllGlobals();
  await closeCache();
});

describe("auth helpers", () => {
  it("detects expired JWT", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 }),
    ).toString("base64url");
    const token = `${header}.${payload}.sig`;
    expect(isAccessTokenExpired(token)).toBe(true);
  });

  it("injects Authorization when refresh cookie present", async () => {
    const jar = new CookieJar();
    const request = new Request("http://localhost/", {
      headers: { cookie: "refresh_token=rt-abc123456789012345678" },
    });

    const outcome = await runAuthCore(request, jar);
    expect(outcome.authorization).toMatch(/^Bearer /);
    expect(jar.toHeaderStrings().some((c) => c.startsWith("access_token="))).toBe(true);
    expect(jar.toHeaderStrings().some((c) => c.startsWith("signed_in=1"))).toBe(true);
    expect(jar.toHeaderStrings().some((c) => c.startsWith("account_text="))).toBe(true);
  });

  it("leaves an anonymous request untouched so its response stays cacheable", async () => {
    const jar = new CookieJar();
    const outcome = await runAuthCore(new Request("http://localhost/"), jar);

    expect(outcome.kind).toBe("anonymous");
    // No Set-Cookie at all: applyCookies would force `private, no-store` and
    // make every page uncacheable for every logged-out visitor.
    expect(jar.toHeaderStrings()).toEqual([]);
  });

  it("clears hint cookies that outlived their tokens", async () => {
    const jar = new CookieJar();
    const outcome = await runAuthCore(
      new Request("http://localhost/", { headers: { cookie: "signed_in=1; account_text=Ada" } }),
      jar,
    );

    expect(outcome.kind).toBe("anonymous");
    expect(jar.toHeaderStrings()).toContain("signed_in=; Max-Age=0; Path=/");
    expect(jar.toHeaderStrings()).toContain("account_text=; Max-Age=0; Path=/");
  });

  it("clears credentials when the gateway authoritatively rejects refresh", async () => {
    process.env.NODE_ENV = "production";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    const jar = new CookieJar();
    const request = new Request("http://localhost/", {
      headers: { cookie: "refresh_token=invalid-refresh" },
    });

    const outcome = await runAuthCore(request, jar);
    expect(outcome.kind).toBe("anonymous");
    expect(outcome.authorization).toBeUndefined();
    expect(jar.toHeaderStrings()).toContain("refresh_token=; Max-Age=0; Path=/; Secure");
    expect(jar.toHeaderStrings()).not.toContainEqual(expect.stringMatching(/^signed_in=1/));
  });

  it("preserves credentials when refresh is temporarily unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const jar = new CookieJar();
    const outcome = await runAuthCore(
      new Request("http://localhost/", {
        headers: { cookie: "refresh_token=temporary-refresh-failure" },
      }),
      jar,
    );

    expect(outcome.kind).toBe("unavailable");
    expect(outcome.authorization).toBeUndefined();
    expect(jar.toHeaderStrings()).toEqual([]);
  });

  it("does not share an in-flight refresh across different tokens", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = refreshTokens("refresh-user-a");
    const second = refreshTokens("refresh-user-b");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolvers[0]?.(Response.json({ accessToken: "access-a", refreshToken: "rotated-a" }));
    resolvers[1]?.(Response.json({ accessToken: "access-b", refreshToken: "rotated-b" }));

    await expect(first).resolves.toEqual({
      kind: "success",
      access: "access-a",
      refresh: "rotated-a",
    });
    await expect(second).resolves.toEqual({
      kind: "success",
      access: "access-b",
      refresh: "rotated-b",
    });
  });

  it("keeps a shared refresh alive while another request still waits", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = refreshTokens("shared-refresh", firstController.signal);
    const second = refreshTokens("shared-refresh", secondController.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    firstController.abort(new Error("first request timed out"));
    await expect(first).rejects.toThrow("first request timed out");

    resolveFetch?.(Response.json({ accessToken: "shared-access", refreshToken: "shared-rotated" }));
    await expect(second).resolves.toEqual({
      kind: "success",
      access: "shared-access",
      refresh: "shared-rotated",
    });
  });

  it("shares a short encrypted refresh result through the cache coordination layer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        accessToken: "coordinated-access",
        refreshToken: "coordinated-rotated",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshTokens("cross-replica-refresh-token")).resolves.toMatchObject({
      kind: "success",
      access: "coordinated-access",
    });
    await expect(refreshTokens("cross-replica-refresh-token")).resolves.toMatchObject({
      kind: "success",
      refresh: "coordinated-rotated",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
