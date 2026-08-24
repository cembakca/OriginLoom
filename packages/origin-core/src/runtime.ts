import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import type { ResolvedMetadata } from "@originloom/shared/lib/metadata/types";
import type { Ctx, Route } from "@originloom/shared/lib/types";
import type { FrameworkNode, OriginRenderer } from "@originloom/shared/render";

import { normalizeDependencyTags } from "./cache/tags.js";
import type { RequestErrorReport } from "./request-error.js";

export type BotVisit = { pathname: string; userAgent: string; trackingId: string };

export type ShellBuildOptions = { minimalChrome?: boolean | undefined };

export type ShellDependencyContext = {
  ctx: Ctx;
  signal: AbortSignal;
  options: ShellBuildOptions;
};

/**
 * Structured shell pipeline for applications that want loader/shell parallelism.
 *
 * `RequestFacts` is synchronous, bounded request classification. `PublicShellSnapshot`
 * and `TargetedShell` must remain safe for shared HTML. `RequestOverlay` is supplied
 * only to no-store request renders; cache fills and revalidations never receive it.
 */
export type ShellDependencyPlan<
  Shell,
  RequestFacts,
  PublicShellSnapshot,
  TargetedShell,
  RequestOverlay,
> = {
  requestFacts: (ctx: Ctx, options: ShellBuildOptions) => RequestFacts;
  loadPublicShellSnapshot: (
    facts: RequestFacts,
    context: ShellDependencyContext,
  ) => Promise<PublicShellSnapshot>;
  buildTargetedShell: (
    snapshot: PublicShellSnapshot,
    facts: RequestFacts,
    context: ShellDependencyContext,
  ) => TargetedShell | Promise<TargetedShell>;
  loadRequestOverlay?: (
    facts: RequestFacts,
    context: ShellDependencyContext,
  ) => RequestOverlay | Promise<RequestOverlay>;
  composeShell: (input: {
    facts: RequestFacts;
    publicSnapshot: PublicShellSnapshot;
    targetedShell: TargetedShell;
    /** Undefined for shared cache fills, revalidation and fragment resolution. */
    requestOverlay: RequestOverlay | undefined;
    context: ShellDependencyContext;
  }) => Shell | Promise<Shell>;
  /** Fast public boundary shell; must not wait for public snapshot or request overlay I/O. */
  composeTerminalShell: (input: {
    facts: RequestFacts;
    context: ShellDependencyContext;
  }) => Shell | Promise<Shell>;
};

/**
 * Every fragment owns its cache variation and freshness contract. Request-dependent
 * data must be represented in `key`; private/user-specific fragments are forbidden.
 */
type FragmentDefinitionBase<Shell> = {
  requiresShell: boolean;
  resolveOnFreshDocument: boolean;
  ttl: number;
  /** Optional stale-while-revalidate window, in seconds. Defaults to zero. */
  swr?: number;
  /** Bounds shell + resolver work. Defaults to the platform fragment timeout. */
  timeoutMs?: number;
  /** Stable dependencies used for exact, bounded cache invalidation. */
  tags?: readonly string[] | ((ctx: Ctx) => readonly string[]);
  /** May return a promise — the fragment cache awaits whatever comes back. */
  resolve: (shell: Shell | null, ctx: Ctx) => FrameworkNode;
  /**
   * Optional uncached fallback. When omitted, document composition preserves the
   * marker's embedded HTML from the page render/cache fill.
   */
  fallback?: (input: { error: unknown; reason: "timeout" | "error"; ctx: Ctx }) => FrameworkNode;
};

type RequestKeyedFragmentDefinition<Shell> = FragmentDefinitionBase<Shell> & {
  /** Preferred when the variation can be derived without loading the full shell. */
  keyFromRequest: (ctx: Ctx) => string;
  key?: never;
};

type ShellKeyedFragmentDefinition<Shell> = FragmentDefinitionBase<Shell> & {
  /** Legacy/shell-aware key path. Shell work must finish before the cache probe. */
  key: (shell: Shell | null, ctx: Ctx) => string;
  keyFromRequest?: never;
};

export type FragmentDefinition<Shell = unknown> =
  RequestKeyedFragmentDefinition<Shell> | ShellKeyedFragmentDefinition<Shell>;

/**
 * Product-supplied document policy: language, bot detection and metadata. The
 * views themselves (page shell, head slots, boundary pages) are the renderer
 * adapter's business — see `createReactRenderer` in `@originloom/react/server`.
 * Nothing here depends on the shell type, so it takes no type parameter.
 */
