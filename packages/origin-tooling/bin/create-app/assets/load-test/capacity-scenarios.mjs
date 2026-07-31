export const CAPACITY_ROUTES = [
  { id: "home", title: "Ana sayfa", path: "/", expectedStatuses: [200], category: "html-shared" },
  {
    id: "catalog",
    title: "Sayfalı liste",
    path: "/catalog",
    expectedStatuses: [200],
    category: "html-shared",
  },
  {
    id: "item-detail",
    title: "Dinamik route",
    path: "/items/konut-avantaj",
    expectedStatuses: [200],
    category: "html-shared",
  },
  {
    id: "static-redirect",
    title: "Static 308 redirect",
    path: "/old-catalog",
    expectedStatuses: [308],
    category: "redirect",
  },
  {
    id: "rewrite-query",
    title: "Rewrite + query",
    path: "/products/alpha?source=capacity",
    expectedStatuses: [200],
    category: "html-shared",
  },
  {
    id: "rewrite",
    title: "URL rewrite",
    path: "/products/alpha",
    expectedStatuses: [200],
    category: "html-shared",
  },
  {
    id: "cms-redirect",
    title: "Mock CMS redirect",
    path: "/legacy-catalog",
    expectedStatuses: [301],
    category: "redirect",
  },
  {
    id: "account",
    title: "Kişisel sayfa",
    path: "/account",
    expectedStatuses: [200],
    category: "html-uncached",
  },
  {
    id: "streaming",
    title: "Sunucu streaming",
    path: "/live",
    expectedStatuses: [200],
    category: "streaming",
  },
  {
    id: "media",
    title: "Görsel pipeline",
    path: "/media",
    expectedStatuses: [200],
    category: "html-shared",
  },
  {
    id: "showcase",
    title: "Bağımsız fragment cache",
    path: "/showcase",
    expectedStatuses: [200],
    category: "html-shared",
  },
  {
    id: "data-cache",
    title: "HTML cache yok + API data cache",
    path: "/data-cache",
    expectedStatuses: [200],
    category: "html-uncached-data-cached",
  },
  {
    id: "public-items-api",
    title: "Origin data cache olmayan public API",
    path: "/api/items",
    expectedStatuses: [200],
    category: "api-uncached",
    accept: "application/json",
    matrix: false,
  },
];

export const CAPACITY_PROFILES = {
  quick: {
    connections: [10, 50],
    durationSeconds: 3,
    repeats: 1,
    warmupSeconds: 1,
    cooldownMs: 250,
    coldBurstConnections: 20,
  },
  full: {
    connections: [10, 25, 50, 100, 200, 400],
    durationSeconds: 60,
    repeats: 3,
    warmupSeconds: 30,
    cooldownMs: 5_000,
    coldBurstConnections: 50,
  },
};

export function estimateDurationSeconds(routeCount, profile) {
  const matrix =
    routeCount * profile.connections.length * profile.repeats * profile.durationSeconds;
  const warmups = routeCount * profile.warmupSeconds;
  const cooldowns =
    routeCount * profile.connections.length * profile.repeats * (profile.cooldownMs / 1_000);
  // Build/start, cold bursts, TTL transition and report overhead.
  return Math.ceil(matrix + warmups + cooldowns + 90);
}
