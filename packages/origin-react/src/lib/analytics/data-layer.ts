import type { DataLayerPushPriority } from "./types.js";

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
    __originLoomSignalReactReady?: () => void;
  }
}

/** Push to dataLayer — immediate events bypass queue; gtm.dom/load handled by head bootstrap. */
export function pushDataLayer(
  payload: Record<string, unknown>,
  priority: DataLayerPushPriority = "immediate",
): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];

  if (priority === "immediate") {
    window.dataLayer.push(payload);
    return;
  }

  // Non-immediate custom events — after React ready (gtm.dom released by head script).
  if (priority === "after-dom" && window.__originLoomSignalReactReady) {
    window.dataLayer.push(payload);
  } else {
    window.dataLayer.push(payload);
  }
}

export function signalReactReady(): void {
  window.__originLoomSignalReactReady?.();
}
