import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { createPreviewGrant } from "@originloom/core/preview";
import { mountApi } from "@server/api";
import { routes } from "@server/routes";
import { mountSeoRoutes } from "@server/seo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const assets = { js: "/assets/entry.client.js", css: [], fonts: [] };
const capacity = { run: <T>(_signal: AbortSignal, work: () => Promise<T>) => work() };

const app = createApp({
  assets,
  routes,
  capacity,
  mounts: { api: mountApi, seo: mountSeoRoutes },
  readinessCheck: async () => true,
});

beforeAll(async () => {
  await closeCache();
  await initCache();
});

afterAll(async () => {
  await closeCache();
});

function previewCookie(): string {
  return `originloom_preview=${createPreviewGrant().value}`;
}

describe("/preview-demo", () => {
  it("serves the published revision from shared cache to anyone", async () => {
    const first = await app.request("/preview-demo");
    const html = await first.text();
    const second = await app.request("/preview-demo");

    expect(first.status).toBe(200);
    expect(html).toContain("Konut kredisi faizleri düştü");
    expect(html).not.toContain("TASLAK");
    expect(second.headers.get("x-cache")).toBe("HIT");
  });

  /**
   * The guarantee the feature rests on: the policy is downgraded before a cache
   * key exists, so a draft render has nothing to read from and nothing to write
   * to.
   */
  it("bypasses the cache entirely for a preview session", async () => {
    const response = await app.request("/preview-demo", {
      headers: { cookie: previewCookie() },
    });
    const html = await response.text();

    expect(response.headers.get("x-cache")).toBe("BYPASS");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(html).toContain("TASLAK");
    expect(html).toContain("preview-banner");
  });

  /** A draft render must never end up in the entry everyone else reads. */
  it("does not let a draft render reach the shared entry", async () => {
    await app.request("/preview-demo", { headers: { cookie: previewCookie() } });
    const anonymous = await app.request("/preview-demo");

    expect(await anonymous.text()).not.toContain("TASLAK");
  });

  it("ignores a forged preview cookie", async () => {
    const response = await app.request("/preview-demo", {
      headers: { cookie: `originloom_preview=${Date.now() + 60_000}.forgedsignaturevalue0000000` },
    });

    expect(await response.text()).not.toContain("TASLAK");
  });
});

describe("preview endpoints", () => {
  it("refuses a wrong token and accepts the configured one", async () => {
    expect((await app.request("/api/preview/enable?token=nope")).status).toBe(403);

    const granted = await app.request("/api/preview/enable?token=dev-preview-secret&path=/x");
    expect(granted.status).toBe(302);
    expect(granted.headers.get("set-cookie")).toContain("originloom_preview=");
    expect(granted.headers.get("set-cookie")).toContain("HttpOnly");
  });

  /** The enable link gets pasted into chat; it must not forward anywhere. */
  it("only returns to a same-site absolute path", async () => {
    for (const path of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
    ]) {
      const response = await app.request(
        `/api/preview/enable?token=dev-preview-secret&path=${encodeURIComponent(path)}`,
      );
      expect(response.headers.get("location")).toBe("/");
    }
  });

  it("does not turn the public disable endpoint into an open redirect", async () => {
    const path = encodeURIComponent("/\\evil.example");
    const response = await app.request(`/api/preview/disable?path=${path}`);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });
});

describe("/server-island", () => {
  it("caches the shell and leaves a signed placeholder in it", async () => {
    const response = await app.request("/server-island");
    const html = await response.text();

    expect(html).toContain('data-server-island="visitor-summary"');
    expect(html).toMatch(
      // `<body>.<kid>.<digest>` — the key ring puts the signing key's label between
      // the payload and its signature so a rotation can still verify it.
      /data-payload="[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"/,
    );
    // The fallback is what a visitor without scripts keeps.
    expect(html).toContain("Ziyaretçi özeti yükleniyor");
    expect((await app.request("/server-island")).headers.get("x-cache")).toBe("HIT");
  });

  /**
   * The placeholder is baked into HTML everyone receives, so it must carry
   * nothing personal — one cache entry serves every visitor.
   */
  it("gives every visitor the same placeholder", async () => {
    const mobile = await app.request("/server-island", {
      headers: { cookie: "user_tracking_id=11111111-1111-4111-8111-111111111111" },
    });
    const anonymous = await app.request("/server-island");

    const payload = (html: string) => /data-payload="([^"]+)"/.exec(html)?.[1];
    expect(payload(await mobile.text())).toBe(payload(await anonymous.text()));
  });

  it("fills the hole per request and never caches the answer", async () => {
    const shell = await (await app.request("/server-island")).text();
    const payload = /data-payload="([^"]+)"/.exec(shell)?.[1] ?? "";

    const response = await app.request(`/api/_island?p=${encodeURIComponent(payload)}`, {
      headers: { cookie: "user_tracking_id=11111111-1111-4111-8111-111111111111" },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(html).toContain("visitor-summary");
    // Read from the request, which is the only place a per-person fact can come
    // from once the shell is shared.
    expect(html).toContain("evet");
  });

  it("rejects a payload that was not signed by this server", async () => {
    const forged = Buffer.from(
      JSON.stringify({ name: "visitor-summary", props: { variant: "full" } }),
    ).toString("base64url");

    for (const token of [`${forged}.notarealsignature`, "garbage", ""]) {
      const response = await app.request(`/api/_island?p=${encodeURIComponent(token)}`);
      expect(response.status).toBe(400);
    }
  });
});
