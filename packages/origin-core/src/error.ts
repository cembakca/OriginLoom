import { escapeAttr, escapeHtml } from "@originloom/shared/html";

import type { Assets } from "./assets.js";
import { tryGetRuntime } from "./runtime.js";

/**
 * Last-resort 500 page. Built from strings on purpose: it has to render when no
 * runtime is installed, and the core must not depend on a UI framework.
 */
export function renderErrorPage(assets: Assets): string {
  const doc = tryGetRuntime()?.document;
  const stylesheets = assets.css
    .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}"/>`)
    .join("");

  return (
    "<!DOCTYPE html>" +
    `<html lang="${escapeAttr(doc?.htmlLang ?? "tr")}">` +
    "<head>" +
    '<meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
    `<title>${escapeHtml(doc?.errorPageTitle ?? "Sayfa gösterilemiyor")}</title>` +
    '<meta name="robots" content="noindex, nofollow"/>' +
    stylesheets +
    "</head>" +
    "<body><main>" +
    "<h1>Bir hata oluştu</h1>" +
    "<p>Lütfen daha sonra tekrar deneyin.</p>" +
    '<p><a href="/">Ana sayfaya dön</a></p>' +
    "</main></body></html>"
  );
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
