/** @typedef {"GET" | "HEAD" | "POST"} HttpMethod */

/**
 * @typedef {object} LoadScenario
 * @property {string} id
 * @property {string} description
 * @property {string} path
 * @property {HttpMethod} [method]
 * @property {Record<string, string>} [headers]
 * @property {string} [body]
 * @property {number} connections
 * @property {number} durationSec
 * @property {number} pipelining
 * @property {number} [warmupSec]
 * @property {number} [cooldownSec]
 * @property {string} [expectCache]
 * @property {number[]} [acceptableStatusCodes] Autocannon non2xx sayımından düşülür (ör. 303 redirect)
 */

/** Shared browser-like headers for SSR routes. */
export const browserHeaders = {
  "User-Agent":
    "origin-loom-loadtest/1.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "tr-TR,tr;q=0.9",
};

/**
 * Ordered scenarios. Earlier cache-heavy routes help warm shared HTML before HIT measurements.
 * @type {LoadScenario[]}
 */
export const scenarios = [
  {
    id: "warmup-health",
    description: "Liveness probe baseline",
    path: "/healthz",
    connections: 4,
    durationSec: 10,
    pipelining: 1,
  },
  {
    id: "cache-miss-home",
    description: "Full SSR + shell on home (first fill after cold start)",
    path: "/",
    headers: browserHeaders,
    connections: 20,
    durationSec: 20,
    pipelining: 1,
    warmupSec: 5,
    expectCache: "MISS",
  },
  {
    id: "cache-hit-home",
    description: "Shared page cache HIT on home",
    path: "/",
    headers: browserHeaders,
    connections: 50,
    durationSec: 30,
    pipelining: 1,
    warmupSec: 5,
    expectCache: "HIT",
  },
  {
    id: "cache-hit-bank",
    description: "Low-cardinality shared bank profile (15m TTL registry)",
    path: "/bankalar/is-bankasi",
    headers: browserHeaders,
    connections: 40,
    durationSec: 25,
    pipelining: 1,
    warmupSec: 5,
    expectCache: "HIT",
  },
  {
    id: "cache-miss-housing-catalog",
    description: "Filtered housing catalog with query key fragmentation",
    path: "/konut-kredisi?amount=2500000&term=84",
    headers: browserHeaders,
    connections: 30,
    durationSec: 25,
    pipelining: 1,
    warmupSec: 5,
  },
  {
    id: "cache-bypass-calculator",
    description: "High-cardinality BYPASS route (loan calculator)",
    path: "/araclar/kredi-hesaplama?amount=1500000&term=60&rate=2.75",
    headers: browserHeaders,
    connections: 25,
    durationSec: 25,
    pipelining: 1,
  },
  {
    id: "cache-bypass-account",
    description: "Personal shell BYPASS (neverCache registry)",
    path: "/hesabim",
    headers: browserHeaders,
    connections: 20,
    durationSec: 20,
    pipelining: 1,
  },
  {
    id: "cache-short-bist",
    description: "Short TTL shared market snapshot",
    path: "/piyasalar/bist-100",
    headers: browserHeaders,
    connections: 35,
    durationSec: 25,
    pipelining: 1,
    warmupSec: 5,
  },
  {
    id: "mixed-catalog",
    description: "Weighted public catalog mix (simulates browse traffic)",
    path: "/",
    headers: browserHeaders,
    connections: 60,
    durationSec: 45,
    pipelining: 1,
    warmupSec: 5,
  },
  {
    id: "capacity-ramp",
    description: "Stress ramp — watch for 503 SSR capacity and timeout 504",
    path: "/",
    headers: browserHeaders,
    connections: 120,
    durationSec: 30,
    pipelining: 1,
  },
  {
    id: "referral-post",
    description: "Same-origin referral mutation (low rate BFF POST)",
    path: "/api/referrals",
    method: "POST",
    headers: {
      ...browserHeaders,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "", // filled at runtime from base URL
    },
    body: "productType=kredi-karti&slug=maximum",
    acceptableStatusCodes: [303],
    connections: 4,
    durationSec: 15,
    pipelining: 1,
  },
];

/** Paths rotated during the mixed-catalog scenario. */
export const mixedPaths = [
  "/",
  "/konut-kredisi",
  "/kredi-kartlari",
  "/bilgi-merkezi",
  "/bankalar/is-bankasi",
  "/piyasalar/bist-100",
];
