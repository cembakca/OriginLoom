import { renderToString } from "react-dom/server";
import type { Route, Ctx } from "../src/lib/types";
import { GtmBootstrap, isBotRequest } from "../src/components/analytics/gtm-bootstrap";
import { RootLayout } from "../src/components/layout/root-layout";
import { buildLayoutClientProps, defaultPageMeta } from "../src/lib/shell-data";
import { config } from "./config";

export type Assets = { js: string; css: string[] };

export type DocumentContext = {
  routeCtx: Ctx;
};

export function renderDocument<T>(
  route: Route<T>,
  data: T,
  assets: Assets,
  docCtx: DocumentContext,
): string {
  const { routeCtx } = docCtx;
  const isBot = isBotRequest(routeCtx.request);
  const shell = buildLayoutClientProps(routeCtx, { minimalChrome: route.minimalChrome });
  const pageMeta =
    route.pageMeta?.(data, routeCtx) ??
    defaultPageMeta(routeCtx, route.path === "/" ? "home" : route.path.replace(/^\//, ""));

  const html = renderToString(
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{route.title?.(data) ?? "ssr-kit"}</title>
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
