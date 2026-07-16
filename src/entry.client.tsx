import "./styles/globals.css";

import type { ComponentType } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { reportClientError } from "~/lib/client/error-telemetry";
import { AppQueryProvider } from "~/lib/query/provider";

type IslandModule = { default: ComponentType<Record<string, unknown>> };

// Vite turns this into a code-split map. Each island is its own chunk, so a
// page ships only the JS for the islands actually on it.
const registry = import.meta.glob<IslandModule>("./islands/*.tsx");

const byName = new Map<string, () => Promise<IslandModule>>();
for (const [path, load] of Object.entries(registry)) {
  byName.set(path.slice("./islands/".length, -".tsx".length), load);
}

async function mount(el: HTMLElement) {
  const island = el.dataset.island ?? "unknown";
  try {
    const load = byName.get(island);
    if (!load) throw new Error(`Island module not found: ${island}`);
    const { default: Comp } = await load();

    const props = JSON.parse(el.dataset.props || "{}") as Record<string, unknown>;
    const tree = (
      <AppQueryProvider>
        <Comp {...props} />
      </AppQueryProvider>
    );
    const errorOptions = reactErrorOptions(island);

    if (el.dataset.mode === "hydrate") {
      hydrateRoot(el, tree, errorOptions);
    } else {
      createRoot(el, errorOptions).render(tree);
    }
  } catch (error) {
    reportClientError("island-mount", error, { island });
  }
}

function reactErrorOptions(island: string): NonNullable<Parameters<typeof hydrateRoot>[2]> {
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
      reportClientError("react-uncaught", error, {
        island,
        componentStack: errorInfo.componentStack,
      });
    },
  };
}

const io = new IntersectionObserver(
  (entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      obs.unobserve(e.target);
      void mount(e.target as HTMLElement);
    }
  },
  { rootMargin: "200px" },
);

for (const el of document.querySelectorAll<HTMLElement>("[data-island]")) {
  if (el.dataset.eager !== undefined) void mount(el);
  else io.observe(el);
}
