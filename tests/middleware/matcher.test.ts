import { describe, expect, it } from "vitest";
import { shouldRunPipeline } from "../../server/middleware/matcher";

describe("shouldRunPipeline", () => {
  it("skips static assets", () => {
    expect(shouldRunPipeline("/assets/entry.client.js")).toBe(false);
    expect(shouldRunPipeline("/favicon.ico")).toBe(false);
  });

  it("skips health probes", () => {
    expect(shouldRunPipeline("/healthz")).toBe(false);
    expect(shouldRunPipeline("/readyz")).toBe(false);
  });

  it("skips public API but allows internal BFF", () => {
    expect(shouldRunPipeline("/api/users")).toBe(false);
    expect(shouldRunPipeline("/api/internal/refresh")).toBe(true);
  });

  it("runs for SSR pages", () => {
    expect(shouldRunPipeline("/emekli-bankaciligi")).toBe(true);
    expect(shouldRunPipeline("/blogs/paginated")).toBe(true);
  });
});
