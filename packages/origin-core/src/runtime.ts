import type { PageAnalyticsMeta } from "@originloom/react/lib/analytics/types";
import type { ResolvedMetadata } from "@originloom/react/lib/metadata/types";
import type { Ctx, Route, RouteError } from "@originloom/react/lib/types";
import type { ComponentType, ReactElement, ReactNode } from "react";

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
  resolve: (shell: Shell | null, ctx: Ctx) => Promise<ReactElement> | ReactElement;
};

/** Product-supplied document chrome: metadata resolution, head slots and the page shell. */
export type DocumentShell<Shell = unknown> = {
  htmlLang: string;
  errorPageTitle?: string;
  isBotRequest: (request: Request) => boolean;
  resolveMetadata: <T>(route: Route<T>, data: T, ctx: Ctx) => ResolvedMetadata;
  boundaryMetadata: (kind: "not-found" | "route-error", ctx: Ctx) => ResolvedMetadata;
  defaultPageMeta: (ctx: Ctx, pageType: string) => PageAnalyticsMeta;
  NotFoundComponent: ComponentType;
  ErrorComponent: ComponentType<{ error: RouteError | null; status: number }>;
  renderHeadStart: (args: { seo: ResolvedMetadata; cspNonce?: string | undefined }) => ReactNode;
  renderHeadEnd: (args: { cspNonce?: string | undefined; isBot: boolean }) => ReactNode;
  renderLayout: (args: {
    shell: Shell;
    pageMeta: PageAnalyticsMeta;
    children: ReactNode;
  }) => ReactElement;
};

/**
 * The product-side contract of the platform runtime. The composition root installs it
 * once at startup; deep modules (fragment cache, document render, purge, metrics,
 * session middleware) read it instead of importing product code.
 */
export type OriginRuntime<Shell = unknown> = {
  fragments: Record<string, FragmentDefinition<Shell>>;
  buildShellData: (ctx: Ctx, opts?: { minimalChrome?: boolean | undefined }) => Promise<Shell>;
  /** Fragment stitching bails out when the resolved shell is unusable (e.g. menu missing). */
  isShellUsableForFragments: (shell: Shell) => boolean;
  document: DocumentShell<Shell>;
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
