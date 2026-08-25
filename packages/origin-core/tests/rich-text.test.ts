import { richTextHtml } from "@originloom/shared/lib/rich-text";
import { describe, expect, it } from "vitest";

import { sanitizeRichText } from "../src/rich-text.js";

describe("sanitizeRichText", () => {
  /**
   * The reason the field is rendered as HTML at all. If the allowlist ate these
   * the product would quietly lose its formatting, and someone would "fix" it
   * by reaching around the sanitizer.
   */
  it("keeps the markup a CMS editor actually writes", () => {
    const authored =
      "<p>Kasko <strong>zorunlu değildir</strong>.</p>" +
      "<ul><li>Birinci</li><li>İkinci</li></ul>" +
      '<table><thead><tr><th scope="col">Tür</th></tr></thead>' +
      '<tbody><tr><td colspan="2">Kasko</td></tr></tbody></table>' +
      '<a href="/kasko" title="Kasko">detay</a>';

    expect(sanitizeRichText(authored)).toBe(authored);
  });

  it("drops a script and its contents rather than its tags alone", () => {
    const sanitized = sanitizeRichText("<p>merhaba</p><script>alert(1)</script>");

    expect(sanitized).toBe("<p>merhaba</p>");
    expect(sanitized).not.toContain("alert");
  });

  it.each([
    ["inline handler", '<p onclick="alert(1)">x</p>', "onclick"],
    ["img error handler", '<img src=x onerror="alert(1)">', "onerror"],
    ["javascript: href", '<a href="javascript:alert(1)">x</a>', "javascript"],
    ["data: href", '<a href="data:text/html,<script>alert(1)</script>">x</a>', "data:"],
    ["protocol-relative href", '<a href="//evil.example/x">x</a>', "//evil.example"],
    ["iframe", '<iframe src="https://evil.example"></iframe>', "iframe"],
    ["style attribute", '<p style="position:fixed;inset:0">x</p>', "position"],
    ["svg payload", "<svg><script>alert(1)</script></svg>", "alert"],
    ["form", '<form action="https://evil.example"><input name="pw"></form>', "form"],
  ])("removes %s", (_label, hostile, forbidden) => {
    expect(sanitizeRichText(hostile)).not.toContain(forbidden);
  });

  /**
   * A link that opens a new tab hands that tab `window.opener`. Editors do not
   * think about this and the CMS has no checkbox for it, so the platform adds it
   * every time rather than hoping.
   */
  it("forces rel on links that open a new tab", () => {
    const sanitized = sanitizeRichText('<a href="https://example.com" target="_blank">x</a>');

    expect(sanitized).toContain('rel="noopener noreferrer"');
    expect(sanitized).toContain('target="_blank"');
  });

  it("overwrites a rel the author chose rather than merging with it", () => {
    const sanitized = sanitizeRichText(
      '<a href="https://example.com" target="_blank" rel="opener">x</a>',
    );

    expect(sanitized).toContain('rel="noopener noreferrer"');
    expect(sanitized).not.toContain('rel="opener"');
  });

  it("leaves a same-tab link without a rel it does not need", () => {
    expect(sanitizeRichText('<a href="/kasko">x</a>')).toBe('<a href="/kasko">x</a>');
  });

  /** An unknown wrapper is not content — but the words inside it are. */
  it("unwraps a disallowed element and keeps its text", () => {
    expect(sanitizeRichText("<div><p>metin</p></div>")).toBe("<p>metin</p>");
  });

  it("treats an absent field as an empty document", () => {
    expect(sanitizeRichText(null)).toBe("");
    expect(sanitizeRichText(undefined)).toBe("");
    expect(sanitizeRichText("")).toBe("");
  });

  it("escapes text that looks like markup", () => {
    expect(sanitizeRichText("<p>5 &lt; 6 &amp; 7 &gt; 6</p>")).toBe(
      "<p>5 &lt; 6 &amp; 7 &gt; 6</p>",
    );
  });

  it("hands the sink a value only the sanitizer could have produced", () => {
    expect(richTextHtml(sanitizeRichText("<p>x</p>"))).toEqual({ __html: "<p>x</p>" });
  });
});
