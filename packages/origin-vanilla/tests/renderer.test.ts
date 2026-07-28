import type { Assets } from "@originloom/shared/assets";
import type { ResolvedMetadata } from "@originloom/shared/lib/metadata/types";
import type { DocumentRenderInput } from "@originloom/shared/render";
import { describe, expect, it } from "vitest";

import { html } from "../src/html.js";
import { metadataHead } from "../src/lib/metadata-head.js";
import { createHtmlRenderer } from "../src/server/index.js";

const metadata: ResolvedMetadata = {
  applicationName: "Vanilla",
  siteName: "Vanilla",
  title: "Ana sayfa",
  description: "Açıklama",
  canonical: "https://example.com/",
  robots: "index, follow",
  openGraph: {
    title: "Ana sayfa",
    description: "Açıklama",
    url: "https://example.com/",
    siteName: "Vanilla",
    type: "website",
  },
  twitter: { card: "summary", title: "Ana sayfa", description: "Açıklama" },
  icons: { icon: "/favicon.ico" },
  verification: { "google-site-verification": "abc" },
  pagination: {},
  formatDetection: { telephone: false },
  structuredData: [{ "@type": "WebSite", name: "Vanilla" }],
};

const assets: Assets = {
  js: "/assets/entry.js",
  css: ["/assets/app.css"],
  fonts: [
    {
      family: "Inter",
      style: "normal",
      weight: "400",
      display: "swap",
      unicodeRange: "U+0000-00FF",
      preload: true,
      href: "/assets/inter.woff2",
    },
  ],
};

const renderer = createHtmlRenderer<{ brand: string }>({
  notFoundPage: () => html`<h1>404</h1>`,
  errorPage: ({ status }) => html`<h1>${status}</h1>`,
  renderHeadStart: ({ seo, cspNonce }) => metadataHead(seo, cspNonce),
  renderLayout: ({ shell, children }) =>
    html`<header>${shell.brand}</header>
      <main>${children}</main>`,
});

const input: DocumentRenderInput<{ brand: string }> = {
  htmlLang: "tr",
  assets,
  seo: metadata,
  pageMeta: { pageType: "home", publicPath: "/" },
  shell: { brand: "Vanilla" },
  content: html`<h1>Merhaba</h1>`,
  isBot: false,
  preconnectOrigins: ["https://cdn.example.com"],
  imagePreloads: [],
  modulePreloads: ["/assets/chunk.js"],
  cspNonce: "n0nce",
};

describe("createHtmlRenderer", () => {
  const document = renderer.renderDocument(input);

  it("emits a complete document", () => {
    expect(document.startsWith('<!DOCTYPE html><html lang="tr">')).toBe(true);
    expect(document).toContain('<meta charset="utf-8" />');
    expect(document).toContain("<h1>Merhaba</h1>");
    expect(document).toContain("<header>Vanilla</header>");
    expect(document).toContain('<script type="module" src="/assets/entry.js"');
    expect(document).toContain('nonce="n0nce"');
  });

  it("emits the same head contract as the React adapter", () => {
    expect(document).toContain("<title>Ana sayfa</title>");
    expect(document).toContain('<link rel="canonical" href="https://example.com/" />');
    expect(document).toContain('<link rel="stylesheet" href="/assets/app.css" />');
    expect(document).toContain('<link rel="modulepreload" href="/assets/chunk.js" />');
    expect(document).toContain('<link rel="preconnect" href="https://cdn.example.com"');
    expect(document).toContain('rel="preload"');
    expect(document).toContain('@font-face{font-family:"Inter"');
    expect(document).toContain('<meta name="google-site-verification" content="abc" />');
    expect(document).toContain('<script type="application/ld+json"');
  });

  it("ships the dev client and its bfcache preamble only in development", () => {
    expect(document).not.toContain("@vite/client");
    expect(document).not.toContain('addEventListener("pagehide"');

    const dev = renderer.renderDocument({
      ...input,
      assets: { ...assets, development: { client: "http://127.0.0.1:5010/@vite/client" } },
    });
    expect(dev.indexOf('addEventListener("pagehide"')).toBeLessThan(dev.indexOf("@vite/client"));
    expect(dev).toContain('<script nonce="n0nce">');
  });

  it("omits metadata tags that have no value", () => {
    expect(document).not.toContain('rel="prev"');
    expect(document).not.toContain("twitter:image");
    expect(document).not.toContain("apple-touch-icon");
  });

  it("renders fragments without document chrome", () => {
    expect(renderer.renderNode(html`<span>parça</span>`)).toBe("<span>parça</span>");
  });

  it("renders boundary content, preferring the route's own components", () => {
    const ctx = {
      request: new Request("http://localhost/"),
      params: {},
      url: new URL("http://localhost/"),
      publicPath: "/",
    };
    expect(renderer.renderNode(renderer.notFoundContent(ctx))).toBe("<h1>404</h1>");
    expect(
      renderer.renderNode(
        renderer.errorContent(
          ctx,
          { path: "/", loader: async () => ({ data: {} }), Component: () => html`` },
          null,
          503,
        ),
      ),
    ).toBe("<h1>503</h1>");
  });

  it("streams the document as a single ready chunk", async () => {
    const result = await renderer.renderDocumentToStream(input, { onError: () => undefined });
    await result.allReady;
    const chunks: string[] = [];
    const reader = result.stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }
    expect(chunks.join("")).toBe(document);
  });
});
