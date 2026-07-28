import crypto, { randomBytes } from "node:crypto";

import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { config } from "../config.js";
import { resolveCspSourceOrigins } from "../csp-origins.js";
import type { AppVariables } from "./request-id.js";

/** CSP hash source for an inline script body: 'sha256-…'. */
export function cspScriptHash(content: string): string {
  const hash = crypto.createHash("sha256").update(content).digest("base64");
  return `'sha256-${hash}'`;
}

// Local development requires arbitrary inline script execution for Vite HMR / React Refresh.
// Since modern browsers ignore 'unsafe-inline' if hashes are present in script-src,
// hashes only take effect in production to keep local dev fully working.
const registeredHashes = new Set<string>();
const hashes: string[] = [];

/** Products register hashes of their inline scripts (e.g. GTM bootstrap) at startup. */
export function registerCspScriptHashes(...values: string[]): void {
  if (!config.isProduction) return;
  for (const value of values) {
    if (registeredHashes.has(value)) continue;
    registeredHashes.add(value);
    hashes.push(value);
  }
}

const devScripts = !config.isProduction ? ["'unsafe-inline'"] : [];
const devViteUrls: string[] = [];
const devViteWsUrls: string[] = [];

if (config.viteDevServerUrl) {
  devViteUrls.push(config.viteDevServerUrl);
  try {
    const url = new URL(config.viteDevServerUrl);
    const wsProto = url.protocol === "https:" ? "wss:" : "ws:";
    devViteWsUrls.push(`${wsProto}//${url.host}`);
  } catch {
    // ignore
  }
} else if (!config.isProduction) {
  devViteUrls.push(
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
  );
  devViteWsUrls.push(
    "ws://localhost:5173",
    "ws://127.0.0.1:5173",
    "ws://localhost:5174",
    "ws://127.0.0.1:5174",
  );
}

const cspOrigins = resolveCspSourceOrigins(config);

/**
 * Third-party origins this app's pages actually reach — an analytics vendor, a
 * consent tool, an embedded player.
 *
 * The platform cannot know them: which vendor a product uses is a product
 * decision, and hardcoding one here would both bless it for every app and
 * silently break every other. Sources are additive; the platform's own needs
 * ('self', the asset CDN, the dev server) are always present.
 */
export type CspSources = {
  scriptSrc?: readonly string[];
  connectSrc?: readonly string[];
  imgSrc?: readonly string[];
  frameSrc?: readonly string[];
  styleSrc?: readonly string[];
  fontSrc?: readonly string[];
};

/**
 * Built once per app rather than per request: the directive lists are fixed at
 * startup, and only the nonce changes.
 */
export function createSecurityMiddleware(
  sources: CspSources = {},
): MiddlewareHandler<{ Variables: AppVariables }> {
  const baseCspDirectives = {
    defaultSrc: ["'self'"],
    connectSrc: ["'self'", ...(sources.connectSrc ?? []), ...devViteUrls, ...devViteWsUrls],
    imgSrc: ["'self'", "data:", ...(sources.imgSrc ?? []), ...cspOrigins.image],
    frameSrc: ["'self'", ...(sources.frameSrc ?? [])],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    styleSrc: [
      "'self'",
      "'unsafe-inline'",
      ...(sources.styleSrc ?? []),
      ...cspOrigins.asset,
      ...devViteUrls,
    ],
    fontSrc: ["'self'", "data:", ...(sources.fontSrc ?? []), ...cspOrigins.asset],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    ...(config.cspReportUri ? { reportUri: [config.cspReportUri] } : {}),
  };
  const appScriptSrc = sources.scriptSrc ?? [];

  return async (c, next) => {
    // A nonce/hash source makes browsers ignore 'unsafe-inline'. Development intentionally relies on
    // 'unsafe-inline' for Vite/React Refresh, so nonce must be a production-only contract.
    const nonce = config.isProduction ? randomBytes(18).toString("base64") : undefined;
    if (nonce) c.set("cspNonce", nonce);
    const cspDirectives = {
      ...baseCspDirectives,
      scriptSrc: [
        "'self'",
        ...appScriptSrc,
        ...cspOrigins.asset,
        ...hashes,
        ...(nonce ? [`'nonce-${nonce}'`] : []),
        ...devScripts,
        ...devViteUrls,
      ],
    };
    const middleware = secureHeaders({
      xContentTypeOptions: "nosniff",
      xFrameOptions: "DENY",
      referrerPolicy: "strict-origin-when-cross-origin",
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
      },
      ...(config.cspEnforce
        ? { contentSecurityPolicy: cspDirectives }
        : { contentSecurityPolicyReportOnly: cspDirectives }),
    });
    return middleware(c, next);
  };
}
