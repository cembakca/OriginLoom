import type { Assets } from "@originloom/shared/assets";

/**
 * What a browser can usefully start fetching before the HTML exists.
 *
 * The gain lives in one slice: a cache MISS, where the server is waiting on a
 * gateway and the connection is otherwise idle. On a HIT the document is already
 * in hand and a 103 buys nothing — it costs a write and a round of parsing for a
 * hint the real response answers a millisecond later. That is why this is not a
 * blanket middleware.
 *
 * Only render-blocking resources are hinted. A module preload graph is large and
 * speculative; the stylesheet and the entry script are neither, and they are what
 * the first paint waits for.
 */
export function earlyHintLinks(assets: Assets): string[] {
  const links: string[] = [];
  for (const href of assets.css) {
    links.push(`<${href}>; rel=preload; as=style`);
  }
  if (assets.js) {
    // `modulepreload` rather than `preload; as=script`: the entry is an ES
    // module, and the two are different cache entries in some browsers — hinting
    // the wrong one fetches the file twice.
    links.push(`<${assets.js}>; rel=modulepreload`);
  }
  for (const font of assets.fonts) {
    if (!font.preload) continue;
    // Fonts are cross-origin-fetched even from the same origin, so the hint has
    // to say so or the browser discards the preload and fetches again.
    links.push(`<${font.href}>; rel=preload; as=font; type=font/woff2; crossorigin`);
  }
  return links;
}

/**
 * Whether this request is worth hinting.
 *
 * A hint is only useful to something that will parse HTML and act on it, and
 * only affordable when the wait is real. Everything else — a bot with no
 * renderer, an API call, a request that will be answered from cache — gets
 * nothing.
 */
export function shouldSendEarlyHints(options: {
  enabled: boolean;
  method: string;
  isDocumentRequest: boolean;
  willRenderFresh: boolean;
}): boolean {
  if (!options.enabled) return false;
  if (options.method !== "GET") return false;
  return options.isDocumentRequest && options.willRenderFresh;
}

/**
 * The Node response a 103 has to be written to, described structurally.
 *
 * Typed by shape rather than imported from the adapter: a 103 is a Node HTTP
 * concept, the core is not a Node server, and taking a dependency on one adapter
 * to send an informational response would put the whole platform behind it.
 */
type EarlyHintsWritable = {
  writeEarlyHints?: (hints: { link: string[] }) => void;
  headersSent?: boolean;
  writableEnded?: boolean;
};

/**
 * Writes the 103, or does nothing at all.
 *
 * Every failure here is silent on purpose. An informational response is an
 * optimisation the real response does not depend on: a runtime without
 * `writeEarlyHints`, a client that hung up, an adapter that does not expose the
 * socket — none of those are reasons to fail a request that is about to succeed.
 */
export function sendEarlyHints(outgoing: unknown, links: string[]): boolean {
  if (links.length === 0) return false;
  const target = outgoing as EarlyHintsWritable | null | undefined;
  if (!target || typeof target.writeEarlyHints !== "function") return false;
  if (target.headersSent === true || target.writableEnded === true) return false;
  try {
    target.writeEarlyHints({ link: links });
    return true;
  } catch {
    return false;
  }
}
