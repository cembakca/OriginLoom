/** @jsxRuntime automatic */ /** @jsxImportSource react */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocumentLayout } from "../src/server/document-layout.js";
import type { DocumentRenderInput } from "@originloom/shared/render";

const baseInput: DocumentRenderInput = {
  htmlLang: "tr",
  publicPath: "/",
  publicSearch: "",
  siteUrl: "http://localhost:3010",
  assets: { js: "/assets/entry.client.js", css: ["/assets/entry.css"], fonts: [] },
  seo: {
    title: "Test",
    description: "Test page",
    canonical: "http://localhost:3010/",
    robots: { index: true, follow: true },
    openGraph: { title: "Test", description: "Test page", type: "website" },
    twitter: { card: "summary" },
  },
  pageMeta: { pageType: "home", publicPath: "/" },
  shell: {},
  content: <main>Merhaba</main>,
  isBot: false,
  preconnectOrigins: [],
  imagePreloads: [],
  modulePreloads: [],
};

describe("DocumentLayout", () => {
  it("inlines critical paint styles before external CSS", () => {
    const html = renderToStaticMarkup(
      <DocumentLayout
        input={baseInput}
        config={{
          NotFoundComponent: () => <p>404</p>,
          ErrorComponent: () => <p>Error</p>,
          renderHeadStart: () => null,
          renderHeadEnd: () => null,
          renderLayout: ({ children }) => <div>{children}</div>,
        }}
      />,
    );

    expect(html).toContain('meta name="color-scheme" content="light"');
    expect(html).toContain('meta name="theme-color" content="#f8fafc"');
    expect(html).toContain("background-color:#f8fafc");
    expect(html).toContain("@view-transition{navigation:auto}");
    expect(html.indexOf("<style>")).toBeLessThan(html.indexOf('rel="stylesheet"'));
  });

  it("allows product-specific critical paint overrides", () => {
    const html = renderToStaticMarkup(
      <DocumentLayout
        input={baseInput}
        config={{
          NotFoundComponent: () => <p>404</p>,
          ErrorComponent: () => <p>Error</p>,
          criticalPaint: {
            backgroundColor: "#ffffff",
            themeColor: "#ffffff",
          },
          renderHeadStart: () => null,
          renderHeadEnd: () => null,
          renderLayout: ({ children }) => <div>{children}</div>,
        }}
      />,
    );

    expect(html).toContain("background-color:#ffffff");
    expect(html).toContain('meta name="theme-color" content="#ffffff"');
  });
});
