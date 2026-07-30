/**
 * The product middleware contract — what an app is allowed to do to a document
 * request on its way in, and to the response on its way out.
 *
 * ```ts
 * import { defineMiddleware } from "@originloom/core/middleware";
 *
 * export const localeMiddleware = defineMiddleware({
 *   name: "locale",
 *   handler: (ctx) => {
 *     const locale = ctx.cookie("locale") ?? "tr";
 *     return { requestHeaders: { "x-locale": locale }, values: { locale } };
 *   },
 * });
 * ```
 *
 * Pass the list to `createApp({ middleware: [...] })`. Everything below the
 * pipeline — auth, session, CMS redirects — stays the platform's, and runs in a
 * fixed order relative to the phase a middleware declares.
 */
export type { CookieOptions } from "./cookie-jar.js";
export {
  defineMiddleware,
  type MiddlewareContext,
  type MiddlewareCookie,
  type MiddlewarePhase,
  type MiddlewareRedirect,
  type MiddlewareResult,
  type OriginMiddleware,
} from "./product.js";
