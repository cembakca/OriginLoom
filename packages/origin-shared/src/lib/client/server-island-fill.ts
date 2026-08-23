/**
 * Fills the holes a `ServerIsland` left in the cached document.
 *
 * Each placeholder carries a signed payload; this asks the server to render it
 * and puts the returned markup in place. That is the whole runtime — no
 * component code, no framework, no hydration. The personal part of the page is
 * HTML the server produced, and the browser only moves it into position.
 *
 * If a fill fails, or scripts never run, the placeholder keeps the fallback the
 * server already rendered. Degrading to the fallback is the designed outcome,
 * not an error path.
 */
const ENDPOINT = "/api/_island";
const ATTRIBUTE = "data-server-island";

export type ServerIslandFillOptions = {
  /** Reports a fill that failed. Defaults to silence — a fallback is a valid page. */
  onError?: (island: string, error: unknown) => void;
  signal?: AbortSignal;
};

export async function fillServerIslands(
  root: ParentNode = document,
  options: ServerIslandFillOptions = {},
): Promise<void> {
  const placeholders = [...root.querySelectorAll<HTMLElement>(`[${ATTRIBUTE}]`)];
  // Started together rather than in sequence: two holes on a page should cost
  // one round trip's worth of latency, not two.
  await Promise.all(placeholders.map((element) => fillOne(element, options)));
}

async function fillOne(element: HTMLElement, options: ServerIslandFillOptions): Promise<void> {
  const name = element.getAttribute(ATTRIBUTE) ?? "";
  const payload = element.getAttribute("data-payload");
  if (!payload) return;

  // Claimed before the request so a second call — a re-render, a double
  // invocation — cannot fill the same hole twice.
  element.removeAttribute("data-payload");

  try {
    const url = new URL(ENDPOINT, window.location.origin);
    url.searchParams.set("p", payload);
    url.searchParams.set("path", element.getAttribute("data-path") ?? window.location.pathname);

    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { accept: "text/html" },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw new Error(`server island responded ${response.status}`);

    const html = await response.text();
    // An empty body means the server had nothing to show — a signed-out visitor
    // where the island renders an account summary. The fallback stays.
    if (html.trim().length === 0) return;

    // `innerHTML` with markup from our own origin, produced by the island
    // renderer on the server. The renderer escapes what it interpolates
    // (`renderToStaticMarkup` does), so the trust boundary is the island's own
    // code — the same boundary as any other server-rendered markup on the page.
    // It is still a DOM sink: when Trusted Types lands (docs/framework-research
    // -2026.md §5.1) this assignment is one of the places that needs a policy.
    element.innerHTML = html;
    element.setAttribute("data-filled", "");
  } catch (error) {
    options.onError?.(name, error);
  }
}
