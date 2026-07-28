/** Static 410 page — plain strings, no UI framework involved. */
export function renderGonePage(): string {
  return (
    "<!DOCTYPE html>" +
    '<html lang="tr">' +
    '<head><meta charset="utf-8"/><title>Sayfa kaldırıldı</title></head>' +
    '<body><main style="max-width:480px;margin:4rem auto;font-family:system-ui">' +
    "<h1>410 — Sayfa kaldırıldı</h1>" +
    "<p>Bu içerik artık mevcut değil.</p>" +
    '<a href="/">Ana sayfaya dön</a>' +
    "</main></body></html>"
  );
}
