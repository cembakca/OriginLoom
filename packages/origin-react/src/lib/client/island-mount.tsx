/** @jsxRuntime automatic */ /** @jsxImportSource react */
import { reportClientError } from "@originloom/shared/lib/client/error-telemetry";
import {
  createIslandMountWatchdog,
  IslandRuntimeError,
  loadIslandModule,
} from "@originloom/shared/lib/client/island-runtime";
import { reportIslandMount } from "@originloom/shared/lib/client/performance-telemetry";
import { parseEmbeddedJson } from "@originloom/shared/lib/embedded-json";
import { type ComponentType, type ReactNode, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { readRequestContext, RequestContextProvider } from "../request-context.js";

export type IslandModule = { default: ComponentType<Record<string, unknown>> };

/** Map of module path → lazy loader, e.g. the result of `import.meta.glob("./islands/*.tsx")`. */
export type IslandModuleLoaders = Record<string, () => Promise<IslandModule>>;

export type IslandMounter = (el: HTMLElement) => Promise<void>;

export type IslandErrorContext = {
  island: string;
  errorId: string;
  /**
   * The raw thrown value — for telemetry/`onComponentFailure` only. Never render
   * `error.message`/`error.stack` into `formatIslandError`'s returned string: they can
   * carry internal paths or reflected user input, and that string becomes visible DOM
   * text. Use `errorId` as the user-facing reference instead.
   */
  error: unknown;
};

/**
 * Formats the PII-free text shown next to a failed island. Must not use `context.error`
 * (see its doc comment) — only `errorId` is safe to render. Platform code never bakes in
 * app-facing copy or a specific locale — apps pass their own formatter (or the create-app
 * template's default) via `createIslandMounter({ formatIslandError })`.
 */
export type IslandErrorFormatter = (context: IslandErrorContext) => string;

/**
 * Explicit, opt-in hook for a genuine post-mount component failure (React's
 * `onUncaughtError`), as opposed to a pre-mount loading/parsing failure that leaves the
 * server-rendered markup intact. The platform does not prescribe what happens to `element`
 * here — an app may mount its own fallback UI into it, leave it alone, or anything else.
 */
export type IslandComponentFailureHandler = (
  element: HTMLElement,
  context: IslandErrorContext,
) => void;

const defaultFormatIslandError: IslandErrorFormatter = ({ errorId }) =>
  `Something went wrong. Reference: ${errorId}`;

function IslandCommitSignal({ children, onCommit }: { children: ReactNode; onCommit: () => void }) {
  useEffect(onCommit, [onCommit]);
  return children;
}

function reactErrorOptions(
  island: string,
  cancelMountTimeout: () => void,
  element: HTMLElement,
  formatIslandError: IslandErrorFormatter,
  onComponentFailure: IslandComponentFailureHandler | undefined,
): NonNullable<Parameters<typeof hydrateRoot>[2]> {
  return {
    onCaughtError: (error, errorInfo) => {
      reportClientError("react-caught", error, {
        island,
        componentStack: errorInfo.componentStack,
      });
    },
    onRecoverableError: (error, errorInfo) => {
      reportClientError("react-recoverable", error, {
        island,
        componentStack: errorInfo.componentStack,
      });
    },
    onUncaughtError: (error, errorInfo) => {
      cancelMountTimeout();
      const errorId = reportClientError("react-uncaught", error, {
        island,
        componentStack: errorInfo.componentStack,
      });
      showIslandErrorReference(element, { island, errorId, error }, formatIslandError);
      onComponentFailure?.(element, { island, errorId, error });
    },
  };
}

/**
 * Builds the island mount function from an app-supplied module map. Island names are the
 * module file names (without extension); markers reference them via `data-island`.
 */
export function createIslandMounter(options: {
  modules: IslandModuleLoaders;
  Wrapper?: ComponentType<{ children: ReactNode }>;
  formatIslandError?: IslandErrorFormatter;
  onComponentFailure?: IslandComponentFailureHandler;
}): IslandMounter {
  const byName = new Map<string, () => Promise<IslandModule>>();
  const Wrapper = options.Wrapper;
  const formatIslandError = options.formatIslandError ?? defaultFormatIslandError;
  const onComponentFailure = options.onComponentFailure;
  // An island is its own React root, so it would otherwise start with none of
  // the request identity the document rendered with — and a link inside it
  // would quietly point somewhere else than the same link outside it.
  const requestContext = readRequestContext();
  for (const [path, load] of Object.entries(options.modules)) {
    byName.set(islandNameFromPath(path), load);
  }

  return async function mount(el: HTMLElement) {
    const startedAt = performance.now();
    const island = el.dataset.island ?? "unknown";
    const load = byName.get(island);
    if (!load) {
      const error = new Error(`Island module not found: ${island}`);
      const errorId = reportClientError("island-module-missing", error, { island });
      showIslandErrorReference(el, { island, errorId, error }, formatIslandError);
      return;
    }

    let Comp: IslandModule["default"];
    try {
      ({ default: Comp } = await loadIslandModule(load));
    } catch (error) {
      const source =
        error instanceof IslandRuntimeError && error.failure === "mount-timeout"
          ? "island-mount-timeout"
          : "island-chunk-load";
      const errorId = reportClientError(source, error, { island });
      showIslandErrorReference(el, { island, errorId, error }, formatIslandError);
      return;
    }

    let props: Record<string, unknown>;
    try {
      props = parseEmbeddedJson<Record<string, unknown>>(el.dataset.props || "{}");
    } catch (error) {
      const errorId = reportClientError("island-props", error, { island });
      showIslandErrorReference(el, { island, errorId, error }, formatIslandError);
      return;
    }

    try {
      const cancelMountTimeout = createIslandMountWatchdog(() => {
        const error = new Error("Island root did not commit in time");
        const errorId = reportClientError("island-mount-timeout", error, { island });
        showIslandErrorReference(el, { island, errorId, error }, formatIslandError);
      });
      const markCommitted = () => {
        cancelMountTimeout();
        reportIslandMount(island, performance.now() - startedAt);
        clearIslandErrorReference(el);
        // A deterministic readiness signal for browser tests, monitoring and
        // progressive UI. Presence means React committed, not merely that the
        // server-rendered fallback was visible.
        el.dataset.hydrated = "";
      };
      const islandTree = <Comp {...props} />;
      const tree = (
        <IslandCommitSignal onCommit={markCommitted}>
          <RequestContextProvider value={requestContext}>
            {Wrapper ? <Wrapper>{islandTree}</Wrapper> : islandTree}
          </RequestContextProvider>
        </IslandCommitSignal>
      );
      const errorOptions = reactErrorOptions(
        island,
        cancelMountTimeout,
        el,
        formatIslandError,
        onComponentFailure,
      );

      try {
        if (el.dataset.mode === "hydrate") {
          hydrateRoot(el, tree, errorOptions);
        } else {
          createRoot(el, errorOptions).render(tree);
        }
      } catch (error) {
        cancelMountTimeout();
        throw error;
      }
    } catch (error) {
      const errorId = reportClientError("island-mount", error, { island });
      showIslandErrorReference(el, { island, errorId, error }, formatIslandError);
    }
  };
}

// One status element per island root, tracked outside the DOM so a second failure
// (e.g. the mount-timeout watchdog followed by onUncaughtError) updates the existing
// element instead of appending a duplicate. The root's own children — the
// server-rendered markup — are never touched here.
const errorStatusElements = new WeakMap<HTMLElement, HTMLElement>();

function showIslandErrorReference(
  element: HTMLElement,
  context: IslandErrorContext,
  formatIslandError: IslandErrorFormatter,
): void {
  element.removeAttribute("data-hydrated");
  element.dataset.errorReference = context.errorId;

  let status = errorStatusElements.get(element);
  if (!status || status.previousElementSibling !== element) {
    status = document.createElement("p");
    status.setAttribute("role", "alert");
    status.setAttribute("data-island-error-for", context.island);
    element.insertAdjacentElement("afterend", status);
    errorStatusElements.set(element, status);
  }
  status.textContent = formatIslandError(context);
}

function clearIslandErrorReference(element: HTMLElement): void {
  if (element.dataset.errorReference) delete element.dataset.errorReference;
  const status = errorStatusElements.get(element);
  if (status) {
    status.remove();
    errorStatusElements.delete(element);
  }
}

function islandNameFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[jt]sx?$/, "");
}
