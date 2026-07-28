import { describe, expect, it } from "vitest";

import { escapeAttr, escapeHtml } from "../src/html.js";

describe("escapeHtml", () => {
  it("escapes every character that can break out of markup", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes the ampersand before the entities it introduces", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("closes an injected script tag", () => {
    expect(escapeHtml("</script><script>alert(1)</script>")).toBe(
      "&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("leaves safe text untouched", () => {
    expect(escapeHtml("Sayfa gösterilemiyor")).toBe("Sayfa gösterilemiyor");
  });
});

describe("escapeAttr", () => {
  it("escapes the quotes that would end an attribute value", () => {
    expect(escapeAttr(`" onload="alert(1)`)).toBe("&quot; onload=&quot;alert(1)");
    expect(escapeAttr("' onload='alert(1)")).toBe("&#39; onload=&#39;alert(1)");
  });
});
