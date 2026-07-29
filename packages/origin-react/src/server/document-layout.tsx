/** @jsxRuntime automatic */ /** @jsxImportSource react */
import type { FontAsset } from "@originloom/shared/assets";
import { devClientPreamble } from "@originloom/shared/dev-client";
import type { DocumentRenderInput } from "@originloom/shared/render";
import type { ReactElement, ReactNode } from "react";

import type { ReactRendererConfig } from "./types.js";

const fontCssCache = new WeakMap<readonly FontAsset[], string>();

export type DocumentLayoutProps<Shell> = {
  input: DocumentRenderInput<Shell>;
  config: ReactRendererConfig<Shell>;
};

export function DocumentLayout<Shell>({ input, config }: DocumentLayoutProps<Shell>): ReactElement {
  const {
    htmlLang,
    seo,
    assets,
    preconnectOrigins,
    imagePreloads,
    modulePreloads,
    isBot,
    shell,
    pageMeta,
    content,
    cspNonce,
  } = input;

  return (
    <html lang={htmlLang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {config.renderHeadStart({ seo, cspNonce })}
        {assets.fonts.map((font) =>
          font.preload ? (
            <link
              key={`preload-${font.href}`}
              rel="preload"
              as="font"
              type="font/woff2"
              href={font.href}
              crossOrigin="anonymous"
            />
          ) : null,
        )}
        {imagePreloads.map((preload) => (
          <link
            key={`${preload.type}-${preload.href}`}
            rel="preload"
            as="image"
            href={preload.href}
            type={preload.type}
            imageSrcSet={preload.imageSrcSet}
            imageSizes={preload.imageSizes}
            fetchPriority="high"
          />
        ))}
        {assets.fonts.length > 0 ? <style>{fontFaceCss(assets.fonts)}</style> : null}
        {preconnectOrigins.map((origin) => (
          <link key={origin} rel="preconnect" href={origin} crossOrigin="anonymous" />
        ))}
        {assets.css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        {assets.development ? (
          <>
            <script nonce={cspNonce} dangerouslySetInnerHTML={{ __html: devClientPreamble() }} />
            <script type="module" src={assets.development.client} />
            <script
              type="module"
              nonce={cspNonce}
              dangerouslySetInnerHTML={{
                __html: reactRefreshPreamble(
                  config.refreshRuntimeUrl?.(assets.development) ??
                    defaultRefreshRuntimeUrl(assets.development.client),
                ),
              }}
            />
          </>
        ) : null}
        {modulePreloads.map((href) => (
          <link key={href} rel="modulepreload" href={href} />
        ))}
        {config.renderHeadEnd({ cspNonce, isBot })}
      </head>
      <body>
        <div id="root">
          {/* `content` crossed the seam as an opaque node; here it is React again. */}
          {config.renderLayout({ shell, pageMeta, children: content as ReactNode })}
        </div>
        <script
          type="module"
          src={assets.js}
          nonce={cspNonce}
          crossOrigin={assets.development ? "anonymous" : undefined}
        />
      </body>
    </html>
  );
}

/** The dev server that serves `@vite/client` also serves the refresh runtime. */
function defaultRefreshRuntimeUrl(devClientUrl: string): string {
  return `${new URL(devClientUrl).origin}/@react-refresh`;
}

function reactRefreshPreamble(refreshRuntimeUrl: string): string {
  const url = JSON.stringify(refreshRuntimeUrl).replaceAll("<", "\\u003c");
  return `import RefreshRuntime from ${url};
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;`;
}

function fontFaceCss(fonts: FontAsset[]): string {
  const cached = fontCssCache.get(fonts);
  if (cached !== undefined) return cached;
  const css = fonts
    .map(
      (font) =>
        `@font-face{font-family:${cssString(font.family)};src:url(${cssString(
          font.href,
        )}) format("woff2");font-style:${font.style};font-weight:${font.weight};font-display:${
          font.display
        };unicode-range:${font.unicodeRange}}`,
    )
    .join("");
  fontCssCache.set(fonts, css);
  return css;
}

function cssString(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\3c ");
}
