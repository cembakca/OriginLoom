import type { Assets } from "@originloom/core/assets";
import { errorResponse, renderErrorPage } from "@originloom/core/error";
import { installRuntime, type OriginRuntime, tryGetRuntime } from "@originloom/core/runtime";
import { describe, expect, it } from "vitest";

const assets: Assets = {
  js: "/assets/entry.js",
  css: ["/assets/app.css"],
  fonts: [],
};

/** Swap only the document policy; the rest of the installed runtime is reused. */
function withDocument(patch: Partial<OriginRuntime["document"]>, run: () => void): void {
  const runtime = tryGetRuntime();
  if (!runtime) throw new Error("runtime not installed");
  const original = runtime.document;
  installRuntime({ ...runtime, document: { ...original, ...patch } });
  try {
    run();
  } finally {
    installRuntime({ ...runtime, document: original });
  }
}

describe("renderErrorPage", () => {
  it("renders the 500 page with the product language and title", () => {
    withDocument({ htmlLang: "tr", errorPageTitle: "Sayfa gösterilemiyor" }, () => {
      const html = renderErrorPage(assets);
      expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
      expect(html).toContain('<html lang="tr">');
      expect(html).toContain("<title>Sayfa gösterilemiyor</title>");
      expect(html).toContain("Bir hata oluştu");
      expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
      expect(html).toContain('<link rel="stylesheet" href="/assets/app.css"/>');
    });
  });

  it("escapes the product-supplied title and stylesheet URLs", () => {
    withDocument({ errorPageTitle: `</title><script>alert("x")</script>` }, () => {
      const html = renderErrorPage({
        ...assets,
        css: [`/a.css" onload="alert(1)`],
      });
      expect(html).not.toContain("<script>");
      expect(html).toContain(
        "<title>&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</title>",
      );
      expect(html).toContain('href="/a.css&quot; onload=&quot;alert(1)"');
    });
  });

  it("renders an escaped support reference without exposing exception details", () => {
    const html = renderErrorPage(assets, `server-123<script>alert("x")</script>`);
    expect(html).toContain("Referans: server-123&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("serves the page as a no-store 500 response", async () => {
    const response = errorResponse(assets, "server-123");
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const html = await response.text();
    expect(html).toContain("Bir hata oluştu");
    expect(html).toContain("Referans: server-123");
  });
});
