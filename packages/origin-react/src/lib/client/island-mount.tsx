/** @jsxRuntime automatic */ /** @jsxImportSource react */
import { type ComponentType, type ReactNode, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { parseEmbeddedJson } from "../embedded-json.js";
import { reportClientError } from "./error-telemetry.js";
import {
  createIslandMountWatchdog,
  IslandRuntimeError,
  loadIslandModule,
} from "./island-runtime.js";

export type IslandModule = { default: ComponentType<Record<string, unknown>> };

/** Map of module path → lazy loader, e.g. the result of `import.meta.glob("./islands/*.tsx")`. */
export type IslandModuleLoaders = Record<string, () => Promise<IslandModule>>;

export type IslandMounter = (el: HTMLElement) => Promise<void>;

function IslandCommitSignal({ children, onCommit }: { children: ReactNode; onCommit: () => void }) {
  useEffect(onCommit, [onCommit]);
  return children;
}

function reactErrorOptions(
  island: string,
  cancelMountTimeout: () => void,
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
      reportClientError("react-uncaught", error, {
        island,
        componentStack: errorInfo.componentStack,
      });
    },
  };
}

/**
 * Builds the island mount function from an app-supplied module map. Island names are the
 * module file names (without extension); markers reference them via `data-island`.
 */
export function createIslandMounter(options: { modules: IslandModuleLoaders }): IslandMounter {
  const byName = new Map<string, () => Promise<IslandModule>>();
  for (const [path, load] of Object.entries(options.modules)) {
    byName.set(islandNameFromPath(path), load);
  }

  return async function mount(el: HTMLElement) {
    const island = el.dataset.island ?? "unknown";
    const load = byName.get(island);
    if (!load) {
      reportClientError("island-module-missing", new Error(`Island module not found: ${island}`), {
        island,
      });
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
      reportClientError(source, error, { island });
      return;
    }

    let props: Record<string, unknown>;
    try {
      props = parseEmbeddedJson<Record<string, unknown>>(el.dataset.props || "{}");
    } catch (error) {
      reportClientError("island-props", error, { island });
      return;
    }

    try {
      const cancelMountTimeout = createIslandMountWatchdog(() => {
        reportClientError("island-mount-timeout", new Error("Island root did not commit in time"), {
          island,
        });
      });
      const tree = (
        <IslandCommitSignal onCommit={cancelMountTimeout}>
          <Comp {...props} />
        </IslandCommitSignal>
      );
      const errorOptions = reactErrorOptions(island, cancelMountTimeout);

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
      reportClientError("island-mount", error, { island });
    }
  };
}

function islandNameFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[jt]sx?$/, "");
}
