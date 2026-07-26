import type { FontAsset } from "@originloom/shared/assets";
import type { DocumentRenderInput } from "@originloom/shared/render";

import { type HtmlNode, joinHtml, raw } from "../html.js";
import { tag } from "../tag.js";
import type { HtmlRendererConfig } from "./types.js";

/**
 * The document shell, in strings. Mirrors what the React adapter's
 * `DocumentLayout` emits, so both renderers produce the same head contract:
 * fonts, preloads, stylesheets, module preloads and the client entry script.
 *
 * Elements are built from attribute records rather than templates: whitespace
 * between elements is part of the response — rendered text, in the body — so
 * how the markup is spaced is the app's decision, not this file's.
 */
export function documentLayout<Shell>(
  input: DocumentRenderInput<Shell>,
  config: HtmlRendererConfig<Shell>,
): HtmlNode {
  return joinHtml([
    raw(`<!DOCTYPE html>`),
    tag("html", { lang: input.htmlLang }, joinHtml([head(input, config), body(input, config)])),
  ]);
}

function head<Shell>(
  input: DocumentRenderInput<Shell>,
  config: HtmlRendererConfig<Shell>,
): HtmlNode {
  const { seo, assets, isBot, cspNonce } = input;

  return tag(
    "head",
    {},
    joinHtml([
      tag("meta", { charset: "utf-8" }),
      tag("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      config.renderHeadStart?.({ seo, cspNonce }) ?? null,
      assets.fonts
        .filter((font) => font.preload)
        .map((font) =>
          tag("link", {
            rel: "preload",
            as: "font",
            type: "font/woff2",
            href: font.href,
            crossorigin: "anonymous",
          }),
        ),
      input.imagePreloads.map((preload) =>
        tag("link", {
          rel: "preload",
          as: "image",
          href: preload.href,
          type: preload.type,
          imagesrcset: preload.imageSrcSet,
          imagesizes: preload.imageSizes,
          fetchpriority: "high",
        }),
      ),
      assets.fonts.length > 0 ? tag("style", {}, raw(fontFaceCss(assets.fonts))) : null,
      input.preconnectOrigins.map((origin) =>
        tag("link", { rel: "preconnect", href: origin, crossorigin: "anonymous" }),
      ),
      assets.css.map((href) => tag("link", { rel: "stylesheet", href })),
      assets.development
        ? tag("script", { type: "module", src: assets.development.client }, null)
        : null,
      input.modulePreloads.map((href) => tag("link", { rel: "modulepreload", href })),
      config.renderHeadEnd?.({ cspNonce, isBot }) ?? null,
    ]),
  );
}

function body<Shell>(
  input: DocumentRenderInput<Shell>,
  config: HtmlRendererConfig<Shell>,
): HtmlNode {
  const { assets, shell, pageMeta, content, cspNonce } = input;

  return tag(
    "body",
    {},
    joinHtml([
      tag(
        "div",
        { id: "root" },
        config.renderLayout({ shell, pageMeta, children: content as HtmlNode }),
      ),
      tag(
        "script",
        {
          type: "module",
          src: assets.js,
          nonce: cspNonce,
          // The dev-server entry is cross-origin; the built one is same-origin.
          crossorigin: assets.development ? "anonymous" : undefined,
        },
        null,
      ),
    ]),
  );
}

function fontFaceCss(fonts: FontAsset[]): string {
  return fonts
    .map(
      (font) =>
        `@font-face{font-family:${cssString(font.family)};src:url(${cssString(
          font.href,
        )}) format("woff2");font-style:${font.style};font-weight:${font.weight};font-display:${
          font.display
        };unicode-range:${font.unicodeRange}}`,
    )
    .join("");
}

function cssString(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\3c ");
}
