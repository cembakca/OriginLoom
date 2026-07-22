import { browserHeaders } from "./scenarios.mjs";

/**
 * @typedef {import("./scenarios.mjs").LoadScenario & {
 *   phases?: Array<{
 *     connections: number;
 *     durationSec: number;
 *     path?: string;
 *     suffix?: string;
 *   }>;
 *   urlFactory?: (baseUrl: string) => string[];
 * }} StressScenario
 */

/** @param {string} baseUrl @param {number} count */
export function calculatorStormUrls(baseUrl, count = 120) {
  return Array.from({ length: count }, (_, index) => {
    const amount = 750_000 + index * 37_500;
    const term = 12 + (index % 108);
    const rate = (1.25 + (index % 80) / 20).toFixed(2);
    return `${baseUrl}/araclar/kredi-hesaplama?amount=${amount}&term=${term}&rate=${rate}`;
  });
}

/** @param {string} baseUrl @param {number} count */
export function housingStampedeUrls(baseUrl, count = 100) {
  return Array.from({ length: count }, (_, index) => {
    const amount = 400_000 + index * 55_000;
    const term = 12 + (index % 132);
    return `${baseUrl}/konut-kredisi?amount=${amount}&term=${term}`;
  });
}

/** @param {string} baseUrl */
export function hostileMixedUrls(baseUrl) {
  return [
    `${baseUrl}/`,
    `${baseUrl}/konut-kredisi`,
    `${baseUrl}/kredi-kartlari`,
    `${baseUrl}/bilgi-merkezi`,
    `${baseUrl}/bankalar/is-bankasi`,
    `${baseUrl}/piyasalar/bist-100`,
    `${baseUrl}/hesabim`,
    `${baseUrl}/araclar/kredi-hesaplama?amount=900000&term=36&rate=2.1`,
    `${baseUrl}/araclar/kredi-hesaplama?amount=1200000&term=48&rate=2.4`,
    `${baseUrl}/konut-kredisi?amount=1800000&term=96`,
  ];
}

/**
 * Ciddi stres matrisi — SSR_MAX_CONCURRENCY=32 + SSR_MAX_QUEUE=64 sınırını bilinçli aşmayı hedefler.
 * 503 (capacity) ve 504 (deadline) burada beklenen sinyallerdir.
 * @type {StressScenario[]}
 */
export const stressScenarios = [
  {
    id: "stress-baseline",
    description: "Post-warmup sanity — düşük concurrency",
    path: "/healthz",
    connections: 8,
    durationSec: 15,
    pipelining: 1,
  },
  {
    id: "stress-ssr-saturation",
    description: "Tek route SSR doygunluğu — 384 eşzamanlı bağlantı, 2 dk",
    path: "/",
    headers: browserHeaders,
    connections: 384,
    durationSec: 120,
    pipelining: 1,
    warmupSec: 10,
    cooldownSec: 20,
  },
  {
    id: "stress-bypass-calculator-storm",
    description: "120 benzersiz BYPASS hesaplama URL — gateway + SSR yükü",
    path: "/araclar/kredi-hesaplama?amount=1500000&term=60&rate=2.75",
    headers: browserHeaders,
    connections: 220,
    durationSec: 90,
    pipelining: 1,
    urlFactory: calculatorStormUrls,
    cooldownSec: 15,
  },
  {
    id: "stress-cache-stampede",
    description: "100 benzersiz katalog query key — cold-fill / coalescing baskısı",
    path: "/konut-kredisi?amount=2500000&term=84",
    headers: browserHeaders,
    connections: 240,
    durationSec: 75,
    pipelining: 1,
    urlFactory: housingStampedeUrls,
    cooldownSec: 15,
  },
  {
    id: "stress-mixed-hostile",
    description: "HIT + BYPASS + kişisel shell karışımı — 3 dk soak",
    path: "/",
    headers: browserHeaders,
    connections: 256,
    durationSec: 180,
    pipelining: 1,
    urlFactory: hostileMixedUrls,
    cooldownSec: 20,
  },
  {
    id: "stress-capacity-ramp",
    description: "Kademeli kapasite rampası — 96 → 512 bağlantı",
    path: "/",
    headers: browserHeaders,
    connections: 96,
    durationSec: 45,
    pipelining: 1,
    phases: [
      { connections: 96, durationSec: 45, suffix: "c96" },
      { connections: 192, durationSec: 60, suffix: "c192" },
      { connections: 384, durationSec: 90, suffix: "c384" },
      { connections: 512, durationSec: 75, suffix: "c512" },
    ],
    cooldownSec: 25,
  },
  {
    id: "stress-deadline-hammer",
    description: "BYPASS hesap + hesaplama — deadline/504 avı",
    path: "/hesabim",
    headers: browserHeaders,
    connections: 300,
    durationSec: 90,
    pipelining: 1,
    urlFactory: (baseUrl) => [
      `${baseUrl}/hesabim`,
      `${baseUrl}/araclar/kredi-hesaplama?amount=2000000&term=72&rate=3.1`,
      `${baseUrl}/araclar/kredi-hesaplama?amount=800000&term=24&rate=1.9`,
    ],
    cooldownSec: 15,
  },
  {
    id: "stress-recovery",
    description: "Soğuma — steady-state'e dönüş (hata oranı sıfıra yakın olmalı)",
    path: "/",
    headers: browserHeaders,
    connections: 24,
    durationSec: 45,
    pipelining: 1,
    expectRecovery: true,
  },
];

/** @type {string[]} */
export const stressQuickIds = [
  "stress-baseline",
  "stress-ssr-saturation",
  "stress-capacity-ramp",
  "stress-recovery",
];
