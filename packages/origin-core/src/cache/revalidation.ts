import type { Ctx, Route } from "@originloom/react/lib/types";

import type { Assets } from "../assets.js";
import { config } from "../config.js";
import { logError } from "../logger.js";
import { observeRevalidation } from "../metrics.js";
import { SpanKind, SpanStatusCode, withSpan } from "../observability.js";
import { runLoader, runRender } from "../ssr/execute-route.js";
import * as cache from "./index.js";

type SharedPolicy = ReturnType<NonNullable<Route["cache"]>>;

const revalidationsInFlight = new Map<string, Promise<void>>();

export async function drainRevalidations(timeoutMs: number): Promise<boolean> {
  const pending = [...revalidationsInFlight.values()];
  if (pending.length === 0) return true;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const completed = Promise.allSettled(pending).then(() => true);
  const deadline = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
    timeout.unref?.();
  });
  const drained = await Promise.race([completed, deadline]);
  if (timeout) clearTimeout(timeout);
  return drained;
}

export function scheduleRevalidation(
  key: string,
  route: Route,
  routeCtx: Ctx,
  policy: SharedPolicy,
  assets: Assets,
  requestId?: string,
): void {
  if (revalidationsInFlight.has(key)) return;

  const pending = runRevalidation(key, route, routeCtx, policy, assets, requestId).finally(() => {
    if (revalidationsInFlight.get(key) === pending) revalidationsInFlight.delete(key);
  });
  revalidationsInFlight.set(key, pending);
}

async function runRevalidation(
  key: string,
  route: Route,
  routeCtx: Ctx,
  policy: SharedPolicy,
  assets: Assets,
  requestId?: string,
): Promise<void> {
  const started = performance.now();
  let outcome: "success" | "error" | "lock_miss" = "error";
  try {
    outcome = await withSpan(
      "cache.revalidate",
      {
        kind: SpanKind.INTERNAL,
        attributes: { "http.route": route.path, "cache.operation": "revalidate" },
      },
      (span) =>
        revalidate(key, route, routeCtx, policy, assets, requestId).then((result) => {
          span.setAttribute("cache.revalidation.outcome", result);
          if (result === "error") span.setStatus({ code: SpanStatusCode.ERROR });
          return result;
        }),
    );
  } finally {
    observeRevalidation(outcome, performance.now() - started);
  }
}

async function revalidate(
  key: string,
  route: Route,
  routeCtx: Ctx,
  policy: SharedPolicy,
  assets: Assets,
  requestId?: string,
): Promise<"success" | "error" | "lock_miss"> {
  const lockToken = await cache.acquireRevalidationLock(key);
  if (!lockToken) return "lock_miss";
  try {
    for (let attempt = 1; attempt <= config.revalidationAttempts; attempt++) {
      try {
        const result = await runLoader(route, routeCtx, "revalidation");
        if (result.kind && result.kind !== "data") {
          throw new Error(`revalidation loader returned terminal result: ${result.kind}`);
        }
        if ((result.status ?? 200) !== 200) {
          throw new Error(`revalidation loader returned ${result.status ?? 200}`);
        }
        const body = await runRender(route, result.data, assets, routeCtx, "revalidation");
        if (!(await cache.write(key, body, policy))) {
          throw new Error("revalidation cache write failed");
        }
        return "success";
      } catch (error) {
        logError(error, {
          requestId,
          key,
          attempt,
          maxAttempts: config.revalidationAttempts,
          msg: "revalidate attempt failed",
        });
        if (attempt < config.revalidationAttempts) {
          await delay(config.revalidationBackoffMs * 2 ** (attempt - 1));
        }
      }
    }
    return "error";
  } finally {
    await cache.releaseRevalidationLock(key, lockToken);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
