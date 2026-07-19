import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { match } from "~/lib/match";
import type { Route } from "~/lib/types";

const stub = (path: string): Route => ({
  path,
  loader: async () => ({ data: {} }),
  Component: () => null as unknown as ReactElement,
});

describe("match", () => {
  const routes = [stub("/"), stub("/hesabim"), stub("/catalog/:city?"), stub("/blog/:slug")];

  it("matches static paths", () => {
    expect(match(routes, "/")?.route.path).toBe("/");
    expect(match(routes, "/hesabim")?.route.path).toBe("/hesabim");
  });

  it("matches optional params", () => {
    expect(match(routes, "/catalog")?.params.city).toBeUndefined();
    expect(match(routes, "/catalog/ankara")?.params.city).toBe("ankara");
  });

  it("returns null when no route matches", () => {
    expect(match(routes, "/unknown")).toBeNull();
  });

  it("treats malformed percent-encoded params as no match", () => {
    expect(match(routes, "/blog/%E0%A4%A")).toBeNull();
  });

  it("returns first match in route table order", () => {
    const ordered = [stub("/a/:id"), stub("/a/special")];
    expect(match(ordered, "/a/special")?.route.path).toBe("/a/:id");
  });
});
