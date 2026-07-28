import { cloneRequestWithHeaders } from "../../sequential.js";
import type { MiddlewareStep } from "../../types.js";
import { runAuthCore } from "./core.js";

export const authStep: MiddlewareStep = async (ctx, acc) => {
  const outcome = await runAuthCore(acc.request, acc.cookies);

  const headers = new Headers(acc.request.headers);
  if (outcome.authorization) headers.set("Authorization", outcome.authorization);

  return {
    request: cloneRequestWithHeaders(acc.request, headers),
    cookies: outcome.cookies,
  };
};
