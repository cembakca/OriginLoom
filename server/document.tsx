import { assetCdnOrigin } from "@server/assets";
import { renderToString } from "react-dom/server";

import { GtmBootstrap, isBotRequest } from "~/components/analytics/gtm-bootstrap";
import { HeadClient } from "~/components/head/head-client";
import { MetadataHead } from "~/components/head/metadata-head";
import { RootLayout } from "~/components/layout/root-layout";
import { resolveDocumentMetadata } from "~/lib/metadata/resolve";
import { buildShellData, defaultPageMeta } from "~/lib/shell-data";
import { stripUndefined } from "~/lib/strip-undefined";
import type { Ctx, Route } from "~/lib/types";

import { config } from "./config";

export type Assets = { js: string; css: string[] };

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
  const isBot = isBotRequest(routeCtx.request);
  const shell = await buildShellData(
    routeCtx,
    stripUndefined({ minimalChrome: route.minimalChrome }),
  );
  const seo = resolveDocumentMetadata(route, data, routeCtx);
  const pageMeta =
    route.pageMeta?.(data, routeCtx) ??
    defaultPageMeta(routeCtx, route.path === "/" ? "home" : route.path.replace(/^\//, ""));

  const cdnOrigin = assetCdnOrigin();

  const html = renderToString(
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <MetadataHead meta={seo} />
        <HeadClient />
        {cdnOrigin ? <link rel="preconnect" href={cdnOrigin} crossOrigin="anonymous" /> : null}
        {assets.css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <link rel="modulepreload" href={assets.js} />
        <GtmBootstrap containerId={config.gtmContainerId} isBot={isBot} />
      </head>
      <body>
        <div id="root">
          <RootLayout shell={shell} pageMeta={pageMeta}>
            <route.Component data={data} />
          </RootLayout>
        </div>
        <script type="module" src={assets.js} />
      </body>
    </html>,
  );
  return "<!DOCTYPE html>" + html;
}
