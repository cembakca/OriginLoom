export type WebVitalName = "CLS" | "INP" | "LCP";
export type WebVitalRating = "good" | "needs-improvement" | "poor";

export function reportWebVital(metric: {
  name: WebVitalName;
  value: number;
  rating: WebVitalRating;
}): void {
  report({ kind: "web-vital", ...metric, path: window.location.pathname });
}

/**
 * Whether the back button actually restored this page, and if not, why.
 *
 * The back/forward cache is a large share of real navigation and we were not
 * measuring it at all — which meant we could not tell whether our own rules were
 * disabling it. Two things a browser already tells us answer that: `pageshow`
 * with `persisted` says the page came back alive, and Chrome's
 * `notRestoredReasons` on the navigation entry says what blocked it when it did
 * not. A `no-store` response, an `unload` listener and an open EventSource are
 * all in that vocabulary, so the reasons name our own rules back to us.
 *
 * Safe to call unconditionally: a browser without either signal reports nothing
 * rather than guessing. Safe to call twice as well — the second call does
 * nothing, because two `pageshow` listeners would report one restore as two and
 * a counter that double-counts is worse than one that does not exist.
 */
let backForwardCacheObserved = false;

export function reportBackForwardCache(): void {
  if (backForwardCacheObserved) return;
  backForwardCacheObserved = true;

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    report({ kind: "bfcache", outcome: "restored", reason: "restored", path: path(), value: 1 });
  });

  // The entry describes how *this* navigation resolved, so it is only worth
  // reading once the navigation is over.
  const emit = () => {
    for (const reason of notRestoredReasons()) {
      report({ kind: "bfcache", outcome: "blocked", reason, path: path(), value: 1 });
    }
  };
  if (document.readyState === "complete") emit();
  else window.addEventListener("load", emit, { once: true });
}

type NotRestored = { reasons?: { reason?: string }[]; children?: NotRestored[] };

/**
 * Chrome nests the reasons by frame. Flattened here because a blocked restore is
 * blocked whichever frame caused it, and the frame tree is not something the
 * server-side counter could label without unbounded cardinality.
 */
function notRestoredReasons(): string[] {
  const [navigation] = performance.getEntriesByType(
    "navigation",
  ) as (PerformanceNavigationTiming & {
    notRestoredReasons?: NotRestored | null;
  })[];
  const root = navigation?.notRestoredReasons;
  if (!root) return [];

  const found = new Set<string>();
  const queue: NotRestored[] = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;
    for (const entry of node.reasons ?? []) {
      if (typeof entry.reason === "string" && entry.reason) found.add(entry.reason);
    }
    queue.push(...(node.children ?? []));
  }
  return [...found].slice(0, 8);
}

function path(): string {
  return window.location.pathname;
}

export function reportIslandMount(island: string, durationMs: number): void {
  report({
    kind: "island-mount",
    name: island.slice(0, 100),
    value: durationMs,
    path: window.location.pathname,
  });
}

function report(payload: Record<string, unknown>): void {
  if (!Number.isFinite(payload.value) || Number(payload.value) < 0) return;
  void fetch("/api/internal/client-metrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "omit",
    keepalive: true,
  }).catch(() => undefined);
}
