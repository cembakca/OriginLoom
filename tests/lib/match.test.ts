import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { match } from "../../src/lib/match";
import type { Route } from "../../src/lib/types";

const stub = (path: string): Route => ({
  path,
  loader: async () => ({ data: {} }),
  Component: () => null as unknown as ReactElement,
});

describe("match", () => {
  const routes = [
    stub("/"),
    stub("/hesabim"),
    stub("/ihtiyac-kredisi/:city?"),
    stub("/blog/:slug"),
  ];

  it("matches static paths", () => {
    expect(match(routes, "/")?.route.path).toBe("/");
    expect(match(routes, "/hesabim")?.route.path).toBe("/hesabim");
  });

  it("matches optional params", () => {
    expect(match(routes, "/ihtiyac-kredisi")?.params.city).toBeUndefined();
    expect(match(routes, "/ihtiyac-kredisi/ankara")?.params.city).toBe("ankara");
  });

  it("returns null when no route matches", () => {
    expect(match(routes, "/unknown")).toBeNull();
  });

  it("returns first match in route table order", () => {
    const ordered = [stub("/a/:id"), stub("/a/special")];
    expect(match(ordered, "/a/special")?.route.path).toBe("/a/:id");
  });
});
