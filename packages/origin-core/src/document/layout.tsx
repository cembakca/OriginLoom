/** @jsxRuntime automatic */ /** @jsxImportSource react */
import type { FontAsset } from "../media";
import { getRuntime } from "../runtime";
import type { DocumentLayoutProps } from "./types";

export function DocumentLayout({
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
}: DocumentLayoutProps) {
  const doc = getRuntime().document;
  return (
    <html lang={doc.htmlLang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {doc.renderHeadStart({ seo, cspNonce })}
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
            <script type="module" src={assets.development.client} />
            <script
              type="module"
              nonce={cspNonce}
              dangerouslySetInnerHTML={{
                __html: reactRefreshPreamble(assets.development.reactRefresh),
              }}
            />
          </>
        ) : null}
        {modulePreloads.map((href) => (
          <link key={href} rel="modulepreload" href={href} />
        ))}
        {doc.renderHeadEnd({ cspNonce, isBot })}
      </head>
      <body>
        <div id="root">{doc.renderLayout({ shell, pageMeta, children: content })}</div>
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

function reactRefreshPreamble(refreshRuntimeUrl: string): string {
  const url = JSON.stringify(refreshRuntimeUrl).replaceAll("<", "\\u003c");
  return `import RefreshRuntime from ${url};
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;`;
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
