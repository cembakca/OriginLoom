import type { Ctx } from "@originloom/shared/lib/types";

import { observeShellDependency } from "./metrics.js";
import { SpanKind, withSpan } from "./observability.js";
import { getRuntime, type ShellBuildOptions, type ShellDependencyContext } from "./runtime.js";
import { withRequestSignal } from "./ssr/context.js";

type ShellDependency =
  | "request_facts"
  | "public_snapshot"
  | "targeting"
  | "request_overlay"
  | "compose"
  | "terminal"
  | "legacy";

export type ShellResolution = {
  /** Request overlay is allowed only for a no-store request render. */
  resolve(options: { includeRequestOverlay: boolean }): Promise<unknown>;
  abort(reason?: unknown): void;
};

export function createShellResolution(
  ctx: Ctx,
  route: string,
  options: ShellBuildOptions = {},
): ShellResolution {
  const runtime = getRuntime();
  const controller = new AbortController();
  const context = shellContext(ctx, controller, options);

  if (typeof runtime.buildShellData === "function") {
    const shell = dependency("legacy", route, context.signal, () =>
      runtime.buildShellData(context.ctx, options),
    );
    observeDetached(shell);
    return {
      resolve: () => shell,
      abort: (reason) => abortController(controller, reason),
    };
  }

  const plan = runtime.shell;
  const facts = dependency("request_facts", route, context.signal, () =>
    plan.requestFacts(context.ctx, options),
  );
  const publicSnapshot = facts.then((resolvedFacts) =>
    dependency("public_snapshot", route, context.signal, () =>
      plan.loadPublicShellSnapshot(resolvedFacts, context),
    ),
  );
  const targetedShell = Promise.all([facts, publicSnapshot]).then(
    ([resolvedFacts, resolvedSnapshot]) =>
      dependency("targeting", route, context.signal, () =>
        plan.buildTargetedShell(resolvedSnapshot, resolvedFacts, context),
      ),
  );
  observeDetached(publicSnapshot);
  observeDetached(targetedShell);

  let overlay: Promise<unknown> | undefined;
  let publicShell: Promise<unknown> | undefined;
  let requestShell: Promise<unknown> | undefined;

  const resolve = ({ includeRequestOverlay }: { includeRequestOverlay: boolean }) => {
    if (!includeRequestOverlay) {
      publicShell ??= compose(undefined);
      return publicShell;
    }
    overlay ??= facts.then((resolvedFacts) =>
      plan.loadRequestOverlay
        ? dependency("request_overlay", route, context.signal, () =>
            plan.loadRequestOverlay!(resolvedFacts, context),
          )
        : undefined,
    );
    requestShell ??= overlay.then((resolvedOverlay) => compose(resolvedOverlay));
    return requestShell;
  };

  function compose(requestOverlay: unknown): Promise<unknown> {
    return Promise.all([facts, publicSnapshot, targetedShell]).then(
      ([resolvedFacts, resolvedSnapshot, resolvedTargetedShell]) =>
        dependency("compose", route, context.signal, () =>
          plan.composeShell({
            facts: resolvedFacts,
            publicSnapshot: resolvedSnapshot,
            targetedShell: resolvedTargetedShell,
            requestOverlay,
            context,
          }),
        ),
    );
  }

  return {
    resolve,
    abort: (reason) => abortController(controller, reason),
  };
}

/** Terminal boundaries deliberately do not start or await public shell dependencies. */
export async function resolveTerminalShell(
  ctx: Ctx,
  route: string,
  options: ShellBuildOptions = {},
): Promise<unknown> {
  const runtime = getRuntime();
  const controller = new AbortController();
  const context = shellContext(ctx, controller, options);
  if (typeof runtime.buildShellData === "function") {
    return dependency("legacy", route, context.signal, () =>
      runtime.buildShellData(context.ctx, options),
    );
  }
  const facts = await dependency("request_facts", route, context.signal, () =>
    runtime.shell.requestFacts(context.ctx, options),
  );
  return dependency("terminal", route, context.signal, () =>
    runtime.shell.composeTerminalShell({ facts, context }),
  );
}

function shellContext(
  ctx: Ctx,
  controller: AbortController,
  options: ShellBuildOptions,
): ShellDependencyContext {
  const signal = AbortSignal.any([ctx.request.signal, controller.signal]);
  return {
    ctx: {
      ...ctx,
      request: withRequestSignal(ctx.request, signal),
    },
    signal,
    options,
  };
}

async function dependency<T>(
  name: ShellDependency,
  route: string,
  signal: AbortSignal,
  work: () => T | Promise<T>,
): Promise<T> {
  const started = performance.now();
  let outcome: "success" | "error" | "aborted" = "success";
  try {
    return await withSpan(
      `shell.${name}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: { "http.route": route, "shell.dependency": name },
      },
      async () => {
        if (signal.aborted) throw abortReason(signal);
        return work();
      },
    );
  } catch (error) {
    outcome = signal.aborted ? "aborted" : "error";
    throw error;
  } finally {
    observeShellDependency(name, outcome, performance.now() - started);
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function abortController(controller: AbortController, reason?: unknown): void {
  if (controller.signal.aborted) return;
  controller.abort(reason ?? new DOMException("Shell resolution no longer needed", "AbortError"));
}

function observeDetached(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}
