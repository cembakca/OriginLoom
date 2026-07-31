declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
    __originLoomSignalReactReady?: () => void;
  }
}

/**
 * Push to the dataLayer.
 *
 * Ordering is not decided here. The head bootstrap wraps `dataLayer.push` and
 * holds `gtm.dom` / `gtm.load` until the page view has landed — see
 * `eventQueueScript`. This function used to take a `priority` whose branches all
 * did the same thing, which read as a queue and was not one.
 */
export function pushDataLayer(payload: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);
}

export function signalReactReady(): void {
  window.__originLoomSignalReactReady?.();
}
