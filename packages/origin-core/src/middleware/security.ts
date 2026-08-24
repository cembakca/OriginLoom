import crypto, { randomBytes } from "node:crypto";

import type { Context, MiddlewareHandler } from "hono";
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
 * Folds the Trusted Types directives into a policy when they belong there.
 *
 * `enforce` mode adds them to the enforced header. When the whole CSP is
 * already report-only there is nothing to stage, so `report` adds them there
 * too rather than emitting a second header saying the same thing.
 */
function withTrustedTypes<T extends object>(
  directives: T,
  header: "enforce" | "report-only",
): T & Partial<{ requireTrustedTypesFor: string[]; trustedTypes: string[] }> {
  const wanted =
    config.trustedTypes === "enforce" ||
    (config.trustedTypes === "report" && header === "report-only");
  if (!wanted) return directives;
  return { ...directives, requireTrustedTypesFor: ["'script'"], trustedTypes: ["originloom"] };
}

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
  const nonceSource = (c: Context<{ Variables: AppVariables }>) => `'nonce-${c.get("cspNonce")}'`;
  const cspDirectives = {
    ...baseCspDirectives,
    scriptSrc: [
      "'self'",
      ...appScriptSrc,
      ...cspOrigins.asset,
      ...hashes,
      ...(config.isProduction ? [nonceSource] : []),
      ...devScripts,
      ...devViteUrls,
    ],
  };
  // secureHeaders compiles directive names, fixed values and all other header
  // strings here. The only request-time callback substitutes the nonce.
  /**
   * Trusted Types ship on their own schedule.
   *
   * `require-trusted-types-for` breaks every DOM sink that has not been routed
   * through a policy yet, so it rolls out separately from the rest of the CSP:
   * in `report` mode the directives ride a second, report-only header while the
   * main policy stays enforced. Report-only never blocks, so the sinks that
   * would break show up before anything does.
   */
  const trustedTypeDirectives = {
    requireTrustedTypesFor: ["'script'"],
    // Only the app's own policy may be created. Without this any script could
    // mint a policy and hand itself the trust the directive was meant to gate.
    trustedTypes: ["originloom"],
  };
  const trustedTypesReportOnly =
    config.trustedTypes === "report" && config.cspEnforce ? trustedTypeDirectives : undefined;

  const securityHeaders = secureHeaders({
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    // Stated rather than inherited. Both of these were already on every response
    // as `secureHeaders` defaults, which is the same bytes and a different
    // thing: an inherited default changes when the dependency changes its mind,
    // and nobody reviews that. Written down, they are ours.
    //
    // COOP severs the `window.opener` link, so a page this site opens — or one
    // that opens it — cannot reach into its window. Origin-Agent-Cluster asks
    // the browser for an isolated agent cluster, which is what makes
    // `document.domain` inert and lets the process be separated.
    crossOriginOpenerPolicy: "same-origin",
    originAgentCluster: "?1",
    // COEP is deliberately absent, and this is the note that keeps someone from
    // "completing the set": it requires every third-party subresource to send
    // CORP, and the third party this site cannot drop is GTM. Turning it on
    // would break the tag manager to buy cross-origin isolation nothing here
    // uses. See docs/framework-research-2026.md § 5.4.
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
    },
    ...(config.cspEnforce
      ? { contentSecurityPolicy: withTrustedTypes(cspDirectives, "enforce") }
      : { contentSecurityPolicyReportOnly: withTrustedTypes(cspDirectives, "report-only") }),
    ...(trustedTypesReportOnly
      ? { contentSecurityPolicyReportOnly: { ...trustedTypesReportOnly } }
      : {}),
  });

  return async (c, next) => {
    // A nonce/hash source makes browsers ignore 'unsafe-inline'. Development intentionally relies on
    // 'unsafe-inline' for Vite/React Refresh, so nonce must be a production-only contract.
    const nonce = config.isProduction ? randomBytes(18).toString("base64") : undefined;
    if (nonce) c.set("cspNonce", nonce);
    return securityHeaders(c, next);
  };
}
