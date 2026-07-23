import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MetadataHead } from "~/components/head/metadata-head";
import { mergeMetadata } from "~/lib/metadata/merge";
import type { Ctx } from "@originloom/react/lib/types";

const context: Ctx = {
  request: new Request("https://www.example.com/bilgi-merkezi?page=2"),
  params: {},
  url: new URL("https://www.example.com/bilgi-merkezi?page=2"),
  publicPath: "/bilgi-merkezi",
  siteUrl: "https://www.example.com",
};

describe("metadata head", () => {
  it("renders canonical, pagination, verification and nonce-protected escaped JSON-LD", () => {
    const metadata = mergeMetadata(
      {
        title: "Bilgi Merkezi — Sayfa 2",
        canonical: "/bilgi-merkezi?page=2",
        pagination: {
          previous: "/bilgi-merkezi",
          next: "/bilgi-merkezi?page=3",
        },
        verification: { "google-site-verification": "search-console-token" },
        structuredData: [{ "@type": "Article", headline: "</script><script>alert(1)</script>" }],
      },
      context,
    );

    const html = renderToStaticMarkup(<MetadataHead meta={metadata} nonce="csp-test-nonce" />);

    expect(html).toContain(
      '<link rel="canonical" href="https://www.example.com/bilgi-merkezi?page=2"/>',
    );
    expect(html).toContain('<link rel="prev" href="https://www.example.com/bilgi-merkezi"/>');
    expect(html).toContain(
      '<link rel="next" href="https://www.example.com/bilgi-merkezi?page=3"/>',
    );
    expect(html).toContain('name="google-site-verification" content="search-console-token"');
    expect(html).toContain('type="application/ld+json" nonce="csp-test-nonce"');
    expect(html).toContain(
      "\\u003c\\/script\\u003e\\u003cscript\\u003ealert(1)\\u003c\\/script\\u003e",
    );
    expect(html).not.toContain("</script><script>alert(1)</script>");
  });
});
