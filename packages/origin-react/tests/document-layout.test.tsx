/** @jsxRuntime automatic */ /** @jsxImportSource react */
import type { DocumentRenderInput } from "@originloom/shared/render";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocumentLayout } from "../src/server/document-layout.js";

const baseInput: DocumentRenderInput = {
  htmlLang: "tr",
  publicPath: "/",
  publicSearch: "",
  siteUrl: "http://localhost:3010",
  assets: { js: "/assets/entry.client.js", css: ["/assets/entry.css"], fonts: [] },
  seo: {
    applicationName: "Test",
    siteName: "Test",
    title: "Test",
    description: "Test page",
    canonical: "http://localhost:3010/",
    robots: "index, follow",
    openGraph: {
      title: "Test",
      description: "Test page",
      type: "website",
      url: "http://localhost:3010/",
    },
    twitter: { card: "summary", title: "Test", description: "Test page" },
    icons: { icon: "/favicon.ico" },
    verification: {},
    pagination: {},
    languageAlternates: {},
    formatDetection: { telephone: false },
    structuredData: [],
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
    // The chrome is the part that did not change, so it is named rather than
    // cross-faded with the content.
    expect(html).toContain("[data-view-transition='header']{view-transition-name:ol-header}");
    expect(html).toContain("[data-view-transition='main']{view-transition-name:ol-main}");
    // A transition with no animation is an instant swap, which is what the
    // preference asks for — the root cross-fade shipped without this guard.
    expect(html).toContain("@media(prefers-reduced-motion:reduce)");
    expect(html).toContain("::view-transition-group(*)");
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

  it("embeds pageRequestId in the request context JSON block", () => {
    const html = renderToStaticMarkup(
      <DocumentLayout
        input={{ ...baseInput, pageRequestId: "1ee4a9e7-4502-436c-8518-40cdbe1b1171" }}
        config={{
          NotFoundComponent: () => <p>404</p>,
          ErrorComponent: () => <p>Error</p>,
          renderHeadStart: () => null,
          renderHeadEnd: () => null,
          renderLayout: ({ children }) => <div>{children}</div>,
        }}
      />,
    );

    expect(html).toContain('"pageRequestId":"1ee4a9e7-4502-436c-8518-40cdbe1b1171"');
  });
});
