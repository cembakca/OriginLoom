import { reportClientError } from "@originloom/shared/lib/client/error-telemetry";
import {
  createIslandMountWatchdog,
  IslandRuntimeError,
  loadIslandModule,
} from "@originloom/shared/lib/client/island-runtime";
import { parseEmbeddedJson } from "@originloom/shared/lib/embedded-json";

/**
 * An island module default-exports its mount function. It receives the marker
 * element — server-rendered markup already inside it for `hydrate`, the
 * fallback for `defer` — and the props from `data-props`.
 */
export type IslandMount = (
  element: HTMLElement,
  props: Record<string, unknown>,
) => void | Promise<void>;

export type IslandModule = { default: IslandMount };

/** Map of module path → lazy loader, e.g. `import.meta.glob("./islands/*.ts")`. */
export type IslandModuleLoaders = Record<string, () => Promise<IslandModule>>;

export type IslandMounter = (el: HTMLElement) => Promise<void>;

/**
 * Builds the island mount function from an app-supplied module map. Island names
 * are the module file names (without extension); markers reference them via
 * `data-island`. Same contract as the React mounter — only the mount step differs.
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

    let mountIsland: IslandMount;
    try {
      ({ default: mountIsland } = await loadIslandModule(load));
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

    const cancelMountTimeout = createIslandMountWatchdog(() => {
      reportClientError("island-mount-timeout", new Error("Island did not mount in time"), {
        island,
      });
    });
    try {
      await mountIsland(el, props);
    } catch (error) {
      reportClientError("island-mount", error, { island });
    } finally {
      cancelMountTimeout();
    }
  };
}

function islandNameFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[jt]sx?$/, "");
}
