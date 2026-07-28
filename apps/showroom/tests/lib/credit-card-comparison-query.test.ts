import { describe, expect, it } from "vitest";

import {
  comparisonSearch,
  defaultComparedCreditCards,
  parseComparedCreditCards,
} from "~/lib/credit-card-comparison-query";

describe("credit card comparison query", () => {
  it("uses a stable default and canonical comma-separated query", () => {
    const parsed = parseComparedCreditCards(new URLSearchParams());
    expect(parsed).toEqual([...defaultComparedCreditCards]);
    expect(comparisonSearch(parsed ?? []).toString()).toBe("products=maximum%2Cbonus%2Caxess");
  });

  it.each(["maximum", "maximum,maximum", "maximum,bonus,axess,world", "maximum,../bonus"])(
    "rejects an unsafe or unbounded selection: %s",
    (products) => {
      expect(parseComparedCreditCards(new URLSearchParams({ products }))).toBeNull();
    },
  );
});
