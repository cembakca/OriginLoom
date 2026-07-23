import { describe, expect, it } from "vitest";

import {
  isBoundedRouteSlug,
  MAX_PAGE,
  parsePage,
  resolvePageParam,
} from "@originloom/react/lib/content-values";

describe("bounded content values", () => {
  it("caps permissive API page parsing", () => {
    expect(parsePage("2")).toBe(2);
    expect(parsePage("999999999")).toBe(MAX_PAGE);
    expect(parsePage("invalid")).toBe(1);
  });

  it("classifies public page params before cache lookup", () => {
    expect(resolvePageParam(null)).toEqual({ kind: "valid", page: 1 });
    expect(resolvePageParam("2")).toEqual({ kind: "valid", page: 2 });
    expect(resolvePageParam("1")).toEqual({ kind: "redirect", page: 1 });
    expect(resolvePageParam("002")).toEqual({ kind: "redirect", page: 2 });
    expect(resolvePageParam("0")).toEqual({ kind: "invalid" });
    expect(resolvePageParam(String(MAX_PAGE + 1))).toEqual({ kind: "invalid" });
    expect(resolvePageParam("2.5")).toEqual({ kind: "invalid" });
  });

  it("accepts only bounded lowercase route slugs", () => {
    expect(isBoundedRouteSlug("istanbul")).toBe(true);
    expect(isBoundedRouteSlug("uzun-slug-42")).toBe(true);
    expect(isBoundedRouteSlug("INVALID")).toBe(false);
    expect(isBoundedRouteSlug("../escape")).toBe(false);
    expect(isBoundedRouteSlug("a".repeat(65))).toBe(false);
  });
});
