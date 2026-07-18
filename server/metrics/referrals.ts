import { counterLines, type CounterMap, escapeLabel, Histogram, increment } from "./primitives";

const DURATION_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const referralRedirects: CounterMap = new Map();
const referralRedirectDurations = new Histogram(DURATION_BUCKETS_MS);
const referralGatewayProcessingDurations = new Histogram(DURATION_BUCKETS_MS);

export function observeReferralRedirect(
  productType: string,
  outcome: "issued" | "invalid_request" | "unknown_product" | "unsafe_destination" | "error",
  durationMs: number,
  gatewayProcessingMs?: number,
): void {
  const labels = `product_type="${escapeLabel(productType)}",outcome="${outcome}"`;
  increment(referralRedirects, labels);
  referralRedirectDurations.observe(labels, durationMs);
  if (gatewayProcessingMs !== undefined) {
    referralGatewayProcessingDurations.observe(
      `product_type="${escapeLabel(productType)}"`,
      gatewayProcessingMs,
    );
  }
}

export function referralMetricLines(): string[] {
  return [
    ...counterLines(
      "ssr_referral_redirects_total",
      "Server-issued bank referral redirects",
      referralRedirects,
    ),
    ...referralRedirectDurations.lines(
      "ssr_referral_redirect_duration_milliseconds",
      "End-to-end referral redirect creation duration",
    ),
    ...referralGatewayProcessingDurations.lines(
      "ssr_referral_gateway_processing_milliseconds",
      "Gateway-reported referral ticket processing duration",
    ),
  ];
}
