import { describe, expect, it } from "vitest";

import { normalizePublicUrl } from "@originloom/react/routing";

describe("public URL normalization", () => {
  it.each([
    ["http://localhost/foo/", "http://localhost/foo"],
    ["http://localhost/foo//", "http://localhost/foo"],
    ["http://localhost//foo///bar", "http://localhost/foo/bar"],
    ["http://localhost/f%6Fo", "http://localhost/foo"],
  ])("redirects %s to one canonical path identity", (input, expected) => {
    expect(normalizePublicUrl(new URL(input))).toEqual({
      kind: "redirect",
      pathname: new URL(expected).pathname,
      location: expected,
    });
  });

  it("preserves the query string and its ordering during normalization", () => {
    const result = normalizePublicUrl(new URL("http://localhost/foo//?b=2&a=1&a=3"));

    expect(result).toEqual({
      kind: "redirect",
      pathname: "/foo",
      location: "http://localhost/foo?b=2&a=1&a=3",
    });
  });

  it("normalizes canonically equivalent Unicode paths to NFC", () => {
    const decomposed = new URL(`http://localhost/cafe\u0301`);
    const result = normalizePublicUrl(decomposed);

    expect(result).toEqual({
      kind: "redirect",
      pathname: "/caf%C3%A9",
      location: "http://localhost/caf%C3%A9",
    });
    expect(normalizePublicUrl(new URL("http://localhost/caf%C3%A9"))).toEqual({
      kind: "ok",
      pathname: "/caf%C3%A9",
    });
  });

  it.each(["%2F", "%2f", "%5C", "%5c"])("rejects encoded path separator %s", (separator) => {
    expect(normalizePublicUrl(new URL(`http://localhost/foo${separator}bar`))).toEqual({
      kind: "invalid",
      reason: "encoded-separator",
    });
  });

  it.each(["%", "%2", "%GG"])("rejects malformed percent encoding %s", (encoding) => {
    expect(normalizePublicUrl(new URL(`http://localhost/foo${encoding}`))).toEqual({
      kind: "invalid",
      reason: "malformed-encoding",
    });
  });

  it("preserves case by default and exposes lowercase only as an explicit policy", () => {
    expect(normalizePublicUrl(new URL("http://localhost/FOO"))).toEqual({
      kind: "ok",
      pathname: "/FOO",
    });
    expect(
      normalizePublicUrl(new URL("http://localhost/FOO"), { casePolicy: "lowercase" }),
    ).toEqual({
      kind: "redirect",
      pathname: "/foo",
      location: "http://localhost/foo",
    });
  });
});
