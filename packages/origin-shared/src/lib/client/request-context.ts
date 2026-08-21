export const REQUEST_CONTEXT_ELEMENT_ID = "originloom-request";

const SAFE_PAGE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export type EmbeddedRequestContext = {
  publicPath: string;
  search: string;
  siteUrl: string;
  pageRequestId?: string;
};

const EMPTY: EmbeddedRequestContext = { publicPath: "", search: "", siteUrl: "" };

export function isSafePageRequestId(value: string): boolean {
  return SAFE_PAGE_REQUEST_ID.test(value);
}

/** Reads the JSON block the document emitted for client-side request identity. */
export function readEmbeddedRequestContext(doc: Document = document): EmbeddedRequestContext {
  const element = doc.getElementById(REQUEST_CONTEXT_ELEMENT_ID);
  if (!element?.textContent) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(element.textContent);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    const { publicPath, search, siteUrl, pageRequestId } =
      parsed as Partial<EmbeddedRequestContext>;
    return {
      publicPath: typeof publicPath === "string" ? publicPath : "",
      search: typeof search === "string" ? search : "",
      siteUrl: typeof siteUrl === "string" ? siteUrl : "",
      ...(typeof pageRequestId === "string" && isSafePageRequestId(pageRequestId)
        ? { pageRequestId }
        : {}),
    };
  } catch {
    return EMPTY;
  }
}
