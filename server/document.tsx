import { assetCdnOrigin } from "@server/assets";
import { buildShellData } from "@server/services/shell-data";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

import { GtmBootstrap, isBotRequest } from "~/components/analytics/gtm-bootstrap";
import { HeadClient } from "~/components/head/head-client";
import { MetadataHead } from "~/components/head/metadata-head";
import { RootLayout } from "~/components/layout/root-layout";
import type { PageAnalyticsMeta } from "~/lib/analytics/types";
import type { ImagePreload } from "~/lib/media";
import { resolveDocumentMetadata } from "~/lib/metadata/resolve";
import type { ResolvedMetadata } from "~/lib/metadata/types";
import { defaultPageMeta } from "~/lib/shell-data";
import { stripUndefined } from "~/lib/strip-undefined";
import type { Ctx, Route } from "~/lib/types";

import { config } from "./config";
import { type FontAsset, imageCdnOrigins } from "./media";

export type Assets = {
  js: string;
  css: string[];
  fonts: FontAsset[];
  development?: { client: string; reactRefresh: string };
};

export type DocumentContext = {
  routeCtx: Ctx;
};

export async function renderDocument<T>(
  route: Route<T>,
  data: T,
  assets: Assets,
  docCtx: DocumentContext,
): Promise<string> {
  const { routeCtx } = docCtx;
  const seo = resolveDocumentMetadata(route, data, routeCtx);
  const imagePreloads = route.preloadImages?.(data, routeCtx) ?? [];
  const pageMeta =
    route.pageMeta?.(data, routeCtx) ??
    defaultPageMeta(routeCtx, route.path === "/" ? "home" : route.path.replace(/^\//, ""));

  return renderDocumentView({
    assets,
    routeCtx,
    content: <route.Component data={data} />,
    metadata: seo,
    pageMeta,
    imagePreloads,
    ...stripUndefined({ minimalChrome: route.minimalChrome }),
  });
}

export async function renderDocumentView({
  assets,
  routeCtx,
  content,
  metadata,
  pageMeta,
  imagePreloads = [],
  minimalChrome,
}: {
  assets: Assets;
  routeCtx: Ctx;
  content: ReactElement;
  metadata: ResolvedMetadata;
  pageMeta: PageAnalyticsMeta;
  imagePreloads?: ImagePreload[];
  minimalChrome?: boolean;
}): Promise<string> {
  const isBot = isBotRequest(routeCtx.request);
  const shell = await buildShellData(routeCtx, stripUndefined({ minimalChrome }));
  const seo = metadata;

  const cdnOrigin = assetCdnOrigin();
  const viteOrigin = assets.development ? new URL(assets.development.client).origin : null;
  const preconnectOrigins = [
    ...new Set([cdnOrigin, viteOrigin, ...imageCdnOrigins()].filter(Boolean)),
  ] as string[];

  const html = renderToString(
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <MetadataHead meta={seo} />
        <HeadClient />
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
              dangerouslySetInnerHTML={{
                __html: reactRefreshPreamble(assets.development.reactRefresh),
              }}
            />
          </>
        ) : (
          <link rel="modulepreload" href={assets.js} />
        )}
        <GtmBootstrap containerId={config.gtmContainerId} isBot={isBot} />
      </head>
      <body>
        <div id="root">
          <RootLayout shell={shell} pageMeta={pageMeta}>
            {content}
          </RootLayout>
        </div>
        <script
          type="module"
          src={assets.js}
          crossOrigin={assets.development ? "anonymous" : undefined}
        />
      </body>
    </html>,
  );
  return "<!DOCTYPE html>" + html;
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
