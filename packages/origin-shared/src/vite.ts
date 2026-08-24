import { join } from "node:path";

import type { Plugin, PluginOption, UserConfig, ViteDevServer } from "vite";

/**
 * The framework-neutral half of the build setup. `vite` is imported for types
 * only, so this module adds no runtime dependency: plugins are plain objects and
 * configs are plain data. Renderer adapters (`@originloom/react/vite`,
 * `@originloom/react/vite`) layer their own plugins on top.
 */
export type DevReloadOptions = {
  /**
   * Legacy fallback for servers that do not expose a generation header yet.
   * New servers detect restarts from `/readyz`, so a path allowlist is unnecessary.
   * @deprecated Remove this after every environment serves the generation-aware readiness route.
   */
  shouldReload?: (file: string) => boolean;
  /** Readiness endpoint carrying `x-originloom-dev-generation`. */
  readinessUrl?: string;
  /** @deprecated Use `readinessUrl`; retained for existing Vite configs. */
  healthUrl?: string;
  debounceMs?: number;
  /** Poll cadence while the SSR watcher is replacing a process. */
  pollIntervalMs?: number;
  /** Maximum time to wait for the replacement process. */
  maxWaitMs?: number;
};

export type ClientViteConfigOptions = {
  /** Absolute path of the client entry module. */
  entry: string;
  /** Path aliases (e.g. { "~": <src>, "@server": <server> }). */
  alias?: Record<string, string>;
  outDir?: string;
  devServer?: { host?: string; port?: number };
  /** Omit to disable the SSR full-reload plugin. */
  reload?: DevReloadOptions;
};

export type BaseClientViteConfigOptions = ClientViteConfigOptions & {
  /** Framework plugins (JSX transform, CSS engine, …) prepended to the plugin list. */
  plugins?: PluginOption[];
  /** Packages that must resolve to a single copy (e.g. a UI framework runtime). */
  dedupe?: string[];
  /**
   * Dependencies to pre-bundle. The platform packages are excluded from the
   * optimizer, and Vite serves an excluded package's imports raw — so a CJS
   * dependency it reaches for (react-dom/client) would arrive without named
   * exports. Listing it here makes Vite pre-bundle it anyway.
   */
  optimizeDeps?: string[];
};

export type ServerViteConfigOptions = {
  /** Absolute path of the SSR server entry module. */
  entry: string;
  alias?: Record<string, string>;
  outDir?: string;
  /**
   * true bundles every dependency into the output (fully self-contained
   * server, container needs no node_modules). Defaults to inlining only
   * the workspace packages.
   */
  noExternal?: true | Array<string | RegExp>;
  dedupe?: string[];
};

/**
 * The two path aliases every generated app uses, derived from its root.
 *
 * They were written out by hand in three places — `vite.config.ts`,
 * `vite.server.config.ts` and `vitest.config.ts` — which is three chances for
 * the test run to resolve a different module than the build does, and no way to
 * notice. One definition, three callers.
 */
export function originLoomAliases(rootDir: string): Record<string, string> {
  return { "~": join(rootDir, "src"), "@server": join(rootDir, "server") };
}

/** Client island bundle. The server is plain Node — it never goes through Vite. */
export function createBaseClientViteConfig(options: BaseClientViteConfigOptions): UserConfig {
  const port = options.devServer?.port ?? 5174;
  const host = options.devServer?.host ?? "127.0.0.1";
  return {
    appType: "custom",
    plugins: [
      ...(options.plugins ?? []),
      ...(options.reload ? [createDevReloadPlugin(options.reload)] : []),
    ],
    resolve: { alias: options.alias ?? {}, dedupe: options.dedupe ?? [] },
    // Workspace packages ship TypeScript source; keep them out of the dep optimizer.
    optimizeDeps: {
      exclude: ["@originloom/shared", "@originloom/core", "@originloom/react"],
      ...(options.optimizeDeps ? { include: options.optimizeDeps } : {}),
    },
    server: {
      host,
      port,
      strictPort: true,
      origin: process.env.VITE_DEV_SERVER_URL ?? `http://${host}:${port}`,
      cors: { origin: /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/ },
    },
    build: {
      manifest: true,
      outDir: options.outDir ?? "dist/client",
      rollupOptions: {
        input: options.entry,
      },
    },
  };
}

/**
 * SSR server bundle: single self-contained index.js consumed by plain Node.
 * The render adapter's server entry belongs to this bundle only — it must never
 * be reached from the client entry.
 */
