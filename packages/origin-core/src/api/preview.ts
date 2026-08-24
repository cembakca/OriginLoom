import type { Hono } from "hono";

import { applyCookies, CookieJar } from "../middleware/cookie-jar.js";
import { contextRequest } from "../middleware/request-deadline.js";
import type { AppVariables } from "../middleware/request-id.js";
import {
  clearPreviewCookie,
  createPreviewGrant,
  isPreviewConfigured,
  isPreviewRequest,
  isValidPreviewToken,
  setPreviewCookie,
} from "../preview.js";
import { guardPublicApi, type PublicApiPolicy } from "../security/public-api-guard.js";

/**
 * Starting and stopping a draft-preview session.
 *
 * The token is the shared secret an editor pastes from the CMS; it is exchanged
 * once for a short-lived signed cookie, and never appears again. Rate limited
 * like any other public endpoint, because the enable route is the only place
 * where guessing gets you anything.
 */
const PREVIEW_POLICY: PublicApiPolicy = {
  name: "preview",
  windowMs: 60_000,
  globalLimit: 300,
  // Low on purpose: a legitimate editor enables preview a handful of times a
  // day, so anything above this is someone trying secrets.
  ipLimit: 10,
};

export function mountPreviewApi(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/api/preview/enable", async (c) => {
    const request = contextRequest(c);

    // 404 rather than 503: an unconfigured deployment should not advertise that
    // a preview mechanism exists at all.
    if (!isPreviewConfigured()) return c.notFound();

    const denied = await guardPublicApi(request, c.get("clientIp") ?? "unresolved", PREVIEW_POLICY);
    if (denied) return denied;

    if (!isValidPreviewToken(new URL(request.url).searchParams.get("token"))) {
      return json({ error: "Invalid preview token" }, 403);
    }

    const jar = new CookieJar();
    setPreviewCookie(jar, createPreviewGrant());
    // A redirect rather than a body, so the editor lands on the page they were
    // heading for with the cookie already set.
    return applyCookies(redirect(safeReturnPath(request)), jar);
  });

  app.get("/api/preview/disable", (c) => {
    const jar = new CookieJar();
    clearPreviewCookie(jar);
    return applyCookies(redirect(safeReturnPath(contextRequest(c))), jar);
  });

  /** Lets the CMS — and the preview banner — ask whether this session is in preview. */
  app.get("/api/preview/status", (c) =>
    json({ preview: isPreviewRequest(contextRequest(c)), configured: isPreviewConfigured() }),
  );
}

/**
 * Where to send the editor afterwards.
 *
 * Only a same-site absolute path is honoured. Taking the caller's value as-is
 * would make this an open redirect on an endpoint that is handed around in
 * chat messages — exactly the link someone would click without reading.
 */
function safeReturnPath(request: Request): string {
  const requestUrl = new URL(request.url);
  const raw = requestUrl.searchParams.get("path") ?? "/";
  if (!raw.startsWith("/")) return "/";

  // WHATWG treats backslashes as slashes for HTTP(S) URLs, so `/\evil.test`
  // resolves to `//evil.test` even though a string-prefix check accepts it.
  // Resolve exactly as the browser will, then return only the same-origin
  // path-shaped portion so no alternate spelling can survive into Location.
  // `URL.parse` rather than the constructor: a path that resolves to an empty
  // host — `//` and `/\` are the whole of it — is a parse *failure* for an
  // http(s) base, and throwing here would turn a hostile query string on the
  // public disable endpoint into a 500 instead of a redirect home.
  const resolved = URL.parse(raw, requestUrl.origin);
  if (!resolved || resolved.origin !== requestUrl.origin) return "/";
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, "cache-control": "private, no-store" },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
