import { renderToString } from "react-dom/server";

export function renderGonePage(): string {
  const html = renderToString(
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <title>Sayfa kaldırıldı</title>
      </head>
      <body>
        <main style={{ maxWidth: 480, margin: "4rem auto", fontFamily: "system-ui" }}>
          <h1>410 — Sayfa kaldırıldı</h1>
          <p>Bu içerik artık mevcut değil.</p>
          <a href="/">Ana sayfaya dön</a>
        </main>
      </body>
    </html>,
  );
  return "<!DOCTYPE html>" + html;
}
