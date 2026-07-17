import "./styles/globals.css";

import { type ComponentType, type ReactNode, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { reportClientError } from "~/lib/client/error-telemetry";
import {
  bootstrapIslandElements,
  createIslandMountWatchdog,
  IslandRuntimeError,
  loadIslandModule,
} from "~/lib/client/island-runtime";
import { installReloadButtons } from "~/lib/client/reload-button";
import { parseEmbeddedJson } from "~/lib/embedded-json";
import { AppQueryProvider } from "~/lib/query/provider";

type IslandModule = { default: ComponentType<Record<string, unknown>> };

installReloadButtons();

// Vite turns this into a code-split map. Each island is its own chunk, so a
// page ships only the JS for the islands actually on it.
const registry = import.meta.glob<IslandModule>("./islands/*.tsx");

const byName = new Map<string, () => Promise<IslandModule>>();
for (const [path, load] of Object.entries(registry)) {
  byName.set(path.slice("./islands/".length, -".tsx".length), load);
}

async function mount(el: HTMLElement) {
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
        <AppQueryProvider>
          <Comp {...props} />
        </AppQueryProvider>
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
}

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

bootstrapIslandElements(
  document.querySelectorAll<HTMLElement>("[data-island]"),
  (element) => void mount(element),
  {
    onObserverError: (error) => reportClientError("island-bootstrap", error),
  },
);