export function createServerViteConfig(options: ServerViteConfigOptions): UserConfig {
  return {
    resolve: { alias: options.alias ?? {}, dedupe: options.dedupe ?? [] },
    // Inline workspace package source into the bundle — Node cannot import the raw .ts exports.
    ssr: { noExternal: options.noExternal ?? [/^@originloom\//] },
    build: {
      ssr: options.entry,
      outDir: options.outDir ?? "dist/server",
      emptyOutDir: false,
      // SSR builds are not minified by Vite unless explicitly requested. A
      // self-contained server otherwise pays a large parse/cold-start cost.
      // Matches the engines floor: down-levelling syntax the supported runtime
      // runs natively costs bundle size and cold start for nothing.
      target: "node24",
      minify: "esbuild",
      sourcemap: true,
      rollupOptions: {
        output: { entryFileNames: "index.js" },
      },
    },
    // Keep profiler and production stack frames readable while still removing
    // whitespace and shortening local bindings.
    esbuild: { keepNames: true },
  };
}

/**
 * Full-reloads the browser only after the SSR process generation changes. Vite's
 * normal HMR remains in charge when a change does not restart the Node server.
 */
export function createDevReloadPlugin(options: DevReloadOptions): Plugin {
  const debounceMs = options.debounceMs ?? 600;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const maxWaitMs = options.maxWaitMs ?? 5_000;
  const readinessUrl =
    options.readinessUrl ??
    options.healthUrl ??
    `${process.env.SITE_URL ?? "http://127.0.0.1:3005"}/readyz`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let knownGeneration: string | undefined;
  let eventSequence = 0;
  let activeRun = 0;
  let closed = false;
  let warnedAboutMissingGeneration = false;
  let pendingLegacyReload = false;

  return {
    name: "origin-loom-server-reload",
    apply: "serve",
    configureServer(server) {
      const primeSequence = eventSequence;
      void primeReadyGeneration({
        readinessUrl,
        pollIntervalMs,
        maxWaitMs,
        isCancelled: () => closed || eventSequence !== primeSequence,
        setKnownGeneration: (generation) => {
          knownGeneration = generation;
        },
      });

      const onChange = (file: string) => {
        const normalizedFile = file.replaceAll("\\", "/");
        pendingLegacyReload ||= options.shouldReload?.(normalizedFile) ?? false;
        eventSequence++;
        const run = ++activeRun;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const legacyReloadRequested = pendingLegacyReload;
          pendingLegacyReload = false;
          void reloadAfterGenerationChange({
            server,
            readinessUrl,
            pollIntervalMs,
            maxWaitMs,
            legacyReloadRequested,
            getKnownGeneration: () => knownGeneration,
            setKnownGeneration: (generation) => {
              knownGeneration = generation;
            },
            isCancelled: () => closed || run !== activeRun,
            warnAboutMissingGeneration: () => {
              if (warnedAboutMissingGeneration) return;
              warnedAboutMissingGeneration = true;
              server.config.logger.warn(
                "SSR readiness endpoint has no x-originloom-dev-generation header; " +
                  "generation-aware browser reload is unavailable",
              );
            },
          });
        }, debounceMs);
      };
      for (const event of ["add", "change", "unlink"] as const) {
        server.watcher.on(event, onChange);
      }
      server.httpServer?.once("close", () => {
        closed = true;
        activeRun++;
        if (timer) clearTimeout(timer);
        for (const event of ["add", "change", "unlink"] as const) {
          server.watcher.off(event, onChange);
        }
      });
    },
  };
}

const DEV_SERVER_GENERATION_HEADER = "x-originloom-dev-generation";

type ReadyGeneration = { generation?: string };

async function readReadyGeneration(url: string): Promise<ReadyGeneration | undefined> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return undefined;
    const generation = response.headers.get(DEV_SERVER_GENERATION_HEADER);
    return generation ? { generation } : {};
  } catch {
    return undefined;
  }
}

type PrimeReadyGenerationOptions = {
  readinessUrl: string;
  pollIntervalMs: number;
  maxWaitMs: number;
  isCancelled: () => boolean;
  setKnownGeneration: (generation: string) => void;
};

async function primeReadyGeneration({
  readinessUrl,
  pollIntervalMs,
  maxWaitMs,
  isCancelled,
  setKnownGeneration,
}: PrimeReadyGenerationOptions): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  do {
    if (isCancelled()) return;
    const result = await readReadyGeneration(readinessUrl);
    if (result?.generation) {
      setKnownGeneration(result.generation);
      return;
    }
    await delay(pollIntervalMs);
  } while (Date.now() < deadline);
}

type ReloadAfterGenerationChangeOptions = {
  server: ViteDevServer;
  readinessUrl: string;
  pollIntervalMs: number;
  maxWaitMs: number;
  legacyReloadRequested: boolean;
  getKnownGeneration: () => string | undefined;
  setKnownGeneration: (generation: string) => void;
  isCancelled: () => boolean;
  warnAboutMissingGeneration: () => void;
};

async function reloadAfterGenerationChange({
  server,
  readinessUrl,
  pollIntervalMs,
  maxWaitMs,
  legacyReloadRequested,
  getKnownGeneration,
  setKnownGeneration,
  isCancelled,
  warnAboutMissingGeneration,
}: ReloadAfterGenerationChangeOptions): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  let reachedReadyServer = false;

  do {
    if (isCancelled()) return;
    const result = await readReadyGeneration(readinessUrl);
    if (result) {
      reachedReadyServer = true;
      if (!result.generation) {
        if (legacyReloadRequested) server.ws.send({ type: "full-reload" });
        else warnAboutMissingGeneration();
        return;
      }

      const knownGeneration = getKnownGeneration();
      if (!knownGeneration || result.generation !== knownGeneration) {
        setKnownGeneration(result.generation);
        server.ws.send({ type: "full-reload" });
        return;
      }
    }
    await delay(pollIntervalMs);
  } while (Date.now() < deadline);

  if (!reachedReadyServer && !isCancelled()) {
    server.config.logger.warn("SSR server did not become ready; browser reload was skipped");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
