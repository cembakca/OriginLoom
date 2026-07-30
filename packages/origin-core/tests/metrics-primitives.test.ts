import { describe, expect, it } from "vitest";

import { Histogram } from "../src/metrics/primitives.js";

describe("hot-path histogram storage", () => {
  it("expands non-cumulative observations to Prometheus cumulative buckets at scrape time", () => {
    const histogram = new Histogram([10, 20, 30]);
    histogram.observe('route="catalog"', 5);
    histogram.observe('route="catalog"', 15);
    histogram.observe('route="catalog"', 40);

    const output = histogram.lines("duration_ms", "Duration").join("\n");
    expect(output).toContain('duration_ms_bucket{route="catalog",le="10"} 1');
    expect(output).toContain('duration_ms_bucket{route="catalog",le="20"} 2');
    expect(output).toContain('duration_ms_bucket{route="catalog",le="30"} 2');
    expect(output).toContain('duration_ms_bucket{route="catalog",le="+Inf"} 3');
  });
});
