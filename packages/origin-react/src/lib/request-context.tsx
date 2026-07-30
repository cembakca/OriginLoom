/** @jsxRuntime automatic */ /** @jsxImportSource react */
import { createContext, type ReactNode, useContext } from "react";

/**
 * The few facts about the current request that view code legitimately needs and
 * cannot be handed as props: which path the browser asked for, and what this
 * site's public origin is.
 *
 * The platform provides it — around the document on the server, and around every
 * island on the client — so an app never wires a provider, and an island is not
 * a place where these values quietly become wrong.
 */
export type RequestContextValue = {
  /** Browser-visible path, before any rewrite. */
  publicPath: string;
  /** The query string the browser asked with, leading "?" included. */
  search: string;
  /** Public origin of this site, as configured. */
  siteUrl: string;
};

const EMPTY: RequestContextValue = { publicPath: "", search: "", siteUrl: "" };

const RequestContext = createContext<RequestContextValue>(EMPTY);

export function RequestContextProvider({
  value,
  children,
}: {
  value: RequestContextValue;
  children: ReactNode;
}) {
  return <RequestContext.Provider value={value}>{children}</RequestContext.Provider>;
}

export function useRequestContext(): RequestContextValue {
  return useContext(RequestContext);
}

/** The id of the JSON block the document emits for the client half of this. */
export const REQUEST_CONTEXT_ELEMENT_ID = "originloom-request";

/**
 * Reads the block the document emitted. It is `application/json`, so it is data
 * the browser never executes — nothing here needs a CSP nonce.
 */
export function readRequestContext(doc: Document = document): RequestContextValue {
  const element = doc.getElementById(REQUEST_CONTEXT_ELEMENT_ID);
  if (!element?.textContent) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(element.textContent);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    const { publicPath, search, siteUrl } = parsed as Partial<RequestContextValue>;
    return {
      publicPath: typeof publicPath === "string" ? publicPath : "",
      search: typeof search === "string" ? search : "",
      siteUrl: typeof siteUrl === "string" ? siteUrl : "",
    };
  } catch {
    return EMPTY;
  }
}