export type DocumentShell = {
  /**
   * `<html lang>`. A function when the answer depends on the request — a site
   * that serves more than one language cannot state its language once.
   */
  htmlLang: string | ((ctx: Ctx) => string);
  errorPageTitle?: string;
  isBotRequest: (request: Request) => boolean;
  resolveMetadata: <T>(route: Route<T>, data: T, ctx: Ctx) => ResolvedMetadata;
  boundaryMetadata: (kind: "not-found" | "route-error", ctx: Ctx) => ResolvedMetadata;
  defaultPageMeta: (ctx: Ctx, pageType: string) => PageAnalyticsMeta;
};

/**
 * The product-side contract of the platform runtime. The composition root installs it
 * once at startup; deep modules (fragment cache, document render, purge, metrics,
 * session middleware) read it instead of importing product code.
 */
type OriginRuntimeBase<Shell> = {
  /** Turns framework values into HTML. The only place a UI framework enters the server. */
  renderer: OriginRenderer<Shell>;
  fragments: Record<string, FragmentDefinition<Shell>>;
  /** Fragment stitching bails out when the resolved shell is unusable (e.g. menu missing). */
  isShellUsableForFragments: (shell: Shell) => boolean;
  document: DocumentShell;
  cacheKeys: { isKnownPageCachePrefix: (prefix: string) => boolean };
  onBotVisit?: (visit: BotVisit) => void;
  /**
   * Every unexpected server-side failure, once, with the reference the visitor
   * was shown. Where an app attaches Sentry — or anything else that wants the
   * error rather than the log line.
   *
   * Called synchronously on a path that is already failing, so it must not
   * throw and must not block: hand the report to a queue and return.
   */
  onRequestError?: (report: RequestErrorReport) => void;
  metricSources?: Array<() => string[]>;
};

type LegacyShellRuntime<Shell> = {
  /** @deprecated Migrate to `shell` for parallel, layered shell resolution. */
  buildShellData: (ctx: Ctx, options?: ShellBuildOptions) => Promise<Shell>;
  shell?: never;
};

type PlannedShellRuntime<Shell, RequestFacts, PublicShellSnapshot, TargetedShell, RequestOverlay> =
  {
    shell: ShellDependencyPlan<
      Shell,
      RequestFacts,
      PublicShellSnapshot,
      TargetedShell,
      RequestOverlay
    >;
    buildShellData?: never;
  };

export type OriginRuntime<
  Shell = unknown,
  RequestFacts = unknown,
  PublicShellSnapshot = unknown,
  TargetedShell = unknown,
  RequestOverlay = unknown,
> = OriginRuntimeBase<Shell> &
  (
    | LegacyShellRuntime<Shell>
    | PlannedShellRuntime<Shell, RequestFacts, PublicShellSnapshot, TargetedShell, RequestOverlay>
  );

let runtime: OriginRuntime | null = null;

export function installRuntime<
  Shell,
  RequestFacts,
  PublicShellSnapshot,
  TargetedShell,
  RequestOverlay,
>(
  next: OriginRuntime<Shell, RequestFacts, PublicShellSnapshot, TargetedShell, RequestOverlay>,
): void {
  validateFragments(next.fragments);
  runtime = next as unknown as OriginRuntime;
}

function validateFragments<Shell>(fragments: Record<string, FragmentDefinition<Shell>>): void {
  for (const [name, definition] of Object.entries(fragments)) {
    if (!Number.isInteger(definition.ttl) || definition.ttl <= 0) {
      throw new Error(`Invalid fragment ttl: ${name}`);
    }
    if (definition.swr !== undefined && (!Number.isInteger(definition.swr) || definition.swr < 0)) {
      throw new Error(`Invalid fragment swr: ${name}`);
    }
    if (
      definition.timeoutMs !== undefined &&
      (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs <= 0)
    ) {
      throw new Error(`Invalid fragment timeout: ${name}`);
    }
    if (typeof definition.keyFromRequest !== "function" && typeof definition.key !== "function") {
      throw new Error(`Fragment cache key is not defined: ${name}`);
    }
    if (definition.tags !== undefined && typeof definition.tags !== "function") {
      try {
        normalizeDependencyTags(definition.tags);
      } catch (error) {
        throw new Error(`Invalid fragment dependency tags: ${name}`, { cause: error });
      }
    }
  }
}

export function getRuntime(): OriginRuntime {
  if (!runtime) {
    throw new Error(
      "OriginLoom runtime is not installed — call installRuntime() before handling requests",
    );
  }
  return runtime;
}

/** Non-throwing accessor for paths that must degrade gracefully (metrics, error page). */
export function tryGetRuntime(): OriginRuntime | null {
  return runtime;
}
