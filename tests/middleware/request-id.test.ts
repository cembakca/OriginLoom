import { normalizeRequestId } from "@server/middleware/request-id";
import { describe, expect, it } from "vitest";

describe("request id", () => {
  it("keeps a bounded safe upstream id", () => {
    expect(normalizeRequestId("edge_01:request-2")).toBe("edge_01:request-2");
  });

  it("replaces unsafe or oversized ids", () => {
    expect(normalizeRequestId("line\nbreak")).toMatch(/^[0-9a-f-]{36}$/);
    expect(normalizeRequestId("x".repeat(129))).toMatch(/^[0-9a-f-]{36}$/);
  });
});
