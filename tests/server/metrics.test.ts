import {
  observeCacheEntryWrite,
  observeCacheOperation,
  observeGatewayRequest,
  observeRequest,
  observeRevalidation,
  renderMetrics,
} from "@server/metrics";
import { describe, expect, it } from "vitest";

describe("production metrics", () => {
  it("exports bounded latency histograms and gateway outcomes", () => {
    observeRequest(200, "HIT", 7);
    observeGatewayRequest(0, 25, "timeout");
    observeCacheOperation("redis", "read", "success", 3);
    observeRevalidation("success", 42);

    const metrics = renderMetrics();

    expect(metrics).toContain(
      'ssr_http_request_duration_milliseconds_count{status_class="2xx",cache="HIT"}',
    );
    expect(metrics).toContain('ssr_cache_response_duration_milliseconds_count{state="HIT"}');
    expect(metrics).toContain('ssr_gateway_requests_total{status_class="error",outcome="timeout"}');
    expect(metrics).toContain(
      'ssr_cache_operation_duration_milliseconds_count{backend="redis",operation="read",outcome="success"}',
    );
    expect(metrics).toContain(
      'ssr_cache_revalidation_duration_milliseconds_count{outcome="success"}',
    );
  });

  it("exports event-loop, process and release gauges", () => {
    const metrics = renderMetrics();

    expect(metrics).toContain("ssr_event_loop_lag_p99_seconds");
    expect(metrics).toContain("process_resident_memory_bytes");
    expect(metrics).toContain("process_cpu_user_seconds_total");
    expect(metrics).toContain('ssr_release_info{service="ssr-kit",release="development"} 1');
  });

  it("exports bounded cache cardinality and entry size metrics", () => {
    observeCacheEntryWrite("loan\0istanbul\0amount=50000", "<html>bounded</html>");
    observeCacheEntryWrite("loan\0istanbul\0amount=50000", "<html>updated</html>");

    const metrics = renderMetrics();
    expect(metrics).toContain('ssr_cache_entry_body_bytes_count{route="loan"} 2');
    expect(metrics).toContain('ssr_cache_key_bytes_count{route="loan"} 2');
    expect(metrics).toContain('ssr_cache_distinct_keys_observed{route="loan"} 1');
    expect(metrics).toContain("ssr_cache_cardinality_overflow_total");
  });
});
