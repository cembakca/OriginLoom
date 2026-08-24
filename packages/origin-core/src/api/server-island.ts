import type { Hono } from "hono";

import { contextRequest } from "../middleware/request-deadline.js";
import type { AppVariables } from "../middleware/request-id.js";
import { reportRequestError } from "../request-error.js";
import { guardPublicApi, type PublicApiPolicy } from "../security/public-api-guard.js";
import {
  isServerIslandConfigured,
  type ServerIslandRegistry,
  verifyServerIslandPayload,
} from "../server-island.js";

/**
 * Renders one server island and returns its HTML fragment.
 *
 * Every answer is `private, no-store`: this is the personal half of the page,
 * and the only reason the shell around it could be cached is that this part was
 * kept out of it. Caching it here would undo that in one step.
 */
const ISLAND_POLICY: PublicApiPolicy = {
  name: "server-island",
  windowMs: 60_000,
  globalLimit: 20_000,
  ipLimit: 300,
};

export function mountServerIslandApi(
  app: Hono<{ Variables: AppVariables }>,
  registry: ServerIslandRegistry,
): void {
  app.get("/api/_island", async (c) => {
    if (!isServerIslandConfigured()) return c.notFound();

    const request = contextRequest(c);
    const denied = await guardPublicApi(request, c.get("clientIp") ?? "unresolved", ISLAND_POLICY);
    if (denied) return denied;

    const url = new URL(request.url);
    const payload = verifyServerIslandPayload(url.searchParams.get("p") ?? "");
    // A bad signature and an unknown island answer identically, so probing
    // cannot be used to enumerate which islands exist.
    if (!payload) return fragment("", 400);

    const render = registry[payload.name];
    if (!render) return fragment("", 400);

    try {
      const html = await render(payload.props, {
        request,
        pagePath: url.searchParams.get("path") ?? "/",
      });
      return fragment(html, 200);
    } catch (error) {
      // The page already rendered and the visitor is looking at the fallback,
      // so a 500 here degrades one hole rather than the page — that is why the
      // *answer* stays quiet. Who hears about it is a separate question, and the
      // answer to that one is the same as everywhere else: the app's reporter.
      reportRequestError({
        error,
        msg: "server island render failed",
        phase: "render",
        requestId: c.get("requestId"),
        path: url.pathname,
        method: request.method,
        context: { island: payload.name },
      });
      return fragment("", 500);
    }
  });
}

function fragment(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
