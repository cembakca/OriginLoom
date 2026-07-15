import { renderToString } from "react-dom/server";
import type { Assets } from "./document";

export function renderErrorPage(assets: Assets): string {
  const html = renderToString(
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Hata — ssr-kit</title>
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
