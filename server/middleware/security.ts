import crypto from "node:crypto";
import { secureHeaders } from "hono/secure-headers";

import {
  buildEventQueueScript,
  buildGtmScript,
  EARLY_TRACKING_SCRIPT,
} from "~/components/analytics/gtm-bootstrap";

import { config } from "../config";

function sha256(content: string): string {
  const hash = crypto.createHash("sha256").update(content).digest("base64");
  return `'sha256-${hash}'`;
}

// Local development requires arbitrary inline script execution for Vite HMR / React Refresh.
// Since modern browsers ignore 'unsafe-inline' if hashes are present in script-src,
// we only compute and specify hashes in production to keep local dev fully working.
const hashes = config.isProduction
  ? [
      sha256("window.dataLayer=window.dataLayer||[];"),
      sha256(buildEventQueueScript()),
      sha256(EARLY_TRACKING_SCRIPT),
    ]
  : [];

if (config.isProduction && config.gtmContainerId) {
  hashes.push(sha256(buildGtmScript(config.gtmContainerId)));
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

export const securityMiddleware = secureHeaders({
  xContentTypeOptions: "nosniff",
  xFrameOptions: "DENY",
  referrerPolicy: "strict-origin-when-cross-origin",
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: [],
  },
  contentSecurityPolicyReportOnly: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "https://www.googletagmanager.com",
      ...hashes,
      ...devScripts,
      ...devViteUrls,
    ],
    connectSrc: [
      "'self'",
      "https://www.google-analytics.com",
      "https://*.google-analytics.com",
      "https://*.analytics.google.com",
      "https://*.googletagmanager.com",
      ...devViteUrls,
      ...devViteWsUrls,
    ],
    imgSrc: [
      "'self'",
      "data:",
      "https://www.googletagmanager.com",
      "https://www.google-analytics.com",
      "https://*.google-analytics.com",
      "https://*.analytics.google.com",
      "https://*.googlesyndication.com",
    ],
    frameSrc: [
      "'self'",
      "https://www.googletagmanager.com",
    ],
    styleSrc: ["'self'", "'unsafe-inline'", ...devViteUrls],
    fontSrc: ["'self'", "data:"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
  },
});
