import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseEmbeddedJson, serializeEmbeddedJson } from "@originloom/react/lib/embedded-json";
import { Island } from "@originloom/react/lib/island";

describe("embedded JSON", () => {
  it("escapes crawler-visible solidus values and round-trips without manual replacement", () => {
    const value = {
      publicPath: "/bilgi-merkezi?page=2",
      absoluteUrl: "https://www.example.com/account",
      nested: ["/one", { path: "/two" }],
    };

    const serialized = serializeEmbeddedJson(value);

    expect(serialized).toContain('"publicPath":"\\/bilgi-merkezi?page=2"');
    expect(serialized).toContain('"absoluteUrl":"https:\\/\\/www.example.com\\/account"');
    expect(serialized).not.toMatch(/(^|[^\\])\//);
    expect(parseEmbeddedJson(serialized)).toEqual(value);
  });

  it("neutralizes HTML/script boundary characters while preserving JSON semantics", () => {
    const value = { content: "</script><a>&\u2028\u2029" };
    const serialized = serializeEmbeddedJson(value);

    expect(serialized).toBe(
      '{"content":"\\u003c\\/script\\u003e\\u003ca\\u003e\\u0026\\u2028\\u2029"}',
    );
    expect(parseEmbeddedJson(serialized)).toEqual(value);
  });

  it("uses the serializer for every Island data-props payload", () => {
    const html = renderToStaticMarkup(
      <Island name="layout-client" mode="defer" props={{ publicPath: "/medya-pipeline" }} />,
    );

    expect(html).toContain('data-island="layout-client"');
    expect(html).toContain("\\/medya-pipeline");
    expect(html).not.toContain("&quot;/medya-pipeline&quot;");
  });

  it("rejects top-level values that JSON cannot serialize", () => {
    expect(() => serializeEmbeddedJson(undefined)).toThrow("must be JSON-serializable");
  });
});
