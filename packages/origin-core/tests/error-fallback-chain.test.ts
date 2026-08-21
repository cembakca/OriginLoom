import type { Ctx, Route } from "@originloom/shared/lib/types";
import type { OriginRenderer } from "@originloom/shared/render";
import { describe, expect, it } from "vitest";

import { handle } from "../src/handler.js";
import { installRuntime } from "../src/runtime.js";

const assets = { js: "/entry.js", css: [], fonts: [] };

/**
 * OR: "İki aşamalı route/global error fallback regresyon testi" (see review decision
 * S-3 in CACHE_PERFORMANCE_ROADMAP.md § OR). The fallback chain has three stages:
 *
 *   1. the route's own (streaming) render fails
 *   2. the route error boundary render (React, via the runtime's renderer) is
 *      attempted and *also* fails
 *   3. the platform's last-resort static error page — built from strings, with no
 *      dependency on the app's renderer — is what the client finally receives.
 *
 * This pins that `handle()` never lets an exception escape uncaught even when both
 * renderer-backed stages fail back to back, and that stage 3 truly does not touch the
 * fake renderer at all.
 */
describe("route/global error fallback chain", () => {
  it("falls through a failed stream render and a failed route-error render to the static global error page", async () => {
    let errorContentCalls = 0;
    installRuntime({
      renderer: failingRenderer(() => errorContentCalls++),
      fragments: {},
      isShellUsableForFragments: () => true,
      document: {
        htmlLang: "tr",
        isBotRequest: () => false,
        resolveMetadata: () => ({}) as never,
        boundaryMetadata: () => ({}) as never,
        defaultPageMeta: (_ctx: Ctx, pageType: string) => ({ pageType, publicPath: "/" }),
      },
      cacheKeys: { isKnownPageCachePrefix: () => true },
      buildShellData: async () => ({}),
    });

    const route: Route = {
      path: "/stream-fail",
      streaming: true,
      loader: async () => ({ data: { ok: true } }),
      Component: () => "content",
    };
    const request = new Request("http://localhost/stream-fail");

    const response = await handle(request, [route], assets, { requestId: "chain-request" });
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    // Both renderer-backed stages were actually attempted, and both failed —
    // this is not a test that short-circuits on the first failure.
    expect(errorContentCalls).toBeGreaterThanOrEqual(1);

    // Stage 3: the static fallback, entirely independent of the (failing) renderer.
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("Bir hata oluştu");
    expect(body).toMatch(/Referans: [^<]+/);
    expect(body).not.toContain("route-error-content-marker");
  });
});

function failingRenderer(onErrorContent: () => void): OriginRenderer<unknown> {
  return {
    routeContent: (_route, data) => data,
    notFoundContent: () => "not-found",
    errorContent: () => {
      onErrorContent();
      throw new Error("route error boundary render also failed");
    },
    renderNode: (node) => String(node),
    renderDocument: () => {
      throw new Error("renderDocument must not be reached once errorContent already threw");
    },
    renderDocumentToStream: async () => {
      throw new Error("stream shell render failed");
    },
  };
}
