import { describe, expect, it } from "vitest";

import { financeQueryNormalizers, normalizedSearch } from "~/lib/finance-query";

describe("finance query normalization", () => {
  it("uses product defaults when numeric params are absent or empty", () => {
    expect(financeQueryNormalizers.amount?.(null)).toBe("2000000");
    expect(financeQueryNormalizers.amount?.("")).toBe("2000000");
    expect(financeQueryNormalizers.term?.(null)).toBe("120");
  });

  it("builds a bounded gateway query from content params only", () => {
    const search = normalizedSearch(
      new URL("http://localhost/konut-kredisi?amount=2500000&term=84&utm_source=test"),
      ["amount", "term", "city"],
    );

    expect(search.toString()).toBe("amount=2500000&term=84&city=istanbul");
  });
});
