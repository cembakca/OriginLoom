export type WebVitalName = "CLS" | "INP" | "LCP";
export type WebVitalRating = "good" | "needs-improvement" | "poor";

export function reportWebVital(metric: {
  name: WebVitalName;
  value: number;
  rating: WebVitalRating;
}): void {
  report({ kind: "web-vital", ...metric, path: window.location.pathname });
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
