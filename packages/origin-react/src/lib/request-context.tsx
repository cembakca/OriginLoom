/** @jsxRuntime automatic */ /** @jsxImportSource react */
import {
  type EmbeddedRequestContext,
  readEmbeddedRequestContext,
  REQUEST_CONTEXT_ELEMENT_ID,
} from "@originloom/shared/lib/client/request-context";
import { createContext, type ReactNode, useContext } from "react";

export type RequestContextValue = EmbeddedRequestContext;

const EMPTY: RequestContextValue = { publicPath: "", search: "", siteUrl: "" };

const RequestContext = createContext<RequestContextValue>(EMPTY);

export { REQUEST_CONTEXT_ELEMENT_ID };

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

export function readRequestContext(doc: Document = document): RequestContextValue {
  return readEmbeddedRequestContext(doc);
}
