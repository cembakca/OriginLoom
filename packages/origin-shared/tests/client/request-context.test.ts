import { describe, expect, it } from "vitest";

import {
  isSafePageRequestId,
  readEmbeddedRequestContext,
  REQUEST_CONTEXT_ELEMENT_ID,
} from "../../src/lib/client/request-context.js";

describe("embedded request context", () => {
  it("reads pageRequestId from the document JSON block", () => {
    const doc = {
      getElementById: (id: string) =>
        id === REQUEST_CONTEXT_ELEMENT_ID
          ? {
              textContent: JSON.stringify({
                publicPath: "/catalog",
                search: "?page=2",
                siteUrl: "http://127.0.0.1:3010",
                pageRequestId: "1ee4a9e7-4502-436c-8518-40cdbe1b1171",
              }),
            }
          : null,
    } as unknown as Document;

    expect(readEmbeddedRequestContext(doc)).toEqual({
      publicPath: "/catalog",
      search: "?page=2",
      siteUrl: "http://127.0.0.1:3010",
      pageRequestId: "1ee4a9e7-4502-436c-8518-40cdbe1b1171",
    });
  });

  it("drops unsafe pageRequestId values", () => {
    const doc = {
      getElementById: () => ({
        textContent: JSON.stringify({
          publicPath: "/",
          search: "",
          siteUrl: "http://127.0.0.1:3010",
          pageRequestId: "bad id",
        }),
      }),
    } as unknown as Document;

    expect(readEmbeddedRequestContext(doc).pageRequestId).toBeUndefined();
    expect(isSafePageRequestId("bad id")).toBe(false);
  });
});
