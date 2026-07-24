/** @jsxRuntime automatic */ /** @jsxImportSource react */
import { renderToString } from "react-dom/server";

import type { Assets } from "./assets.js";
import { tryGetRuntime } from "./runtime.js";

export function renderErrorPage(assets: Assets): string {
  const doc = tryGetRuntime()?.document;
  const html = renderToString(
    <html lang={doc?.htmlLang ?? "tr"}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{doc?.errorPageTitle ?? "Sayfa gösterilemiyor"}</title>
        <meta name="robots" content="noindex, nofollow" />
        {assets.css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body>
        <main>
          <h1>Bir hata oluştu</h1>
          <p>Lütfen daha sonra tekrar deneyin.</p>
          <p>
            <a href="/">Ana sayfaya dön</a>
          </p>
        </main>
      </body>
    </html>,
  );

  return "<!DOCTYPE html>" + html;
}

export function errorResponse(assets: Assets): Response {
  return new Response(renderErrorPage(assets), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
