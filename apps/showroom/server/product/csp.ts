import type { CspSources } from "@originloom/core/middleware/security";

/**
 * The third-party origins this product's pages reach: Google Tag Manager and
 * the Analytics endpoints it loads.
 *
 * They are listed here rather than in the platform because the vendor is a
 * product decision — another app on the same platform may use a different one,
 * or none, and should not inherit these.
 */
export const productCsp: CspSources = {
  scriptSrc: ["https://www.googletagmanager.com"],
  connectSrc: [
    "https://www.google-analytics.com",
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://*.googletagmanager.com",
  ],
  imgSrc: [
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://*.googlesyndication.com",
  ],
  // GTM previews and some tags render in an iframe.
  frameSrc: ["https://www.googletagmanager.com"],
};
