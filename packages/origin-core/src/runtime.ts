import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import type { ResolvedMetadata } from "@originloom/shared/lib/metadata/types";
import type { Ctx, Route } from "@originloom/shared/lib/types";
import type { FrameworkNode, OriginRenderer } from "@originloom/shared/render";

export type BotVisit = { pathname: string; userAgent: string; trackingId: string };

/**
 * Every fragment owns its cache variation and freshness contract. Request-dependent
 * data must be represented in `key`; private/user-specific fragments are forbidden.
 */
export type FragmentDefinition<Shell = unknown> = {
  requiresShell: boolean;
  resolveOnFreshDocument: boolean;
  ttl: number;
  key: (shell: Shell | null, ctx: Ctx) => string;
  /** May return a promise — the fragment cache awaits whatever comes back. */
  resolve: (shell: Shell | null, ctx: Ctx) => FrameworkNode;
};

/**
 * Product-supplied document policy: language, bot detection and metadata. The
 * views themselves (page shell, head slots, boundary pages) are the renderer
 * adapter's business — see `createReactRenderer` in `@originloom/react/server`.
 * Nothing here depends on the shell type, so it takes no type parameter.
 */
export type DocumentShell = {
  htmlLang: string;
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
export type OriginRuntime<Shell = unknown> = {
  /** Turns framework values into HTML. The only place a UI framework enters the server. */
  renderer: OriginRenderer<Shell>;
  fragments: Record<string, FragmentDefinition<Shell>>;
  buildShellData: (ctx: Ctx, opts?: { minimalChrome?: boolean | undefined }) => Promise<Shell>;
  /** Fragment stitching bails out when the resolved shell is unusable (e.g. menu missing). */
  isShellUsableForFragments: (shell: Shell) => boolean;
  document: DocumentShell;
  cacheKeys: { isKnownPageCachePrefix: (prefix: string) => boolean };
  onBotVisit?: (visit: BotVisit) => void;
  metricSources?: Array<() => string[]>;
};

let runtime: OriginRuntime | null = null;

export function installRuntime<Shell>(next: OriginRuntime<Shell>): void {
  runtime = next as OriginRuntime;
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
