import { cloneRequestWithHeaders } from "../../sequential";
import type { MiddlewareStep } from "../../types";
import { runAuthCore } from "./core";

export const authStep: MiddlewareStep = async (ctx, acc) => {
  const outcome = await runAuthCore(acc.request, acc.cookies);

  const headers = new Headers(acc.request.headers);
  if (outcome.authorization) headers.set("Authorization", outcome.authorization);

  return {
    request: cloneRequestWithHeaders(acc.request, headers),
    cookies: outcome.cookies,
  };
};
