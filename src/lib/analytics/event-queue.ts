import type { DataLayerPushPriority, GtmLifecycleEvent } from "./types";

type QueuedPush = { payload: Record<string, unknown>; priority: DataLayerPushPriority };

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}

const GTM_DOM = "gtm.dom";
const GTM_LOAD = "gtm.load";

let reactReady = false;
let domReleased = false;
let loadReleased = false;

const domQueue: QueuedPush[] = [];
const loadQueue: QueuedPush[] = [];
const betweenQueue: QueuedPush[] = [];

function isLifecycleEvent(payload: Record<string, unknown>): payload is GtmLifecycleEvent {
  return payload.event === GTM_DOM || payload.event === GTM_LOAD;
}

function flush(queue: QueuedPush[], target: Record<string, unknown>[]) {
  for (const item of queue.splice(0)) {
    Array.prototype.push.call(target, item.payload);
  }
}

function releaseDom() {
  if (domReleased) return;
  domReleased = true;
  flush(domQueue, window.dataLayer);
  flush(betweenQueue, window.dataLayer);
}

function releaseLoad() {
  if (loadReleased) return;
  loadReleased = true;
  flush(loadQueue, window.dataLayer);
}

/** Install dataLayer.push interceptor — call once before GTM container loads. */
export function installEventQueue(): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];

  const original = window.dataLayer.push.bind(window.dataLayer);

  window.dataLayer.push = (...args: Record<string, unknown>[]) => {
    for (const payload of args) {
      if (!payload || typeof payload !== "object") {
        original(payload);
        continue;
      }

      if (isLifecycleEvent(payload)) {
        if (payload.event === GTM_DOM) {
          if (reactReady) releaseDom();
          else domQueue.push({ payload, priority: "after-dom" });
          continue;
        }
        if (payload.event === GTM_LOAD) {
          if (domReleased) releaseLoad();
          else loadQueue.push({ payload, priority: "after-dom" });
          continue;
        }
      }

      original(payload);
    }
    return window.dataLayer.length;
  };
}

/** Page analytics calls this after originalLocation + GAVirtual are pushed. */
export function signalReactReady(): void {
  reactReady = true;
  if (!domReleased) releaseDom();
  if (!loadReleased && loadQueue.length > 0) releaseLoad();
}

export function pushWithPriority(
  payload: Record<string, unknown>,
  priority: DataLayerPushPriority,
): void {
  window.dataLayer = window.dataLayer || [];

  if (priority === "immediate") {
    window.dataLayer.push(payload);
    return;
  }

  if (priority === "after-react") {
    if (reactReady) window.dataLayer.push(payload);
    else domQueue.push({ payload, priority });
    return;
  }

  if (priority === "between-dom-load") {
    if (domReleased && !loadReleased) window.dataLayer.push(payload);
    else betweenQueue.push({ payload, priority });
    return;
  }

  // after-dom
  if (domReleased) window.dataLayer.push(payload);
  else domQueue.push({ payload, priority });
}

/** Test helper — reset module state between unit tests. */
export function resetEventQueueForTests(): void {
  reactReady = false;
  domReleased = false;
  loadReleased = false;
  domQueue.length = 0;
  loadQueue.length = 0;
  betweenQueue.length = 0;
}
