import { buildPaginationItems } from "@originloom/react/lib/pagination";
import { describe, expect, it } from "vitest";

describe("pagination window", () => {
  it("renders every page for a small result set", () => {
    expect(buildPaginationItems(2, 4)).toEqual([
      { kind: "page", page: 1 },
      { kind: "page", page: 2 },
      { kind: "page", page: 3 },
      { kind: "page", page: 4 },
    ]);
  });

  it("keeps a bounded window for very large totals", () => {
    const items = buildPaginationItems(50, 300);
    expect(items).toEqual([
      { kind: "page", page: 1 },
      { kind: "ellipsis", key: "1-48" },
      { kind: "page", page: 48 },
      { kind: "page", page: 49 },
      { kind: "page", page: 50 },
      { kind: "page", page: 51 },
      { kind: "page", page: 52 },
      { kind: "ellipsis", key: "52-300" },
      { kind: "page", page: 300 },
    ]);
    expect(items).toHaveLength(9);
  });

  it("defensively clamps untrusted totals", () => {
    const items = buildPaginationItems(999999, 999999);
    expect(items.at(-1)).toEqual({ kind: "page", page: 1000 });
    expect(items.length).toBeLessThanOrEqual(9);
  });
});
