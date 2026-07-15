import { renderToString } from "react-dom/server";
import type { Route } from "../src/lib/types";

export type Assets = { js: string; css: string[] };

export function renderDocument<T>(route: Route<T>, data: T, assets: Assets): string {
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
      </head>
      <body>
        <div id="root">
          <route.Component data={data} />
        </div>
        <script type="module" src={assets.js} />
      </body>
    </html>,
  );
  return "<!DOCTYPE html>" + html;
}
