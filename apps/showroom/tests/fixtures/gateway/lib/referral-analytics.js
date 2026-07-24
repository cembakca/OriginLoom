const MAX_UNIQUE_SESSIONS_PER_PRODUCT = 50_000;
const MAX_LATENCY_SAMPLES_PER_PRODUCT = 1_000;
const statsByProduct = new Map();

export function recordReferralIssued(product, anonymousSessionId, durationMs) {
  const key = `${product.productType}:${product.slug}`;
  const current = statsByProduct.get(key) ?? createStats(product);
  current.redirectIssued += 1;
  if (
    anonymousSessionId &&
    (current.anonymousSessions.has(anonymousSessionId) ||
      current.anonymousSessions.size < MAX_UNIQUE_SESSIONS_PER_PRODUCT)
  ) {
    current.anonymousSessions.add(anonymousSessionId);
  }
  current.latencySamples.push(Math.max(0, Number(durationMs.toFixed(3))));
  if (current.latencySamples.length > MAX_LATENCY_SAMPLES_PER_PRODUCT) {
    current.latencySamples.shift();
  }
  current.lastIssuedAt = new Date().toISOString();
  statsByProduct.set(key, current);
}

export function referralStatsSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    measurement: "redirect-issued",
    products: [...statsByProduct.values()]
      .map(toSnapshot)
      .sort((a, b) => b.redirectIssued - a.redirectIssued),
  };
}

export function resetReferralStats() {
  statsByProduct.clear();
}

function createStats(product) {
  return {
    product: {
      productType: product.productType,
      slug: product.slug,
      name: product.name,
      bank: product.bank.name,
    },
    redirectIssued: 0,
    anonymousSessions: new Set(),
    latencySamples: [],
    lastIssuedAt: null,
  };
}

function toSnapshot(stats) {
  const sorted = [...stats.latencySamples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    ...stats.product,
    redirectIssued: stats.redirectIssued,
    uniqueSessions: stats.anonymousSessions.size,
    latency: {
      sampleCount: sorted.length,
      averageMs: sorted.length ? Number((total / sorted.length).toFixed(3)) : 0,
      p95Ms: sorted[p95Index] ?? 0,
      maxMs: sorted.at(-1) ?? 0,
    },
    lastIssuedAt: stats.lastIssuedAt,
  };
}
