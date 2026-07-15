/** Central cookie names — re-export from shared lib. */
export { Cookie } from "~/lib/cookies";

import type { CookieJar } from "./cookie-jar";

export type PipelineContext = {
  url: URL;
  pathname: string;
  publicPath: string;
  requestId?: string;
};

export type CookieOptions = {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
};

export type PipelineResult = {
  /** Terminal response — redirect, 410, etc. Pipeline stops. */
  response?: Response;
  request: Request;
  cookies: CookieJar;
  responseHeaders: Headers;
  trackingId?: string;
};

export type MiddlewareStep = (
  ctx: PipelineContext,
  acc: PipelineResult,
) => Promise<Partial<PipelineResult> | void>;

export type UserProfile = {
  initials: string;
  displayName: string;
};
