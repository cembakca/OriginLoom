import { isRequestDeadlineError } from "@server/middleware/request-deadline";
import { type FragmentDefinition, getRuntime } from "@server/runtime";
import { renderToString } from "react-dom/server";

import type { CachePolicy, Ctx } from "@originloom/react/lib/types";

import { coalesceColdMiss } from "./cold-fill";

function fragmentDefinition(name: string): FragmentDefinition | undefined {
  return getRuntime().fragments[name];
}

export function fragmentRequiresShell(name: string): boolean {
  return fragmentDefinition(name)?.requiresShell ?? false;
}

export function shouldResolveFragment(name: string, cachedDocument: boolean): boolean {
  const definition = fragmentDefinition(name);
  return definition ? cachedDocument || definition.resolveOnFreshDocument : true;
}

export function fragmentCacheKey(name: string, shell: unknown, ctx: Ctx): string {
  const definition = fragmentDefinition(name);
  if (!definition) throw new Error(`Bilinmeyen fragment resolver: ${name}`);
  return definition.key(shell, ctx);
}

/**
 * Resolves a fragment by name.
 * Cold misses share the existing process + Redis distributed coalescing path.
 */
export async function getOrSetFragmentByName(
  name: string,
  shell: unknown,
  ctx: Ctx,
): Promise<string> {
  const definition = fragmentDefinition(name);
  if (!definition) {
    throw new Error(`Bilinmeyen fragment resolver: ${name}`);
  }
  if (ctx.request.signal.aborted) throw abortReason(ctx.request.signal);

  const key = fragmentCacheKey(name, shell, ctx);
  const policy: CachePolicy = { kind: "shared", ttl: definition.ttl, key: [key] };
  const pending = coalesceColdMiss({
    key,
    policy,
    work: async () => {
      const element = await definition.resolve(shell, ctx);
      const html = renderToString(element);
      return { value: html, body: html, cacheable: true, terminal: false };
    },
    isTimeout: (error) =>
      isRequestDeadlineError(error) || isRequestDeadlineError(ctx.request.signal.reason),
  });
  const result = await waitForSignal(pending, ctx.request.signal);
  return result.kind === "cache" ? result.body : result.work.value;
}

function waitForSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}
