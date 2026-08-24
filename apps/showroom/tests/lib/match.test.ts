import type { Route } from "@originloom/react/lib/types";
import { isUnreachablePattern, match, matchesPath } from "@originloom/shared/lib/match";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

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

  /**
   * The catch-all both apps' rule tables open with. It read as an ordinary
   * one-segment parameter named `path*` until this existed, so the general rule
   * matched `/urun` and neither `/` nor `/urun/kasko`.
   */
  it("matches the rest of the path, including none of it", () => {
    const rest = [stub("/:path*")];

    expect(match(rest, "/")?.params.path).toBe("");
    expect(match(rest, "/urun")?.params.path).toBe("urun");
    expect(match(rest, "/urun/kasko")?.params.path).toBe("urun/kasko");
  });

  it("matches a rest parameter that follows static segments", () => {
    const routes = [stub("/docs/:rest*")];

    expect(match(routes, "/docs")?.params.rest).toBe("");
    expect(match(routes, "/docs/a/b/c")?.params.rest).toBe("a/b/c");
    expect(match(routes, "/blog/a")).toBeNull();
  });

  it("treats a malformed segment inside a rest parameter as no match", () => {
    expect(matchesPath("/:path*", "/blog/%E0%A4%A")).toBe(false);
  });

  it("returns first match in route table order", () => {
    const ordered = [stub("/a/:id"), stub("/a/special")];
    expect(match(ordered, "/a/special")?.route.path).toBe("/a/:id");
  });
});

describe("isUnreachablePattern", () => {
  /** A rest parameter consumes everything, so anything after it can never run. */
  it("names a pattern whose rest parameter is not last", () => {
    expect(isUnreachablePattern("/:path*/edit")).toBe(true);
    expect(isUnreachablePattern("/:path*")).toBe(false);
    expect(isUnreachablePattern("/urun/:slug")).toBe(false);
  });
});
