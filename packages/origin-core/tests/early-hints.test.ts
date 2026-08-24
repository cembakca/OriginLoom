import { describe, expect, it, vi } from "vitest";

import { earlyHintLinks, sendEarlyHints, shouldSendEarlyHints } from "../src/early-hints.js";

const assets = {
  js: "/assets/entry.abc.js",
  css: ["/assets/entry.abc.css"],
  fonts: [
    {
      family: "Inter",
      style: "normal",
      weight: "400",
      display: "swap" as const,
      unicodeRange: "U+0-7F",
      preload: true,
      href: "/fonts/inter.woff2",
    },
    {
      family: "Inter",
      style: "italic",
      weight: "400",
      display: "swap" as const,
      unicodeRange: "U+0-7F",
      preload: false,
      href: "/fonts/inter-italic.woff2",
    },
  ],
};

describe("earlyHintLinks", () => {
  it("hints only what the first paint waits for", () => {
    expect(earlyHintLinks(assets)).toEqual([
      "</assets/entry.abc.css>; rel=preload; as=style",
      // `modulepreload`, not `preload; as=script`: the entry is an ES module and
      // the two are separate cache entries — the wrong one fetches it twice.
      "</assets/entry.abc.js>; rel=modulepreload",
      // Fonts are cross-origin-fetched even same-origin; without `crossorigin`
      // the browser discards the preload and fetches again.
      "</fonts/inter.woff2>; rel=preload; as=font; type=font/woff2; crossorigin",
    ]);
  });

  it("leaves out a font the build did not mark for preload", () => {
    expect(earlyHintLinks(assets).join(" ")).not.toContain("inter-italic");
  });
});

describe("shouldSendEarlyHints", () => {
  const base = { enabled: true, method: "GET", isDocumentRequest: true, willRenderFresh: true };

  it("hints a document that is about to be rendered fresh", () => {
    expect(shouldSendEarlyHints(base)).toBe(true);
  });

  /** The whole point: a HIT already has the document, so a 103 is pure cost. */
  it.each([
    ["disabled", { enabled: false }],
    ["a cache hit", { willRenderFresh: false }],
    ["a non-document request", { isDocumentRequest: false }],
    ["a submission", { method: "POST" }],
  ])("says no for %s", (_case, patch) => {
    expect(shouldSendEarlyHints({ ...base, ...patch })).toBe(false);
  });
});

describe("sendEarlyHints", () => {
  it("writes the links to a runtime that supports them", () => {
    const writeEarlyHints = vi.fn();

    expect(sendEarlyHints({ writeEarlyHints, headersSent: false }, ["</a.css>; rel=preload"])).toBe(
      true,
    );
    expect(writeEarlyHints).toHaveBeenCalledWith({ link: ["</a.css>; rel=preload"] });
  });

  /**
   * A 103 is an optimisation the real response does not depend on. Every one of
   * these is a reason to skip it, never a reason to fail a request that is about
   * to succeed.
   */
  it.each([
    ["no runtime support", {}],
    ["headers already sent", { writeEarlyHints: vi.fn(), headersSent: true }],
    ["a client that hung up", { writeEarlyHints: vi.fn(), writableEnded: true }],
    [
      "a runtime that throws",
      {
        writeEarlyHints: () => {
          throw new Error("socket gone");
        },
      },
    ],
    ["no outgoing at all", null],
  ])("stays silent on %s", (_case, outgoing) => {
    expect(sendEarlyHints(outgoing, ["</a.css>; rel=preload"])).toBe(false);
  });

  it("does not write an empty hint", () => {
    const writeEarlyHints = vi.fn();
    expect(sendEarlyHints({ writeEarlyHints }, [])).toBe(false);
    expect(writeEarlyHints).not.toHaveBeenCalled();
  });
});
