/**
 * @param {string} metricsUrl
 */
export async function scrapeMetrics(metricsUrl) {
  const response = await fetch(`${metricsUrl}/metrics`);
  if (!response.ok) throw new Error(`Metrics scrape failed: ${response.status}`);
  const text = await response.text();
  return {
    scrapedAt: new Date().toISOString(),
    raw: text,
    summary: extractCounters(text, [
      "ssr_http_requests_total",
      "ssr_http_request_duration_milliseconds",
      "ssr_cache_response_duration_milliseconds",
      "ssr_request_timeout_total",
      "ssr_ssr_capacity_rejected_total",
      "ssr_ssr_queue_wait_milliseconds",
      "ssr_gateway_requests_total",
      "ssr_gateway_invalid_payload_total",
    ]),
  };
}

/**
 * @param {string} body
 * @param {string[]} prefixes
 */
function extractCounters(body, prefixes) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const line of body.split("\n")) {
    if (line.startsWith("#") || !line.trim()) continue;
    const prefix = prefixes.find((name) => line.startsWith(name));
    if (prefix) {
      out[prefix] ??= [];
      out[prefix].push(line.trim());
    }
  }
  return out;
}
