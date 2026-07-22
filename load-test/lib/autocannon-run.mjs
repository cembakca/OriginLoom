import autocannon from "autocannon";
import { setMaxListeners } from "node:events";

setMaxListeners(32);

/**
 * @param {object} input
 * @param {string} input.url
 * @param {import("../scenarios.mjs").LoadScenario & { workers?: number }} input.scenario
 * @param {string[]} [input.urls]
 * @param {number} [input.workers]
 */
export function runAutocannon({ url, scenario, urls, workers }) {
  const headers = { ...(scenario.headers ?? {}) };
  if (headers.Origin === "") headers.Origin = new URL(url).origin;

  /** @type {import("autocannon").Options} */
  const options = {
    url,
    method: scenario.method ?? "GET",
    connections: scenario.connections,
    duration: scenario.durationSec,
    pipelining: scenario.pipelining,
    headers,
    ...(scenario.body ? { body: scenario.body } : {}),
    ...(urls ? { urls } : {}),
    ...((workers ?? scenario.workers) ? { workers: workers ?? scenario.workers } : {}),
  };

  return new Promise((resolve, reject) => {
    const instance = autocannon(options, (error, result) => {
      if (error) reject(error);
      else resolve(normalizeResult(scenario, result));
    });
    autocannon.track(instance, { renderProgressBar: true });
  });
}

/**
 * @param {import("../scenarios.mjs").LoadScenario} scenario
 * @param {import("autocannon").Result} result
 */
function normalizeResult(scenario, result) {
  const statusCodes = Object.fromEntries(
    Object.entries(result.statusCodeStats ?? {}).map(([code, stats]) => [
      code,
      /** @type {{ count?: number }} */ (stats).count ?? 0,
    ]),
  );
  const acceptable = scenario.acceptableStatusCodes ?? [];
  const acceptableCount = acceptable.reduce(
    (sum, code) => sum + (statusCodes[String(code)] ?? 0),
    0,
  );
  const non2xx = Math.max(0, result.non2xx - acceptableCount);
  const errors = result.errors + result.timeouts + non2xx;
  const total = result.requests.total || 1;

  return {
    id: scenario.id,
    requests: {
      total: result.requests.total,
      average: round(result.requests.average),
      p50: round(result.requests.p50 ?? result.latency.p50),
      p99: round(result.requests.p99 ?? result.latency.p99),
    },
    throughput: {
      average: round(result.throughput.average),
      p50: round(result.throughput.p50 ?? 0),
      p99: round(result.throughput.p99 ?? 0),
    },
    latency: {
      average: round(result.latency.average),
      p50: round(result.latency.p50),
      p90: round(result.latency.p90 ?? 0),
      p99: round(result.latency.p99),
      max: round(result.latency.max),
    },
    statusCodes,
    errors: {
      total: errors,
      ratePct: round((errors / total) * 100),
      timeouts: result.timeouts,
      non2xx: result.non2xx,
    },
    durationSec: round(result.duration),
  };
}

/** @param {number} value */
function round(value) {
  return Math.round(value * 100) / 100;
}
