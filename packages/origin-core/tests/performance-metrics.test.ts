import { describe, expect, it } from "vitest";

import { observePayloadSize, observeSerialization, renderMetrics } from "../src/metrics";

describe("performance metrics", () => {
  it("exports bounded serialization and payload histograms", () => {
    observeSerialization("document_render", "/performance-test", 12);
    observePayloadSize("html", "/performance-test", 12_345);

    const metrics = renderMetrics();
    expect(metrics).toContain(
      'ssr_serialization_duration_milliseconds_count{kind="document_render",label="/performance-test"} 1',
    );
    expect(metrics).toContain(
      'ssr_payload_size_bytes_count{kind="html",label="/performance-test"} 1',
    );
    expect(metrics).toContain(
      'ssr_payload_size_bytes_sum{kind="html",label="/performance-test"} 12345',
    );
  });
});
